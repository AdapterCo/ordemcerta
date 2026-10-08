import { Inject, Injectable } from '@nestjs/common';
import { verify } from '@node-rs/argon2';
import { BillingEngine, buildSubscriptionReceiptPdf, MercadoPagoGateway, sha256Hex, isUniqueViolation } from '@ordemcerta/server';
import { type SignupInput } from '@ordemcerta/shared';
import { randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import { auth, currentTenantId } from '../../core/context';
import { SystemPrisma } from '../../core/database';
import { ENV, type AppEnv } from '../../core/env.provider';
import { Errors } from '../../core/errors';
import { PlanLimitsService } from '../../core/plan-limits.service';
import { AuditService, CryptoService, QueueService, SubscriptionStateService } from '../../core/services';
import { AuthService } from '../auth/auth.service';

export const TERMS_VERSION = '2026-10-08';
export const PRIVACY_VERSION = '2026-10-08';

@Injectable()
export class BillingEngineProvider extends BillingEngine {
  readonly gateway: MercadoPagoGateway;
  constructor(system: SystemPrisma, crypto: CryptoService, @Inject(ENV) env: AppEnv) {
    const gateway = new MercadoPagoGateway(env.MP_ACCESS_TOKEN, env.MP_WEBHOOK_SECRET, env.MP_WEBHOOK_TOLERANCE_SECONDS);
    super(system, gateway, crypto, { appUrl: env.APP_URL });
    this.gateway = gateway;
  }
}

/**
 * Billing da PLATAFORMA (conta Mercado Pago da operadora do SaaS). Isolado do
 * PDV/caixa/financeiro das assistências (17.2). Nada é liberado por redirect.
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly system: SystemPrisma,
    private readonly engine: BillingEngineProvider,
    private readonly authService: AuthService,
    private readonly audit: AuditService,
    private readonly queues: QueueService,
    private readonly limits: PlanLimitsService,
    private readonly subscriptions: SubscriptionStateService,
  ) {}

  plans() {
    return this.system.plan.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
      select: { code: true, name: true, priceCents: true, currency: true, billingPeriod: true, maxBranches: true, maxTechniciansPerBranch: true, maxCashRegistersPerBranch: true, featuresJson: true },
    });
  }

  /**
   * Cadastro + contratação. Preço SEMPRE do banco. Retentativa com o mesmo
   * e-mail/senha retoma o cadastro pendente sem duplicar empresa/assinatura.
   */
  async signup(input: SignupInput) {
    const plan = await this.system.plan.findUnique({ where: { code: input.planCode } });
    if (!plan || !plan.active) throw Errors.validation('Plano indisponível');
    const generic = () => Errors.conflict('Não foi possível concluir o cadastro com este e-mail. Se você já possui conta, faça login ou recupere a senha.');

    const existing = await this.system.user.findUnique({ where: { email: input.email } });
    if (existing) {
      const ok = await verify(existing.passwordHash, input.password).catch(() => false);
      if (!ok) throw generic();
      const pending = await this.system.tenantMembership.findFirst({
        where: { userId: existing.id, role: 'TENANT_OWNER', tenant: { status: 'PENDING_PAYMENT' } },
        include: { tenant: { include: { subscription: true } } },
      });
      if (!pending) throw generic();
      const session = await this.authService.createSession(existing.id, false, pending.tenantId);
      return { resumed: true, tenantId: pending.tenantId, session, paymentMode: pending.tenant.subscription?.paymentMode ?? input.paymentMode };
    }

    const passwordHash = await this.authService.hashPassword(input.password);
    let created: { userId: string; tenantId: string };
    try {
      created = await this.system.$transaction(async (tx) => {
        const user = await tx.user.create({ data: { email: input.email, name: input.ownerName, phone: input.phone, passwordHash } });
        const tenant = await tx.tenant.create({
          data: { name: input.companyName, legalName: input.companyName, document: input.companyDocument, phone: input.phone, email: input.email, status: 'PENDING_PAYMENT' },
        });
        await tx.tenantMembership.create({ data: { tenantId: tenant.id, userId: user.id, role: 'TENANT_OWNER' } });
        const sub = await tx.subscription.create({
          data: { tenantId: tenant.id, planId: plan.id, priceCents: plan.priceCents, paymentMode: input.paymentMode, status: 'PENDING_PAYMENT', externalReference: randomUUID() },
        });
        await BillingEngine.createFirstInvoice(tx, sub, new Date());
        await tx.auditLog.create({
          data: {
            tenantId: tenant.id,
            actorId: user.id,
            action: 'signup_terms_accepted',
            entity: 'tenant',
            entityId: tenant.id,
            metadataJson: { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, plan: plan.code, priceCents: plan.priceCents },
          },
        });
        await tx.billingAuditLog.create({ data: { tenantId: tenant.id, actorId: user.id, action: 'signup', entity: 'subscription', entityId: sub.id, metadataJson: { plan: plan.code } } });
        return { userId: user.id, tenantId: tenant.id };
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw generic();
      throw e;
    }
    const session = await this.authService.createSession(created.userId, false, created.tenantId);
    return { resumed: false, tenantId: created.tenantId, session, paymentMode: input.paymentMode };
  }

  async subscription() {
    const tenantId = currentTenantId();
    const sub = await this.system.subscription.findUnique({ where: { tenantId }, include: { plan: true, scheduledPlan: true } });
    if (!sub) throw Errors.notFound('Assinatura');
    const changes = await this.system.planChangeRequest.findMany({
      where: { tenantId, status: { in: ['PENDING_PAYMENT', 'PENDING_PROVIDER_SYNC', 'SCHEDULED'] } },
      include: { toPlan: { select: { code: true, name: true, priceCents: true } }, invoice: { select: { id: true, amountCents: true, status: true, dueAt: true } } },
    });
    const usage = await this.system.$transaction((tx) => this.limits.usage(tx, tenantId));
    const openInvoice = await this.system.billingInvoice.findFirst({ where: { tenantId, status: { in: ['OPEN', 'PENDING', 'EXPIRED'] } }, orderBy: { dueAt: 'asc' } });
    return {
      status: sub.status,
      paymentMode: sub.paymentMode,
      plan: { code: sub.plan.code, name: sub.plan.name, priceCents: sub.priceCents, maxBranches: sub.plan.maxBranches, maxTechniciansPerBranch: sub.plan.maxTechniciansPerBranch, maxCashRegistersPerBranch: sub.plan.maxCashRegistersPerBranch },
      scheduledPlan: sub.scheduledPlan ? { code: sub.scheduledPlan.code, name: sub.scheduledPlan.name, priceCents: sub.scheduledPlan.priceCents } : null,
      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: sub.currentPeriodEnd,
      graceUntil: sub.graceUntil,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      providerCancelPending: sub.providerCancelPending,
      providerSubscriptionStatus: sub.providerSubscriptionStatus,
      pendingChanges: changes,
      openInvoice,
      usage,
      providerConfigured: this.engine.gateway.isConfigured,
    };
  }

  invoices() {
    return this.system.billingInvoice.findMany({ where: { tenantId: currentTenantId() }, include: { plan: { select: { name: true, code: true } } }, orderBy: { periodStart: 'desc' }, take: 50 });
  }

  async invoice(id: string) {
    const tenantId = currentTenantId();
    const inv = await this.system.billingInvoice.findFirst({
      where: { id, tenantId },
      include: { plan: { select: { name: true, code: true } }, attempts: { orderBy: { createdAt: 'desc' } }, payments: true },
    });
    if (!inv) throw Errors.notFound('Fatura');
    const active = inv.attempts.find((a) => a.activeLock === inv.id && a.method === 'PIX' && a.providerPaymentId);
    const pix = active ? await this.pixWithImage(this.engine.pixView(active, inv.amountCents)) : null;
    return {
      ...inv,
      attempts: inv.attempts.map(({ qrPayloadEncrypted: _q, ...a }) => a),
      pix,
    };
  }

  private async pixWithImage(v: ReturnType<BillingEngineProvider['pixView']>) {
    return { ...v, qrImageDataUrl: v.qrCode ? await QRCode.toDataURL(v.qrCode, { margin: 1, width: 280 }) : null };
  }

  paymentMethods() {
    const configured = this.engine.gateway.isConfigured;
    return [
      { mode: 'CARD_RECURRING', label: 'Cartão de crédito recorrente (Mercado Pago)', available: configured },
      { mode: 'PIX_MANUAL', label: 'Pix manual mensal (sem renovação automática)', available: configured },
    ];
  }

  async checkoutPix(invoiceId?: string) {
    const tenantId = currentTenantId();
    const inv = invoiceId
      ? await this.system.billingInvoice.findFirst({ where: { id: invoiceId, tenantId } })
      : await this.system.billingInvoice.findFirst({ where: { tenantId, status: { in: ['OPEN', 'PENDING', 'EXPIRED'] } }, orderBy: { dueAt: 'asc' } });
    if (!inv) throw Errors.notFound('Fatura em aberto');
    const view = await this.engine.createPixCharge(tenantId, inv.id);
    await this.audit.logSystem({ action: 'billing_pix_requested', entity: 'billing_invoice', entityId: inv.id });
    return this.pixWithImage(view);
  }

  async checkoutCard() {
    const r = await this.engine.startCardCheckout(currentTenantId());
    await this.audit.logSystem({ action: 'billing_card_checkout', entity: 'subscription' });
    return { ...r, notice: 'A assinatura só é ativada após a confirmação do pagamento pelo Mercado Pago.' };
  }

  /** "Consultar pagamento": consulta a API oficial e aplica (idempotente). */
  async checkInvoice(id: string) {
    const tenantId = currentTenantId();
    const inv = await this.system.billingInvoice.findFirst({ where: { id, tenantId }, include: { attempts: true, subscription: true } });
    if (!inv) throw Errors.notFound('Fatura');
    if (!this.engine.gateway.isConfigured) throw Errors.integrationNotConfigured('Mercado Pago');
    for (const a of inv.attempts.filter((x) => x.providerPaymentId)) {
      await this.engine.applyProviderPayment(await this.engine.gateway.getPayment(a.providerPaymentId!));
    }
    for (const p of await this.engine.gateway.searchPaymentsByExternalReference(inv.externalReference)) await this.engine.applyProviderPayment(p);
    if (inv.subscription.paymentMode === 'CARD_RECURRING') {
      for (const p of await this.engine.gateway.searchPaymentsByExternalReference(inv.subscription.externalReference)) {
        await this.engine.applyProviderPayment(p, { subscriptionId: inv.subscriptionId });
      }
    }
    this.subscriptions.invalidate(tenantId);
    return this.invoice(id);
  }

  previewChange(planCode: string) {
    return this.engine.previewPlanChange(currentTenantId(), planCode);
  }

  async changePlan(planCode: string) {
    const r = await this.engine.requestPlanChange(currentTenantId(), planCode, auth().userId);
    this.subscriptions.invalidate(currentTenantId());
    return r;
  }

  cancelChange(id: string) {
    return this.engine.cancelPlanChange(currentTenantId(), id, auth().userId);
  }

  async cancel() {
    const r = await this.engine.cancelSubscription(currentTenantId(), auth().userId);
    this.subscriptions.invalidate(currentTenantId());
    return r;
  }

  async reactivate() {
    const r = await this.engine.reactivate(currentTenantId(), auth().userId);
    this.subscriptions.invalidate(currentTenantId());
    return r;
  }

  async receipt(id: string) {
    const tenantId = currentTenantId();
    const inv = await this.system.billingInvoice.findFirst({ where: { id, tenantId, status: 'PAID' }, include: { plan: true, tenant: true, payments: { where: { status: 'APPROVED' } } } });
    if (!inv || !inv.paidAt) throw Errors.notFound('Fatura paga');
    const pdf = await buildSubscriptionReceiptPdf({
      tenantName: inv.tenant.name,
      planName: inv.kind === 'PRORATION' ? `${inv.plan.name} (diferença proporcional)` : inv.plan.name,
      amountCents: inv.amountCents,
      periodStart: inv.periodStart,
      periodEnd: inv.periodEnd,
      paidAt: inv.paidAt,
      providerPaymentId: inv.payments[0]?.providerPaymentId ?? '—',
    });
    return pdf.buffer;
  }

  /**
   * Webhook Mercado Pago: autenticidade validada, evento persistido de forma
   * durável e minimizada, processamento assíncrono no worker (consulta a API oficial).
   */
  async receiveWebhook(input: {
    xSignature?: string;
    xRequestId?: string;
    query: Record<string, string | undefined>;
    body: Record<string, unknown> | undefined;
    raw: Buffer | undefined;
  }) {
    const body = input.body ?? {};
    const data = (body.data ?? {}) as { id?: string | number };
    const dataId = input.query['data.id'] ?? (data.id !== undefined ? String(data.id) : undefined) ?? input.query.id;
    const type = String(body.type ?? input.query.type ?? input.query.topic ?? 'unknown');
    if (!dataId) return { accepted: false };
    const sig = this.engine.gateway.validateWebhook({ xSignature: input.xSignature, xRequestId: input.xRequestId, dataId });
    const eventId = body.id !== undefined ? String(body.id) : null;
    const payloadHash = sha256Hex(input.raw ?? Buffer.from(JSON.stringify(body)));
    let event;
    try {
      event = await this.system.billingWebhookEvent.create({
        data: {
          eventId,
          requestId: input.xRequestId?.slice(0, 120) ?? null,
          resourceType: type.slice(0, 60),
          resourceId: dataId.slice(0, 120),
          eventType: typeof body.action === 'string' ? body.action.slice(0, 80) : null,
          payloadHash,
          payloadMinJson: { type, action: body.action ?? null, dataId, liveMode: body.live_mode ?? null },
          signatureValid: sig.valid,
          status: sig.valid ? 'RECEIVED' : 'IGNORED',
          error: sig.valid ? null : `assinatura inválida (${sig.reason})`,
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) return { accepted: true, duplicate: true };
      throw e;
    }
    if (!sig.valid) throw Errors.forbidden('Assinatura inválida');
    await this.queues.add('billing', 'webhook', { kind: 'webhook', eventId: event.id }, { jobId: `webhook:${event.id}` });
    return { accepted: true };
  }
}
