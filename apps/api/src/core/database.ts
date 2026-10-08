import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { runInTenant, type Tx } from '@ordemcerta/server';
import { Inject } from '@nestjs/common';
import { currentTenantId } from './context';
import { ENV, type AppEnv } from './env.provider';
import { Errors } from './errors';

/** Cliente com o papel da aplicação (SEM BYPASSRLS). Só usado via TenantDb. */
@Injectable()
export class AppPrisma extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(ENV) env: AppEnv) {
    super({ datasourceUrl: env.DATABASE_URL, log: ['warn', 'error'] });
  }
  /** Conexão sob demanda: a API sobe mesmo com o banco indisponível (/health/ready reporta). */
  async onModuleInit() {
    await this.$connect().catch(() => undefined);
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}

/**
 * Cliente de sistema (BYPASSRLS). Restrito a: autenticação, plataforma,
 * billing, webhooks e resolução de tokens públicos. Toda consulta deve
 * filtrar tenant explicitamente.
 */
@Injectable()
export class SystemPrisma extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(ENV) env: AppEnv) {
    super({ datasourceUrl: env.DATABASE_SYSTEM_URL, log: ['warn', 'error'] });
  }
  /** Conexão sob demanda: a API sobe mesmo com o banco indisponível (/health/ready reporta). */
  async onModuleInit() {
    await this.$connect().catch(() => undefined);
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}

export class TxHooks {
  private readonly callbacks: Array<() => Promise<void> | void> = [];
  /** Executado somente após COMMIT (ex.: eventos websocket, enfileiramento). */
  afterCommit(cb: () => Promise<void> | void) {
    this.callbacks.push(cb);
  }
  async flush(logger: Logger) {
    for (const cb of this.callbacks) {
      try {
        await cb();
      } catch (e) {
        logger.warn({ err: (e as Error).message }, 'falha em callback pós-commit');
      }
    }
  }
}

/**
 * Transações com escopo de tenant: `SET LOCAL app.tenant_id` ativa RLS.
 * O tenant vem SEMPRE do contexto autenticado.
 */
@Injectable()
export class TenantDb {
  private readonly logger = new Logger('TenantDb');
  constructor(private readonly prisma: AppPrisma) {}

  async run<T>(fn: (tx: Tx, hooks: TxHooks) => Promise<T>, opts?: { timeout?: number }): Promise<T> {
    return this.runFor(currentTenantId(), fn, opts);
  }

  /** Tenant explícito (portal público com token já validado, jobs). */
  async runFor<T>(tenantId: string, fn: (tx: Tx, hooks: TxHooks) => Promise<T>, opts?: { timeout?: number }): Promise<T> {
    const hooks = new TxHooks();
    const result = await runInTenant(this.prisma, tenantId, (tx) => fn(tx, hooks), opts);
    await hooks.flush(this.logger);
    return result;
  }
}

/** Controle de concorrência otimista: atualiza somente se a versão bater. */
export async function bumpVersion(
  tx: Tx,
  table: 'service_orders' | 'sales' | 'cash_sessions' | 'receivables' | 'stock_transfers',
  id: string,
  expected: number,
): Promise<void> {
  const n = await tx.$executeRawUnsafe(`UPDATE ${table} SET version = version + 1 WHERE id = $1::uuid AND version = $2`, id, expected);
  if (n !== 1) throw Errors.versionConflict();
}
