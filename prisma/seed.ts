/**
 * Seed idempotente.
 *  - Sempre: os quatro planos oficiais (17.1), por `code` UNIQUE. Nunca
 *    duplica, nunca sobrescreve preço de plano existente (mudança de preço =
 *    nova versão comercial, feita pelo painel da plataforma).
 *  - Opcional (SEED_SUPERADMIN_EMAIL + SEED_SUPERADMIN_PASSWORD): cria o
 *    superadmin da plataforma (MFA obrigatório no primeiro login).
 *  - Opcional (SEED_DEMO=true, NUNCA em produção): tenant fictício de demonstração.
 *
 * Executar com o papel de sistema (BYPASSRLS): DATABASE_SYSTEM_URL.
 */
import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { PLAN_FEATURES, PLAN_SEED } from '../packages/shared/src/plans';
import { initialPeriod } from '../packages/shared/src/billing';
import { randomUUID } from 'node:crypto';

const url = process.env.DATABASE_SYSTEM_URL ?? process.env.DATABASE_MIGRATION_URL;
if (!url) throw new Error('DATABASE_SYSTEM_URL não definido');
const prisma = new PrismaClient({ datasourceUrl: url });

const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

async function seedPlans() {
  for (const p of PLAN_SEED) {
    const existing = await prisma.plan.findUnique({ where: { code: p.code } });
    if (existing) {
      console.log(`plano ${p.code} já existe (preço preservado: ${existing.priceCents})`);
      continue;
    }
    await prisma.$transaction(async (tx) => {
      const plan = await tx.plan.create({
        data: {
          code: p.code,
          name: p.name,
          priceCents: p.priceCents,
          currency: 'BRL',
          billingPeriod: 'MONTHLY',
          maxBranches: p.maxBranches,
          maxTechniciansPerBranch: p.maxTechniciansPerBranch,
          maxCashRegistersPerBranch: p.maxCashRegistersPerBranch,
          limitsJson: {
            maxBranches: p.maxBranches,
            maxTechniciansPerBranch: p.maxTechniciansPerBranch,
            maxCashRegistersPerBranch: p.maxCashRegistersPerBranch,
          },
          featuresJson: [...PLAN_FEATURES],
          sortOrder: p.sortOrder,
          priceVersion: 1,
        },
      });
      await tx.planPriceHistory.create({
        data: { planId: plan.id, version: 1, priceCents: p.priceCents, effectiveAt: new Date() },
      });
    });
    console.log(`plano ${p.code} criado`);
  }
}

async function seedSuperadmin() {
  const email = process.env.SEED_SUPERADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_SUPERADMIN_PASSWORD;
  if (!email || !password) return;
  if (password.length < 12) throw new Error('SEED_SUPERADMIN_PASSWORD deve ter ao menos 12 caracteres');
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log('superadmin já existe');
    return;
  }
  await prisma.user.create({
    data: {
      email,
      name: 'Administrador da Plataforma',
      passwordHash: await hash(password, ARGON),
      platformRole: 'PLATFORM_SUPERADMIN',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
  console.log(`superadmin ${email} criado (MFA será exigida no primeiro login)`);
}

/** Dados fictícios para desenvolvimento local. Bloqueado em produção. */
async function seedDemo() {
  if (process.env.SEED_DEMO !== 'true') return;
  if (process.env.NODE_ENV === 'production') throw new Error('SEED_DEMO não pode rodar em produção');
  const email = 'demo.dono@ordemcerta.test';
  if (await prisma.user.findUnique({ where: { email } })) {
    console.log('demo já existe');
    return;
  }
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: 'PROFISSIONAL' } });
  const pwd = await hash('DemoOrdemCerta2026', ARGON);
  const now = new Date();
  const period = initialPeriod(now);

  await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: { name: 'Assistência Demo (fictícia)', status: 'ACTIVE', timezone: 'America/Sao_Paulo', onboardingCompletedAt: now },
    });
    const branch = await tx.branch.create({ data: { tenantId: tenant.id, name: 'Loja Centro', timezone: 'America/Sao_Paulo' } });
    await tx.stockLocation.create({ data: { tenantId: tenant.id, branchId: branch.id, name: 'Principal', isDefault: true } });
    await tx.cashRegister.create({ data: { tenantId: tenant.id, branchId: branch.id, name: 'Caixa 1' } });
    await tx.subscription.create({
      data: {
        tenantId: tenant.id,
        planId: plan.id,
        priceCents: plan.priceCents,
        paymentMode: 'PIX_MANUAL',
        status: 'ACTIVE',
        anchorDay: period.anchorDay,
        currentPeriodStart: period.periodStart,
        currentPeriodEnd: period.periodEnd,
        externalReference: randomUUID(),
        activatedAt: now,
      },
    });
    const users = [
      { email, name: 'Dono Demo', role: 'TENANT_OWNER' as const, tech: false },
      { email: 'demo.atendente@ordemcerta.test', name: 'Atendente Demo', role: 'RECEPTIONIST' as const, tech: false },
      { email: 'demo.tecnico@ordemcerta.test', name: 'Técnico Demo', role: 'TECHNICIAN' as const, tech: true },
      { email: 'demo.caixa@ordemcerta.test', name: 'Caixa Demo', role: 'CASHIER' as const, tech: false },
    ];
    for (const u of users) {
      const user = await tx.user.create({ data: { email: u.email, name: u.name, passwordHash: pwd, emailVerifiedAt: now } });
      const m = await tx.tenantMembership.create({ data: { tenantId: tenant.id, userId: user.id, role: u.role } });
      await tx.membershipBranch.create({ data: { tenantId: tenant.id, membershipId: m.id, branchId: branch.id, isTechnician: u.tech } });
    }
    const cat = await tx.category.create({ data: { tenantId: tenant.id, name: 'Telas' } });
    await tx.product.create({
      data: { tenantId: tenant.id, sku: 'TELA-DEMO-01', name: 'Tela fictícia modelo X', categoryId: cat.id, kind: 'PART', costCents: 8000, priceCents: 18000, minStock: 2 },
    });
    await tx.customer.create({ data: { tenantId: tenant.id, name: 'Cliente Fictício', phoneE164: '+5511900000000' } });
  });
  console.log('tenant demo criado (senha: DemoOrdemCerta2026)');
}

async function main() {
  await seedPlans();
  await seedSuperadmin();
  await seedDemo();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
