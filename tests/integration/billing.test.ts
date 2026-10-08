import { BillingEngine, EncryptionService, type MercadoPagoGateway, type NormalizedPayment } from '@ordemcerta/server';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { system } from './helpers';

/**
 * Billing com gateway simulado DETERMINÍSTICO (apenas em teste) para estados não
 * reproduzíveis no sandbox. Valida ativação somente após pagamento confirmado,
 * idempotência, monotonicidade, renovação única, tolerância/suspensão e pró-rata.
 */
class FakeGateway {
  isConfigured = true;
  payments = new Map<string, NormalizedPayment>();
  creates = 0;
  async createPixPayment(input: { amountCents: number; externalReference: string; idempotencyKey: string; expiresAt: Date }) {
    this.creates++;
    const id = `pix-${input.idempotencyKey}`;
    if (!this.payments.has(id)) this.payments.set(id, this.np(id, 'PENDING', input.amountCents, input.externalReference));
    return { providerPaymentId: id, status: 'PENDING' as const, qrCode: '000201FAKE', qrCodeBase64: null, ticketUrl: null, expiresAt: input.expiresAt };
  }
  np(id: string, status: NormalizedPayment['status'], amountCents: number, externalReference: string | null): NormalizedPayment {
    return { id, status, rawStatus: status.toLowerCase(), statusDetail: null, amountCents, currency: 'BRL', externalReference, dateApproved: status === 'APPROVED' ? new Date().toISOString() : null, paymentMethodId: 'pix', raw: {} };
  }
  async getPayment(id: string) {
    return this.payments.get(id)!;
  }
  async searchPaymentsByExternalReference() {
    return [];
  }
}

const gw = new FakeGateway();
const engine = new BillingEngine(system, gw as unknown as MercadoPagoGateway, new EncryptionService(Buffer.alloc(32, 7).toString('base64')), { appUrl: 'http://test' });

async function pendingTenant(planCode = 'ESSENCIAL') {
  const plan = await system.plan.findUniqueOrThrow({ where: { code: planCode } });
  const tenant = await system.tenant.create({ data: { name: `Billing ${randomUUID().slice(0, 6)}`, status: 'PENDING_PAYMENT' } });
  const sub = await system.subscription.create({
    data: { tenantId: tenant.id, planId: plan.id, priceCents: plan.priceCents, paymentMode: 'PIX_MANUAL', status: 'PENDING_PAYMENT', externalReference: randomUUID() },
  });
  const invoice = await system.$transaction((tx) => BillingEngine.createFirstInvoice(tx, sub, new Date()));
  return { tenant, sub, invoice, plan };
}

afterAll(() => system.$disconnect());

describe('billing da plataforma', () => {
  beforeEach(() => {
    gw.creates = 0;
  });

  it('Pix: retry não duplica cobrança; pendente não ativa; aprovado ativa uma vez', async () => {
    const { tenant, invoice } = await pendingTenant();
    const p1 = await engine.createPixCharge(tenant.id, invoice.id);
    const p2 = await engine.createPixCharge(tenant.id, invoice.id);
    expect(p2.attemptId).toBe(p1.attemptId);
    expect(gw.creates).toBe(1);

    const attempt = await system.billingPaymentAttempt.findUniqueOrThrow({ where: { id: p1.attemptId } });
    await engine.applyProviderPayment(gw.np(attempt.providerPaymentId!, 'PENDING', invoice.amountCents, invoice.externalReference));
    expect((await system.subscription.findUniqueOrThrow({ where: { tenantId: tenant.id } })).status).toBe('PENDING_PAYMENT');

    const approved = gw.np(attempt.providerPaymentId!, 'APPROVED', invoice.amountCents, invoice.externalReference);
    const r1 = await engine.applyProviderPayment(approved);
    expect(r1.applied).toBe(true);
    const sub1 = await system.subscription.findUniqueOrThrow({ where: { tenantId: tenant.id } });
    expect(sub1.status).toBe('ACTIVE');
    expect((await system.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).status).toBe('ACTIVE');

    // webhook duplicado / fora de ordem
    await engine.applyProviderPayment(approved);
    await engine.applyProviderPayment(gw.np(attempt.providerPaymentId!, 'PENDING', invoice.amountCents, invoice.externalReference));
    const sub2 = await system.subscription.findUniqueOrThrow({ where: { tenantId: tenant.id } });
    expect(sub2.currentPeriodEnd!.getTime()).toBe(sub1.currentPeriodEnd!.getTime());
    expect(sub2.status).toBe('ACTIVE');
    expect(await system.billingPayment.count({ where: { invoiceId: invoice.id } })).toBe(1);
  });

  it('valor divergente não ativa', async () => {
    const { tenant, invoice } = await pendingTenant();
    const r = await engine.applyProviderPayment(gw.np(`x-${randomUUID()}`, 'APPROVED', invoice.amountCents - 1, invoice.externalReference));
    expect(r.applied).toBe(false);
    expect((await system.subscription.findUniqueOrThrow({ where: { tenantId: tenant.id } })).status).toBe('PENDING_PAYMENT');
  });

  it('renovação gera uma fatura por período e pagamento estende exatamente um ciclo', async () => {
    const { tenant, invoice } = await pendingTenant();
    await engine.applyProviderPayment(gw.np(`a-${randomUUID()}`, 'APPROVED', invoice.amountCents, invoice.externalReference));
    const sub = await system.subscription.findUniqueOrThrow({ where: { tenantId: tenant.id } });
    const future = new Date(sub.currentPeriodEnd!.getTime() - 2 * 86_400_000);
    expect(await engine.generateRenewalForSubscription(sub.id, future)).toBe(true);
    expect(await engine.generateRenewalForSubscription(sub.id, future)).toBe(false);
    const renewal = await system.billingInvoice.findFirstOrThrow({ where: { subscriptionId: sub.id, status: 'OPEN' } });
    expect(renewal.periodStart.getTime()).toBe(sub.currentPeriodEnd!.getTime());
    const pay = gw.np(`r-${randomUUID()}`, 'APPROVED', renewal.amountCents, renewal.externalReference);
    await engine.applyProviderPayment(pay);
    await engine.applyProviderPayment(pay);
    const after = await system.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(after.currentPeriodEnd!.getTime()).toBe(renewal.periodEnd.getTime());
  });

  it('inadimplência: PAST_DUE com tolerância e SUSPENDED após o prazo; pagamento reativa', async () => {
    const { tenant, invoice } = await pendingTenant();
    await engine.applyProviderPayment(gw.np(`d-${randomUUID()}`, 'APPROVED', invoice.amountCents, invoice.externalReference));
    const sub = await system.subscription.findUniqueOrThrow({ where: { tenantId: tenant.id } });
    await engine.generateRenewalForSubscription(sub.id, sub.currentPeriodEnd!, true);
    const end = sub.currentPeriodEnd!;
    await engine.runDunning(new Date(end.getTime() + 60_000));
    const pd = await system.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(pd.status).toBe('PAST_DUE');
    expect(pd.graceUntil!.getTime()).toBe(end.getTime() + 3 * 86_400_000);
    await engine.runDunning(new Date(end.getTime() + 3 * 86_400_000 + 60_000));
    expect((await system.subscription.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe('SUSPENDED');
    expect((await system.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).status).toBe('SUSPENDED');
    const open = await system.billingInvoice.findFirstOrThrow({ where: { subscriptionId: sub.id, status: 'OPEN' } });
    await engine.applyProviderPayment(gw.np(`late-${randomUUID()}`, 'APPROVED', open.amountCents, open.externalReference));
    const reactivated = await system.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(reactivated.status).toBe('ACTIVE');
  });

  it('upgrade cobra diferença proporcional e só aplica após pagamento; downgrade bloqueado por uso', async () => {
    const { tenant, invoice } = await pendingTenant('PROFISSIONAL');
    await engine.applyProviderPayment(gw.np(`u-${randomUUID()}`, 'APPROVED', invoice.amountCents, invoice.externalReference));
    const actor = randomUUID();
    const up = await engine.requestPlanChange(tenant.id, 'AVANCADO', actor);
    expect(up.type).toBe('UPGRADE');
    expect(up.prorationCents).toBeGreaterThan(0);
    expect((await system.subscription.findUniqueOrThrow({ where: { tenantId: tenant.id } })).priceCents).toBe(5999);
    const prorInv = await system.billingInvoice.findUniqueOrThrow({ where: { id: up.invoiceId! } });
    await engine.applyProviderPayment(gw.np(`p-${randomUUID()}`, 'APPROVED', prorInv.amountCents, prorInv.externalReference));
    const sub = await system.subscription.findUniqueOrThrow({ where: { tenantId: tenant.id }, include: { plan: true } });
    expect(sub.plan.code).toBe('AVANCADO');

    for (let i = 0; i < 3; i++) await system.branch.create({ data: { tenantId: tenant.id, name: `F${i}` } });
    await expect(engine.requestPlanChange(tenant.id, 'ESSENCIAL', actor)).rejects.toMatchObject({ code: 'PLAN_DOWNGRADE_BLOCKED' });
  });
});
