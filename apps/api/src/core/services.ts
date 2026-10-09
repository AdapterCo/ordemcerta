import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  createQueue,
  EncryptionService,
  hashIp,
  redisConnection,
  type QueueName,
  type Tx,
} from '@ordemcerta/server';
import { isOperational, type SubscriptionSnapshot } from '@ordemcerta/shared';
import type { Queue, JobsOptions } from 'bullmq';
import IORedis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { maybeCtx } from './context';
import { SystemPrisma, type TxHooks } from './database';
import { ENV, type AppEnv } from './env.provider';
import { Errors } from './errors';

@Injectable()
export class CryptoService extends EncryptionService {
  constructor(@Inject(ENV) private readonly env: AppEnv) {
    super(env.ENCRYPTION_KEY, env.ENCRYPTION_KEY_ID, env.ENCRYPTION_KEYS_PREVIOUS);
  }
  ipHash(ip: string | null | undefined) {
    return hashIp(ip, this.env.JWT_SECRET);
  }
}

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: IORedis;
  constructor(@Inject(ENV) env: AppEnv) {
    this.client = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: 2, enableOfflineQueue: true, lazyConnect: false });
    this.client.on('error', () => undefined);
  }
  async onModuleDestroy() {
    await this.client.quit().catch(() => undefined);
  }
}

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly queues = new Map<QueueName, Queue>();
  private readonly logger = new Logger('Queues');
  constructor(@Inject(ENV) private readonly env: AppEnv) {}

  queue(name: QueueName): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = createQueue(name, redisConnection(this.env.REDIS_URL));
      this.queues.set(name, q);
    }
    return q;
  }

  /** Falha de fila nunca interrompe a transação de negócio (outbox garante reprocessamento). */
  async add(name: QueueName, jobName: string, data: object, opts?: JobsOptions) {
    try {
      await this.queue(name).add(jobName, data, opts);
    } catch (e) {
      this.logger.warn({ err: (e as Error).message, queue: name }, 'falha ao enfileirar; o worker recupera pelo outbox/polling');
    }
  }

  async onModuleDestroy() {
    await Promise.all([...this.queues.values()].map((q) => q.close().catch(() => undefined)));
  }
}

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  tenantId?: string | null;
  actorId?: string | null;
  actorType?: 'USER' | 'SYSTEM' | 'CUSTOMER' | 'SUPPORT';
}

/** Trilha de auditoria append-only. Nunca registrar segredos, tokens ou dados completos sensíveis. */
@Injectable()
export class AuditService {
  constructor(
    private readonly system: SystemPrisma,
    private readonly crypto: CryptoService,
  ) {}

  private build(e: AuditEntry) {
    const c = maybeCtx();
    return {
      tenantId: e.tenantId !== undefined ? e.tenantId : (c?.auth?.tenantId ?? null),
      actorId: e.actorId !== undefined ? e.actorId : (c?.auth?.userId ?? null),
      actorType: e.actorType ?? (c?.auth?.supportAccess ? 'SUPPORT' : 'USER'),
      action: e.action,
      entity: e.entity,
      entityId: e.entityId ?? null,
      metadataJson: (e.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      requestId: c?.requestId ?? null,
      ipHash: this.crypto.ipHash(c?.ip),
    };
  }

  /** Dentro da transação do tenant (mesma unidade atômica da mudança). */
  async log(tx: Tx, e: AuditEntry) {
    await tx.auditLog.create({ data: this.build(e) });
  }

  /** Fora de tenant (auth, plataforma, webhooks). */
  async logSystem(e: AuditEntry) {
    await this.system.auditLog.create({ data: this.build(e) });
  }
}

export interface DomainEvent {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

/**
 * Outbox transacional: o evento é gravado na MESMA transação da mudança de
 * estado. O worker processa (WhatsApp, e-mail) com idempotência; falha de
 * provedor nunca bloqueia a OS.
 */
@Injectable()
export class OutboxService {
  constructor(private readonly queues: QueueService) {}

  async add(tx: Tx, hooks: TxHooks, tenantId: string, ev: DomainEvent): Promise<string> {
    const eventId = randomUUID();
    await tx.notificationOutbox.create({
      data: {
        tenantId,
        eventId,
        eventType: ev.eventType,
        aggregateType: ev.aggregateType,
        aggregateId: ev.aggregateId,
        payloadJson: ev.payload as Prisma.InputJsonValue,
      },
    });
    hooks.afterCommit(() => this.queues.add('outbox', 'dispatch', { eventId }, { removeOnComplete: true }));
    return eventId;
  }
}

/** Estado da assinatura (cache curto) para o bloqueio operacional por inadimplência. */
@Injectable()
export class SubscriptionStateService {
  private readonly cache = new Map<string, { at: number; snap: (SubscriptionSnapshot & { tenantStatus: string }) | null }>();
  constructor(private readonly system: SystemPrisma) {}

  async snapshot(tenantId: string) {
    const hit = this.cache.get(tenantId);
    if (hit && Date.now() - hit.at < 5_000) return hit.snap;
    const sub = await this.system.subscription.findUnique({
      where: { tenantId },
      select: { status: true, currentPeriodEnd: true, graceUntil: true, tenant: { select: { status: true } } },
    });
    const snap = sub ? { status: sub.status, currentPeriodEnd: sub.currentPeriodEnd, graceUntil: sub.graceUntil, tenantStatus: sub.tenant.status } : null;
    this.cache.set(tenantId, { at: Date.now(), snap });
    return snap;
  }

  invalidate(tenantId: string) {
    this.cache.delete(tenantId);
  }

  async isOperational(tenantId: string): Promise<boolean> {
    const s = await this.snapshot(tenantId);
    return Boolean(s && !['CANCELED', 'SUSPENDED'].includes(s.tenantStatus) && isOperational(s));
  }

  async assertOperational(tenantId: string) {
    const s = await this.snapshot(tenantId);
    if (!s || ['CANCELED', 'SUSPENDED'].includes(s.tenantStatus) || !isOperational(s)) throw Errors.subscriptionInactive(s?.status ?? 'NONE');
  }
}
