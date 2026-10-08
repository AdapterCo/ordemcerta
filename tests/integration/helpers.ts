import { hash } from '@node-rs/argon2';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

export const system = new PrismaClient({ datasourceUrl: process.env.DATABASE_SYSTEM_URL });
export const app = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

export const PASSWORD = 'SenhaTeste12345';

export interface Fixture {
  tenantId: string;
  branchId: string;
  locationId: string;
  registerId: string;
  ownerEmail: string;
  ownerUserId: string;
}

/** Cria empresa ATIVA com filial, local de estoque, caixa e proprietário (dados fictícios). */
export async function makeTenant(name: string, planCode = 'PROFISSIONAL', status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE'): Promise<Fixture> {
  const plan = await system.plan.findUniqueOrThrow({ where: { code: planCode } });
  const suffix = randomUUID().slice(0, 8);
  const ownerEmail = `dono.${suffix}@ordemcerta.test`;
  const now = new Date();
  return system.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({ data: { name: `${name} ${suffix}`, status } });
    const branch = await tx.branch.create({ data: { tenantId: tenant.id, name: 'Centro' } });
    const loc = await tx.stockLocation.create({ data: { tenantId: tenant.id, branchId: branch.id, name: 'Principal', isDefault: true } });
    const reg = await tx.cashRegister.create({ data: { tenantId: tenant.id, branchId: branch.id, name: 'Caixa 1' } });
    await tx.subscription.create({
      data: {
        tenantId: tenant.id,
        planId: plan.id,
        priceCents: plan.priceCents,
        paymentMode: 'PIX_MANUAL',
        status,
        anchorDay: now.getUTCDate(),
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000),
        externalReference: randomUUID(),
      },
    });
    const user = await tx.user.create({ data: { email: ownerEmail, name: 'Dono Teste', passwordHash: await hash(PASSWORD) } });
    const m = await tx.tenantMembership.create({ data: { tenantId: tenant.id, userId: user.id, role: 'TENANT_OWNER' } });
    await tx.membershipBranch.create({ data: { tenantId: tenant.id, membershipId: m.id, branchId: branch.id, isTechnician: true } });
    return { tenantId: tenant.id, branchId: branch.id, locationId: loc.id, registerId: reg.id, ownerEmail, ownerUserId: user.id };
  });
}

/** Executa com contexto RLS do papel da aplicação. */
export function asTenant<T>(tenantId: string | null, fn: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<T>) {
  return app.$transaction(async (tx) => {
    if (tenantId) await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
}

/* ------------------------------------------------------------- cliente HTTP */

export class Http {
  token: string | null = null;
  constructor(readonly base: string) {}

  async req<T = any>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: T }> {
    const res = await fetch(`${this.base}/api/v1${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T };
  }

  async login(email: string, password = PASSWORD) {
    const r = await this.req<{ accessToken: string }>('POST', '/auth/login', { email, password });
    if (r.status !== 200) throw new Error(`login falhou: ${JSON.stringify(r.body)}`);
    this.token = r.body.accessToken;
    return this;
  }
}

export const idem = () => randomUUID();
