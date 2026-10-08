import { Prisma, PrismaClient } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

export function createPrisma(url: string, log: Prisma.LogLevel[] = ['warn', 'error']): PrismaClient {
  return new PrismaClient({ datasourceUrl: url, log });
}

/**
 * Executa `fn` numa transação com `SET LOCAL app.tenant_id`, ativando as
 * políticas RLS. O contexto é local à transação, então não vaza entre
 * conexões do pool.
 */
export async function runInTenant<T>(
  prisma: PrismaClient,
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
  options: { timeout?: number; maxWait?: number; isolationLevel?: Prisma.TransactionIsolationLevel } = {},
): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) throw new Error('tenantId inválido');
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    },
    { timeout: options.timeout ?? 20_000, maxWait: options.maxWait ?? 5_000, isolationLevel: options.isolationLevel },
  );
}

/** Próximo número sequencial por empresa (transacional; trava a linha do contador). */
export async function nextCounter(tx: Tx, tenantId: string, key: string): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ value: number }>>`
    INSERT INTO counters (tenant_id, key, value) VALUES (${tenantId}::uuid, ${key}, 1)
    ON CONFLICT (tenant_id, key) DO UPDATE SET value = counters.value + 1
    RETURNING value`;
  return rows[0]!.value;
}

export function isUniqueViolation(e: unknown, field?: string): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') return false;
  if (!field) return true;
  const target = (e.meta?.target ?? []) as string[] | string;
  return Array.isArray(target) ? target.some((t) => t.includes(field)) : String(target).includes(field);
}
