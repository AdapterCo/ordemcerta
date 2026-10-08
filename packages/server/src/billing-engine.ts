import { Prisma, type PrismaClient, type BillingInvoice, type Subscription } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  computeProrationCents,
  DEFAULT_GRACE_DAYS,
  downgradeViolations,
  formatBRL,
  formatDateTimeBR,
  initialPeriod,
  isMonotonicPaymentTransition,
  nextPeriod,
  normalizeDocument,
  type DowngradeUsage,
  type DowngradeViolation,
  type PlanLimits,
} from '@ordemcerta/shared';
import type { MercadoPagoGateway, NormalizedPayment } from './mercadopago';
import type { EncryptionService } from './crypto';
import { emailTemplate } from './templates';
import type { Tx } from './prisma';

/**
 * Motor de billing da PLATAFORMA (17.x). Usa o cliente de sistema (BYPASSRLS)
 * com escopo de tenant explícito em todas as consultas.
 *
 * Princípios:
 *  - Nada é ativado por redirect do navegador; somente pagamento confirmado
 *    consultado na API oficial (webhook validado ou reconciliação).
 *  - Idempotência: UNIQUE(provider_payment_id), UNIQUE(subscription_id, period_start),
 *    activeLock por fatura, chave de idempotência persistida antes da chamada externa.
 *  - Transições monotônicas: evento antigo não desfaz pagamento novo.
 *  - Período pago prorrogado exatamente uma vez por fatura (applied_at).
 */

export class BillingError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface BillingEngineOptions {
  appUrl: string;
  pixExpirationMinutes?: number;
  renewalLeadDays?: number;
  prorationDueDays?: number;
}

export interface PixView {
  attemptId: string;
  invoiceId: string;
  status: string;
  qrCode: string | null;
  ticketUrl: string | null;
  expiresAt: Date | null;
  amountCents: number;
}

export interface ApplyResult {
  applied: boolean;
  reason?: string;
  activatedTenantId?: string;
  planChangeToSync?: string;
}

type Logger = Pick<Console, 'info' | 'warn' | 'error'>;

const OPEN_INVOICE: BillingInvoice['status'][] = ['OPEN', 'PENDING', 'EXPIRED'];

export class BillingEngine {
  private readonly pixMinutes: number;
  private readonly leadDays: number;
  private readonly prorationDueDays: number;

  constructor(
    private readonly db: PrismaClient,
    private readonly mp: MercadoPagoGateway,
    private readonly crypto: EncryptionService,
    private readonly opts: BillingEngineOptions,
    private readonly log: Logger = console,
  ) {
    this.pixMinutes = opts.pixExpirationMinutes ?? 24 * 60;
    this.leadDays = opts.renewalLeadDays ?? 5;
    this.prorationDueDays = opts.prorationDueDays ?? 3;
  }

  get notificationUrl() {
    return `${this.opts.appUrl}/api/v1/webhooks/mercadopago`;
  }

  /* ============================================================ utilidades */

  async graceDays(): Promise<number> {
    const s = await this.db.platformSetting.findUnique({ where: { key: 'billing.grace_days' } });
    const v = Number((s?.valueJson as { value?: unknown } | null)?.value ?? DEFAULT_GRACE_DAYS);
    return Number.isInteger(v) && v >= 0 && v <= 30 ? v : DEFAULT_GRACE_DAYS;
  }

  private async audit(tx: Tx, tenantId: string | null, action: string, entity: string, entityId: string | null, metadata?: unknown, actorId?: string | null) {
    await tx.billingAuditLog.create({
      data: { tenantId, actorId: actorId ?? null, action, entity, entityId, metadataJson: (metadata ?? undefined) as Prisma.InputJsonValue },
    });
  }

  /** Enfileira e-mail para os proprietários do tenant (worker envia; sem dependência do WhatsApp BYOK). */
  private async notifyOwners(tx: Tx, tenantId: string, template: string, data: Record<string, string>) {
    const owners = await tx.tenantMembership.findMany({
      where: { tenantId, role: 'TENANT_OWNER', status: 'ACTIVE' },
      select: { user: { select: { email: true } } },
    });
    const content = emailTemplate(template, data);
    for (const o of owners) {
      await tx.emailOutbox.create({ data: { tenantId, toEmail: o.user.email, subject: content.subject, template, payloadJson: data } });
    }
  }

  private async noticeOnce(tx: Tx, tenantId: string, key: string, invoiceId: string, template: string, data: Record<string, string>) {
    const exists = await tx.billingAuditLog.findFirst({ where: { tenantId, action: `notice:${key}`, entityId: invoiceId } });
    if (exists) return;
    await this.notifyOwners(tx, tenantId, template, data);
    await this.audit(tx, tenantId, `notice:${key}`, 'billing_invoice', invoiceId);
  }

  private billingLink(invoiceId?: string) {
    return invoiceId ? `${this.opts.appUrl}/app/billing/faturas/${invoiceId}` : `${this.opts.appUrl}/app/billing`;
  }

  /* ============================================================== cadastro */

  /** Cria a primeira fatura (período provisório; reancorado na confirmação do pagamento). */
  static async createFirstInvoice(tx: Tx, sub: Pick<Subscription, 'id' | 'tenantId' | 'planId' | 'priceCents'>, now: Date) {
    const p = initialPeriod(now);
    return tx.billingInvoice.create({
      data: {
        tenantId: sub.tenantId,
        subscriptionId: sub.id,
        planId: sub.planId,
        kind: 'SUBSCRIPTION',
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        amountCents: sub.priceCents,
        dueAt: new Date(now.getTime() + 7 * 86_400_000),
        status: 'OPEN',
        externalReference: randomUUID(),
      },
    });
  }

  /* ============================================================ Pix manual */

  async createPixCharge(tenantId: string, invoiceId: string, now = new Date()): Promise<PixView> {
    const invoice = await this.db.billingInvoice.findFirst({ where: { id: invoiceId, tenantId }, include: { tenant: true, plan: true } });
    if (!invoice) throw new BillingError('NOT_FOUND', 'Fatura não encontrada');
    if (!OPEN_INVOICE.includes(invoice.status)) throw new BillingError('CONFLICT', 'Fatura não está em aberto');
    if (!this.mp.isConfigured) throw new BillingError('INTEGRATION_NOT_CONFIGURED', 'Mercado Pago: integração não configurada');

    const reserved = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM billing_invoices WHERE id = ${invoiceId}::uuid FOR UPDATE`;
      const active = await tx.billingPaymentAttempt.findUnique({ where: { activeLock: invoiceId } });
      if (active) {
        const fresh = active.qrExpiresAt && active.qrExpiresAt.getTime() > now.getTime() + 60_000;
        if (active.method === 'PIX' && active.providerPaymentId && fresh && ['CREATED', 'PENDING'].includes(active.status)) {
          return { attempt: active, reuse: true };
        }
        if (active.method === 'PIX' && !active.providerPaymentId && active.status === 'CREATED') {
          // chamada anterior falhou: reutiliza a MESMA chave de idempotência (não duplica cobrança)
          return { attempt: active, reuse: false };
        }
        await tx.billingPaymentAttempt.update({
          where: { id: active.id },
          data: { activeLock: null, status: ['CREATED', 'PENDING'].includes(active.status) ? 'CANCELED' : active.status },
        });
      }
      const n = (await tx.billingPaymentAttempt.count({ where: { invoiceId } })) + 1;
      const attempt = await tx.billingPaymentAttempt.create({
        data: {
          invoiceId,
          tenantId,
          method: 'PIX',
          idempotencyKey: `pix:${invoiceId}:${n}`,
          amountCents: invoice.amountCents,
          status: 'CREATED',
          attemptNo: n,
          activeLock: invoiceId,
        },
      });
      await this.audit(tx, tenantId, 'pix_attempt_reserved', 'billing_invoice', invoiceId, { attemptNo: n });
      return { attempt, reuse: false };
    });

    if (reserved.reuse) return this.pixView(reserved.attempt, invoice.amountCents);

    const owner = await this.db.tenantMembership.findFirst({
      where: { tenantId, role: 'TENANT_OWNER', status: 'ACTIVE' },
      select: { user: { select: { email: true } } },
    });
    const doc = normalizeDocument(invoice.tenant.document);
    try {
      const pix = await this.mp.createPixPayment({
        amountCents: invoice.amountCents,
        description: `OrdemCerta — ${invoice.kind === 'PRORATION' ? 'Diferença de plano' : `Plano ${invoice.plan.name}`}`,
        payerEmail: owner?.user.email ?? 'financeiro@ordemcerta.invalid',
        payerDocument: doc ? { type: doc.kind, number: doc.value } : null,
        externalReference: invoice.externalReference,
        expiresAt: new Date(now.getTime() + this.pixMinutes * 60_000),
        notificationUrl: this.notificationUrl,
        idempotencyKey: reserved.attempt.idempotencyKey,
      });
      const updated = await this.db.billingPaymentAttempt.update({
        where: { id: reserved.attempt.id },
        data: {
          providerPaymentId: pix.providerPaymentId,
          status: pix.status === 'CREATED' ? 'PENDING' : pix.status,
          qrPayloadEncrypted: pix.qrCode ? this.crypto.encrypt(pix.qrCode) : null,
          qrExpiresAt: pix.expiresAt,
          ticketUrl: pix.ticketUrl,
          errorCode: null,
        },
      });
      await this.db.billingInvoice.updateMany({ where: { id: invoiceId, status: { in: ['OPEN', 'EXPIRED'] } }, data: { status: 'PENDING' } });
      return this.pixView(updated, invoice.amountCents);
    } catch (e) {
      await this.db.billingPaymentAttempt.update({ where: { id: reserved.attempt.id }, data: { errorCode: 'PROVIDER_ERROR' } });
      this.log.error({ err: (e as Error).message, invoiceId }, 'falha ao gerar Pix');
      if (e instanceof BillingError) throw e;
      throw new BillingError('PROVIDER_ERROR', 'Não foi possível gerar o Pix agora. Tente novamente em instantes.');
    }
  }

  pixView(attempt: { id: string; invoiceId: string; status: string; qrPayloadEncrypted: string | null; ticketUrl: string | null; qrExpiresAt: Date | null }, amountCents: number): PixView {
    return {
      attemptId: attempt.id,
      invoiceId: attempt.invoiceId,
      status: attempt.status,
      qrCode: attempt.qrPayloadEncrypted ? this.crypto.decrypt(attempt.qrPayloadEncrypted) : null,
      ticketUrl: attempt.ticketUrl,
      expiresAt: attempt.qrExpiresAt,
      amountCents,
    };
  }

  /* ===================================================== cartão recorrente */

  async startCardCheckout(tenantId: string, now = new Date()): Promise<{ checkoutUrl: string | null; alreadyAuthorized: boolean }> {
    if (!this.mp.isConfigured) throw new BillingError('INTEGRATION_NOT_CONFIGURED', 'Mercado Pago: integração não configurada');
    const sub = await this.db.subscription.findUnique({ where: { tenantId }, include: { plan: true } });
    if (!sub) throw new BillingError('NOT_FOUND', 'Assinatura não encontrada');
    if (!['PENDING_PAYMENT', 'PAST_DUE', 'SUSPENDED'].includes(sub.status)) {
      throw new BillingError('CONFLICT', 'Vinculação de cartão disponível apenas com fatura em aberto');
    }
    const invoice = await this.db.billingInvoice.findFirst({
      where: { subscriptionId: sub.id, kind: 'SUBSCRIPTION', status: { in: OPEN_INVOICE } },
      orderBy: { periodStart: 'asc' },
    });
    if (!invoice) throw new BillingError('CONFLICT', 'Nenhuma fatura em aberto');

    if (sub.providerSubscriptionId) {
      const current = await this.mp.getPreapproval(sub.providerSubscriptionId);
      if (current.status === 'authorized') return { checkoutUrl: null, alreadyAuthorized: true };
      if (current.status === 'pending' && current.initPoint) return { checkoutUrl: current.initPoint, alreadyAuthorized: false };
    }

    const owner = await this.db.tenantMembership.findFirst({
      where: { tenantId, role: 'TENANT_OWNER', status: 'ACTIVE' },
      select: { user: { select: { email: true } } },
    });
    if (!owner) throw new BillingError('PRECONDITION_FAILED', 'Empresa sem proprietário ativo');

    const attempt = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM billing_invoices WHERE id = ${invoice.id}::uuid FOR UPDATE`;
      await tx.billingPaymentAttempt.updateMany({ where: { activeLock: invoice.id }, data: { activeLock: null } });
      const n = (await tx.billingPaymentAttempt.count({ where: { invoiceId: invoice.id } })) + 1;
      return tx.billingPaymentAttempt.create({
        data: {
          invoiceId: invoice.id,
          tenantId,
          method: 'CARD',
          idempotencyKey: `card:${sub.id}:${n}`,
          amountCents: invoice.amountCents,
          status: 'CREATED',
          attemptNo: n,
          activeLock: invoice.id,
        },
      });
    });

    try {
      const pa = await this.mp.createPreapproval({
        reason: `OrdemCerta — Plano ${sub.plan.name}`,
        amountCents: sub.priceCents,
        payerEmail: owner.user.email,
        externalReference: sub.externalReference,
        backUrl: `${this.opts.appUrl}/checkout/resultado`,
        idempotencyKey: attempt.idempotencyKey,
      });
      await this.db.$transaction(async (tx) => {
        await tx.subscription.update({
          where: { id: sub.id },
          data: { providerSubscriptionId: pa.id, providerSubscriptionStatus: pa.status, paymentMode: 'CARD_RECURRING', version: { increment: 1 } },
        });
        await tx.billingPaymentAttempt.update({ where: { id: attempt.id }, data: { status: 'PENDING', checkoutUrl: pa.initPoint } });
        await this.audit(tx, tenantId, 'card_checkout_started', 'subscription', sub.id, { preapprovalStatus: pa.status });
      });
      void now;
      return { checkoutUrl: pa.initPoint, alreadyAuthorized: false };
    } catch (e) {
      await this.db.billingPaymentAttempt.update({ where: { id: attempt.id }, data: { errorCode: 'PROVIDER_ERROR', activeLock: null, status: 'CANCELED' } });
      this.log.error({ err: (e as Error).message, tenantId }, 'falha ao criar assinatura de cartão');
      throw new BillingError('PROVIDER_ERROR', 'Não foi possível iniciar o checkout de cartão. Tente novamente.');
    }
  }

  /* ================================================== aplicação de pagamento */

  /**
   * Aplica um pagamento CONSULTADO na API oficial. Idempotente e monotônico.
   * `hint.subscriptionId` é usado para cobranças de assinatura sem referência de fatura.
   */
  async applyProviderPayment(np: NormalizedPayment, hint: { subscriptionId?: string } = {}, now = new Date()): Promise<ApplyResult> {
    const attempt = await this.db.billingPaymentAttempt.findUnique({ where: { providerPaymentId: np.id } });
    let invoiceId: string | null = attempt?.invoiceId ?? null;
    let subscriptionId: string | null = hint.subscriptionId ?? null;

    if (!invoiceId) {
      const existingPayment = await this.db.billingPayment.findUnique({ where: { providerPaymentId: np.id } });
      if (existingPayment) invoiceId = existingPayment.invoiceId;
    }
    if (!invoiceId && np.externalReference) {
      const inv = await this.db.billingInvoice.findUnique({ where: { externalReference: np.externalReference } });
      if (inv) invoiceId = inv.id;
      else {
        const sub = await this.db.subscription.findUnique({ where: { externalReference: np.externalReference } });
        if (sub) subscriptionId = sub.id;
      }
    }
    if (!invoiceId && subscriptionId) {
      let inv = await this.db.billingInvoice.findFirst({
        where: { subscriptionId, kind: 'SUBSCRIPTION', status: { in: OPEN_INVOICE } },
        orderBy: { periodStart: 'asc' },
      });
      if (!inv && np.status === 'APPROVED') {
        // cobrança recorrente chegou antes da geração da fatura de renovação
        await this.generateRenewalForSubscription(subscriptionId, now, true);
        inv = await this.db.billingInvoice.findFirst({
          where: { subscriptionId, kind: 'SUBSCRIPTION', status: { in: OPEN_INVOICE } },
          orderBy: { periodStart: 'asc' },
        });
      }
      if (inv) invoiceId = inv.id;
    }
    if (!invoiceId) {
      await this.db.billingAuditLog.create({
        data: { action: 'payment_unmatched', entity: 'provider_payment', entityId: np.id, metadataJson: { status: np.status, externalReference: np.externalReference } },
      });
      return { applied: false, reason: 'UNMATCHED' };
    }

    const result: ApplyResult = { applied: false };
    await this.db.$transaction(
      async (tx) => {
        const [inv] = await tx.$queryRaw<BillingInvoice[]>`SELECT * FROM billing_invoices WHERE id = ${invoiceId}::uuid FOR UPDATE`;
        if (!inv) throw new BillingError('NOT_FOUND', 'Fatura não encontrada');
        const invoice = await tx.billingInvoice.findUniqueOrThrow({ where: { id: inv.id } });
        await tx.$queryRaw`SELECT id FROM subscriptions WHERE id = ${invoice.subscriptionId}::uuid FOR UPDATE`;
        const sub = await tx.subscription.findUniqueOrThrow({ where: { id: invoice.subscriptionId } });

        if (np.currency !== 'BRL' || np.amountCents !== invoice.amountCents) {
          await this.audit(tx, invoice.tenantId, 'payment_amount_mismatch', 'billing_invoice', invoice.id, {
            providerPaymentId: np.id,
            expected: invoice.amountCents,
            received: np.amountCents,
            currency: np.currency,
          });
          result.reason = 'AMOUNT_MISMATCH';
          return;
        }

        const existing = await tx.billingPayment.findUnique({ where: { providerPaymentId: np.id } });
        if (existing && !isMonotonicPaymentTransition(existing.status, np.status)) {
          result.reason = 'STALE_EVENT';
          return;
        }
        const confirmedAt = np.status === 'APPROVED' ? new Date(np.dateApproved ?? now) : existing?.confirmedAt ?? null;
        await tx.billingPayment.upsert({
          where: { providerPaymentId: np.id },
          create: {
            invoiceId: invoice.id,
            attemptId: attempt?.id ?? null,
            providerPaymentId: np.id,
            amountCents: np.amountCents,
            status: np.status,
            confirmedAt,
            statusEvidenceJson: np.raw as Prisma.InputJsonValue,
            checkedAt: now,
          },
          update: { status: np.status, confirmedAt, statusEvidenceJson: np.raw as Prisma.InputJsonValue, checkedAt: now },
        });
        if (attempt) {
          const terminal = ['APPROVED', 'REJECTED', 'CANCELED', 'REFUNDED', 'CHARGEBACK'].includes(np.status);
          await tx.billingPaymentAttempt.update({
            where: { id: attempt.id },
            data: { status: np.status, statusDetail: np.statusDetail, ...(terminal ? { activeLock: null } : {}) },
          });
        }

        if (np.status === 'APPROVED') {
          if (invoice.status === 'PAID') {
            const paidBy = await tx.billingPayment.findFirst({ where: { invoiceId: invoice.id, status: 'APPROVED', NOT: { providerPaymentId: np.id } } });
            if (paidBy) {
              await this.audit(tx, invoice.tenantId, 'duplicate_payment_requires_refund', 'billing_invoice', invoice.id, { providerPaymentId: np.id });
              result.reason = 'DUPLICATE_PAYMENT';
            }
            return;
          }
          const paidAt = confirmedAt ?? now;
          await tx.billingInvoice.update({ where: { id: invoice.id }, data: { status: 'PAID', paidAt } });
          if (!invoice.appliedAt) {
            const applied = await this.applyInvoiceToSubscription(tx, { ...invoice, status: 'PAID', paidAt }, sub, paidAt, now);
            if (applied.activated) result.activatedTenantId = invoice.tenantId;
            if (applied.planChangeToSync) result.planChangeToSync = applied.planChangeToSync;
          }
          await tx.billingInvoice.update({ where: { id: invoice.id }, data: { appliedAt: invoice.appliedAt ?? now } });
          await this.audit(tx, invoice.tenantId, 'invoice_paid', 'billing_invoice', invoice.id, { providerPaymentId: np.id, amountCents: np.amountCents });
          result.applied = true;
          return;
        }

        if ((np.status === 'REFUNDED' || np.status === 'CHARGEBACK') && invoice.status === 'PAID') {
          const thisPaid = await tx.billingPayment.findUnique({ where: { providerPaymentId: np.id } });
          const otherApproved = await tx.billingPayment.findFirst({ where: { invoiceId: invoice.id, status: 'APPROVED', NOT: { providerPaymentId: np.id } } });
          if (thisPaid && !otherApproved) {
            await tx.billingInvoice.update({ where: { id: invoice.id }, data: { status: np.status === 'REFUNDED' ? 'REFUNDED' : 'CHARGEBACK' } });
            await this.revokeCoverage(tx, invoice, sub, now);
            result.applied = true;
          }
          await this.audit(tx, invoice.tenantId, `payment_${np.status.toLowerCase()}`, 'billing_invoice', invoice.id, { providerPaymentId: np.id });
          return;
        }

        if ((np.status === 'REJECTED' || np.status === 'CANCELED') && invoice.status === 'PENDING') {
          const stillPending = await tx.billingPaymentAttempt.findFirst({ where: { invoiceId: invoice.id, status: 'PENDING', NOT: { providerPaymentId: np.id } } });
          if (!stillPending) await tx.billingInvoice.update({ where: { id: invoice.id }, data: { status: 'OPEN' } });
          if (sub.paymentMode === 'CARD_RECURRING') {
            await this.noticeOnce(tx, invoice.tenantId, `payment_failed:${np.id}`, invoice.id, 'payment_failed', {
              reason: np.statusDetail ?? 'recusado',
              link: this.billingLink(invoice.id),
            });
          }
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 20_000 },
    );

    if (result.planChangeToSync) await this.syncPlanChange(result.planChangeToSync).catch((e) => this.log.warn({ err: (e as Error).message }, 'sync pendente'));
    return result;
  }

  private async applyInvoiceToSubscription(
    tx: Tx,
    invoice: BillingInvoice,
    sub: Subscription,
    paidAt: Date,
    now: Date,
  ): Promise<{ activated: boolean; planChangeToSync?: string }> {
    if (invoice.kind === 'PRORATION') {
      const req = await tx.planChangeRequest.findFirst({ where: { invoiceId: invoice.id, status: 'PENDING_PAYMENT' } });
      if (!req) return { activated: false };
      if (sub.paymentMode === 'CARD_RECURRING' && sub.providerSubscriptionId) {
        // Plano maior só após confirmar a sincronização do valor futuro no provedor.
        await tx.planChangeRequest.update({ where: { id: req.id }, data: { status: 'PENDING_PROVIDER_SYNC', version: { increment: 1 } } });
        return { activated: false, planChangeToSync: req.id };
      }
      const toPlan = await tx.plan.findUniqueOrThrow({ where: { id: req.toPlanId } });
      await tx.subscription.update({ where: { id: sub.id }, data: { planId: toPlan.id, priceCents: toPlan.priceCents, version: { increment: 1 } } });
      await tx.planChangeRequest.update({ where: { id: req.id }, data: { status: 'APPLIED', appliedAt: now, pendingLock: null, version: { increment: 1 } } });
      await this.audit(tx, sub.tenantId, 'plan_upgraded', 'subscription', sub.id, { toPlan: toPlan.code });
      return { activated: false };
    }

    const firstActivation = !sub.currentPeriodEnd;
    const elapsed = invoice.periodEnd.getTime() <= paidAt.getTime();
    let periodStart = invoice.periodStart;
    let periodEnd = invoice.periodEnd;
    let anchorDay = sub.anchorDay;

    if (firstActivation || elapsed) {
      // Primeira ativação ou regularização após suspensão: novo ciclo a partir do pagamento,
      // sem cobrança retroativa do período em que a operação esteve bloqueada.
      const p = initialPeriod(paidAt);
      periodStart = p.periodStart;
      periodEnd = p.periodEnd;
      anchorDay = p.anchorDay;
      await tx.billingInvoice.update({ where: { id: invoice.id }, data: { periodStart, periodEnd } });
    }

    const newEnd = sub.currentPeriodEnd && sub.currentPeriodEnd > periodEnd && !elapsed ? sub.currentPeriodEnd : periodEnd;
    const newStart = sub.currentPeriodEnd && sub.currentPeriodEnd > periodEnd && !elapsed ? sub.currentPeriodStart! : periodStart;
    const covered = newEnd.getTime() > now.getTime();
    const planChanged = invoice.planId !== sub.planId;
    const status = !covered ? 'PAST_DUE' : sub.cancelAtPeriodEnd ? 'CANCEL_AT_PERIOD_END' : 'ACTIVE';

    await tx.subscription.update({
      where: { id: sub.id },
      data: {
        status,
        anchorDay,
        currentPeriodStart: newStart,
        currentPeriodEnd: newEnd,
        graceUntil: covered ? null : sub.graceUntil,
        suspendedAt: covered ? null : sub.suspendedAt,
        activatedAt: sub.activatedAt ?? paidAt,
        planId: invoice.planId,
        priceCents: invoice.amountCents,
        scheduledPlanId: planChanged ? null : sub.scheduledPlanId,
        version: { increment: 1 },
      },
    });
    if (planChanged) {
      await tx.planChangeRequest.updateMany({
        where: { subscriptionId: sub.id, status: 'SCHEDULED', toPlanId: invoice.planId },
        data: { status: 'APPLIED', appliedAt: now, pendingLock: null },
      });
    }
    if (covered) {
      await tx.tenant.update({ where: { id: sub.tenantId }, data: { status: 'ACTIVE' } });
    }
    const plan = await tx.plan.findUniqueOrThrow({ where: { id: invoice.planId } });
    await this.audit(tx, sub.tenantId, firstActivation ? 'subscription_activated' : 'subscription_renewed', 'subscription', sub.id, {
      invoiceId: invoice.id,
      periodStart,
      periodEnd: newEnd,
    });
    await this.notifyOwners(tx, sub.tenantId, 'subscription_activated', {
      plan: plan.name,
      periodEnd: formatDateTimeBR(newEnd),
      link: this.billingLink(invoice.id),
    });
    return { activated: firstActivation && covered };
  }

  private async revokeCoverage(tx: Tx, invoice: BillingInvoice, sub: Subscription, now: Date) {
    if (invoice.kind === 'PRORATION') {
      await this.audit(tx, sub.tenantId, 'proration_reversed_review_required', 'billing_invoice', invoice.id);
      return;
    }
    const grace = await this.graceDays();
    const isCurrent = sub.currentPeriodEnd && invoice.periodEnd.getTime() >= sub.currentPeriodEnd.getTime();
    if (isCurrent) {
      await tx.subscription.update({
        where: { id: sub.id },
        data: {
          currentPeriodEnd: invoice.periodStart.getTime() > (sub.currentPeriodStart?.getTime() ?? 0) ? invoice.periodStart : sub.currentPeriodEnd,
          status: 'PAST_DUE',
          graceUntil: new Date(now.getTime() + grace * 86_400_000),
          version: { increment: 1 },
        },
      });
      await this.audit(tx, sub.tenantId, 'coverage_revoked', 'subscription', sub.id, { invoiceId: invoice.id });
    }
  }

  /* ============================================================== webhooks */

  /** Processa um evento persistido. Consulta sempre a API oficial (nunca confia no corpo). */
  async processWebhookEvent(eventId: string, now = new Date()): Promise<void> {
    const ev = await this.db.billingWebhookEvent.findUnique({ where: { id: eventId } });
    if (!ev || ev.status === 'PROCESSED' || ev.status === 'IGNORED') return;
    if (!ev.signatureValid) {
      await this.db.billingWebhookEvent.update({ where: { id: ev.id }, data: { status: 'IGNORED', error: 'assinatura inválida' } });
      return;
    }
    await this.db.billingWebhookEvent.update({ where: { id: ev.id }, data: { status: 'PROCESSING', attempts: { increment: 1 } } });
    try {
      let outcome: 'PROCESSED' | 'IGNORED' = 'PROCESSED';
      let note: string | null = null;
      switch (ev.resourceType) {
        case 'payment': {
          const np = await this.mp.getPayment(ev.resourceId);
          const r = await this.applyProviderPayment(np, {}, now);
          if (r.reason === 'UNMATCHED') {
            outcome = 'IGNORED';
            note = 'pagamento sem correspondência';
          }
          break;
        }
        case 'subscription_authorized_payment': {
          const ap = await this.mp.getAuthorizedPayment(ev.resourceId);
          const sub = ap.preapprovalId ? await this.db.subscription.findUnique({ where: { providerSubscriptionId: ap.preapprovalId } }) : null;
          if (!ap.paymentId) {
            outcome = 'IGNORED';
            note = `cobrança autorizada sem pagamento (status ${ap.status ?? '?'})`;
            break;
          }
          const np = await this.mp.getPayment(ap.paymentId);
          await this.applyProviderPayment(np, { subscriptionId: sub?.id }, now);
          break;
        }
        case 'subscription_preapproval': {
          const pa = await this.mp.getPreapproval(ev.resourceId);
          const sub =
            (await this.db.subscription.findUnique({ where: { providerSubscriptionId: pa.id } })) ??
            (pa.externalReference ? await this.db.subscription.findUnique({ where: { externalReference: pa.externalReference } }) : null);
          if (!sub) {
            outcome = 'IGNORED';
            note = 'assinatura desconhecida';
            break;
          }
          await this.db.$transaction(async (tx) => {
            const data: Prisma.SubscriptionUpdateInput = { providerSubscriptionStatus: pa.status };
            if (pa.status === 'cancelled') {
              data.providerCancelPending = false;
              if (!sub.cancelAtPeriodEnd && ['ACTIVE', 'PAST_DUE'].includes(sub.status)) {
                // cancelado pelo pagador no provedor: mantém acesso até o fim do período pago
                data.cancelAtPeriodEnd = true;
                data.status = sub.status === 'ACTIVE' ? 'CANCEL_AT_PERIOD_END' : sub.status;
                data.cancelRequestedAt = now;
              }
            }
            await tx.subscription.update({ where: { id: sub.id }, data });
            await this.audit(tx, sub.tenantId, 'preapproval_status', 'subscription', sub.id, { status: pa.status });
          });
          break;
        }
        default:
          outcome = 'IGNORED';
          note = `tópico não tratado: ${ev.resourceType}`;
      }
      await this.db.billingWebhookEvent.update({ where: { id: ev.id }, data: { status: outcome, processedAt: new Date(), error: note } });
    } catch (e) {
      const msg = (e as Error).message.slice(0, 900);
      const fresh = await this.db.billingWebhookEvent.findUnique({ where: { id: ev.id } });
      await this.db.billingWebhookEvent.update({
        where: { id: ev.id },
        data: { status: (fresh?.attempts ?? 0) >= 8 ? 'DEAD' : 'FAILED', error: msg },
      });
      throw e;
    }
  }

  /* ============================================================ renovações */

  async generateRenewals(now = new Date()): Promise<number> {
    const subs = await this.db.subscription.findMany({
      where: {
        status: { in: ['ACTIVE', 'PAST_DUE'] },
        cancelAtPeriodEnd: false,
        currentPeriodEnd: { not: null, lte: new Date(now.getTime() + this.leadDays * 86_400_000) },
      },
      select: { id: true },
      take: 500,
    });
    let created = 0;
    for (const s of subs) if (await this.generateRenewalForSubscription(s.id, now)) created++;
    return created;
  }

  async generateRenewalForSubscription(subscriptionId: string, now: Date, force = false): Promise<boolean> {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM subscriptions WHERE id = ${subscriptionId}::uuid FOR UPDATE`;
      const sub = await tx.subscription.findUniqueOrThrow({ where: { id: subscriptionId }, include: { scheduledPlan: true } });
      if (!sub.currentPeriodEnd || !sub.anchorDay || sub.cancelAtPeriodEnd) return false;
      if (!force && sub.currentPeriodEnd.getTime() > now.getTime() + this.leadDays * 86_400_000) return false;
      const open = await tx.billingInvoice.findFirst({ where: { subscriptionId, kind: 'SUBSCRIPTION', status: { in: OPEN_INVOICE } } });
      if (open) return false;
      const { periodStart, periodEnd } = nextPeriod(sub.currentPeriodEnd, sub.anchorDay);
      const dup = await tx.billingInvoice.findUnique({ where: { subscriptionId_periodStart: { subscriptionId, periodStart } } });
      if (dup) return false;
      const planId = sub.scheduledPlanId ?? sub.planId;
      const amount = sub.scheduledPlan ? sub.scheduledPlan.priceCents : sub.priceCents;
      const inv = await tx.billingInvoice.create({
        data: {
          tenantId: sub.tenantId,
          subscriptionId,
          planId,
          kind: 'SUBSCRIPTION',
          periodStart,
          periodEnd,
          amountCents: amount,
          dueAt: periodStart,
          status: 'OPEN',
          externalReference: randomUUID(),
        },
      });
      await this.audit(tx, sub.tenantId, 'renewal_invoice_created', 'billing_invoice', inv.id, { periodStart, periodEnd, amount });
      if (sub.paymentMode === 'PIX_MANUAL') {
        await this.notifyOwners(tx, sub.tenantId, 'invoice_due', {
          amount: formatBRL(amount),
          dueAt: formatDateTimeBR(periodStart),
          link: this.billingLink(inv.id),
        });
      }
      return true;
    });
  }

  /* ========================================================= inadimplência */

  async runDunning(now = new Date()): Promise<{ pastDue: number; suspended: number; canceled: number }> {
    const grace = await this.graceDays();
    const out = { pastDue: 0, suspended: 0, canceled: 0 };

    const ended = await this.db.subscription.findMany({
      where: { status: { in: ['ACTIVE', 'CANCEL_AT_PERIOD_END'] }, currentPeriodEnd: { lte: now } },
      take: 500,
    });
    for (const sub of ended) {
      await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM subscriptions WHERE id = ${sub.id}::uuid FOR UPDATE`;
        const s = await tx.subscription.findUniqueOrThrow({ where: { id: sub.id } });
        if (!s.currentPeriodEnd || s.currentPeriodEnd > now || !['ACTIVE', 'CANCEL_AT_PERIOD_END'].includes(s.status)) return;
        if (s.cancelAtPeriodEnd || s.status === 'CANCEL_AT_PERIOD_END') {
          await tx.subscription.update({ where: { id: s.id }, data: { status: 'CANCELED', canceledAt: now, version: { increment: 1 } } });
          await tx.tenant.update({ where: { id: s.tenantId }, data: { status: 'CANCELED' } });
          await this.audit(tx, s.tenantId, 'subscription_canceled', 'subscription', s.id);
          out.canceled++;
          return;
        }
        const g = new Date(s.currentPeriodEnd.getTime() + grace * 86_400_000);
        await tx.subscription.update({ where: { id: s.id }, data: { status: 'PAST_DUE', graceUntil: g, version: { increment: 1 } } });
        await this.audit(tx, s.tenantId, 'subscription_past_due', 'subscription', s.id, { graceUntil: g });
        const inv = await tx.billingInvoice.findFirst({ where: { subscriptionId: s.id, status: { in: OPEN_INVOICE } }, orderBy: { periodStart: 'asc' } });
        if (inv) {
          await this.noticeOnce(tx, s.tenantId, 'due', inv.id, 'invoice_due', {
            amount: formatBRL(inv.amountCents),
            dueAt: formatDateTimeBR(inv.dueAt),
            link: this.billingLink(inv.id),
          });
        }
        out.pastDue++;
      });
    }

    const pastDue = await this.db.subscription.findMany({ where: { status: 'PAST_DUE', graceUntil: { not: null } }, take: 1000 });
    for (const sub of pastDue) {
      await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM subscriptions WHERE id = ${sub.id}::uuid FOR UPDATE`;
        const s = await tx.subscription.findUniqueOrThrow({ where: { id: sub.id } });
        if (s.status !== 'PAST_DUE' || !s.graceUntil) return;
        const inv = await tx.billingInvoice.findFirst({ where: { subscriptionId: s.id, status: { in: OPEN_INVOICE } }, orderBy: { periodStart: 'asc' } });
        const link = this.billingLink(inv?.id);
        const due = s.currentPeriodEnd ?? s.graceUntil;
        if (inv && now.getTime() >= due.getTime() + 86_400_000) {
          await this.noticeOnce(tx, s.tenantId, 'overdue_1d', inv.id, 'invoice_overdue', {
            amount: formatBRL(inv.amountCents),
            graceUntil: formatDateTimeBR(s.graceUntil),
            link,
          });
        }
        if (inv && now.getTime() >= s.graceUntil.getTime() - 86_400_000 && now < s.graceUntil) {
          await this.noticeOnce(tx, s.tenantId, 'pre_suspension', inv.id, 'suspension_warning', { graceUntil: formatDateTimeBR(s.graceUntil), link });
        }
        if (now.getTime() >= s.graceUntil.getTime()) {
          await tx.subscription.update({ where: { id: s.id }, data: { status: 'SUSPENDED', suspendedAt: now, version: { increment: 1 } } });
          await tx.tenant.update({ where: { id: s.tenantId }, data: { status: 'SUSPENDED' } });
          await this.audit(tx, s.tenantId, 'subscription_suspended', 'subscription', s.id);
          await this.notifyOwners(tx, s.tenantId, 'subscription_suspended', { link });
          out.suspended++;
        }
      });
    }

    // Upgrades não pagos expiram; a assinatura permanece no plano atual.
    const staleProrations = await this.db.billingInvoice.findMany({
      where: { kind: 'PRORATION', status: { in: OPEN_INVOICE }, dueAt: { lt: now } },
      take: 200,
    });
    for (const inv of staleProrations) {
      await this.db.$transaction(async (tx) => {
        await tx.billingInvoice.update({ where: { id: inv.id }, data: { status: 'EXPIRED' } });
        await tx.billingPaymentAttempt.updateMany({ where: { activeLock: inv.id }, data: { activeLock: null } });
        await tx.planChangeRequest.updateMany({
          where: { invoiceId: inv.id, status: 'PENDING_PAYMENT' },
          data: { status: 'FAILED', pendingLock: null, providerSyncError: 'pagamento da diferença não confirmado no prazo' },
        });
        await this.audit(tx, inv.tenantId, 'upgrade_expired', 'billing_invoice', inv.id);
      });
    }
    return out;
  }

  /* ========================================================= reconciliação */

  async reconcile(now = new Date()): Promise<Record<string, number>> {
    const stats = { attempts: 0, subscriptions: 0, webhooks: 0, planSyncs: 0, cancels: 0 };
    if (!this.mp.isConfigured) return stats;

    const attempts = await this.db.billingPaymentAttempt.findMany({
      where: { providerPaymentId: { not: null }, status: { in: ['CREATED', 'PENDING'] }, updatedAt: { lt: new Date(now.getTime() - 2 * 60_000) } },
      take: 100,
    });
    for (const a of attempts) {
      try {
        const np = await this.mp.getPayment(a.providerPaymentId!);
        await this.applyProviderPayment(np, {}, now);
        if (np.status === 'PENDING' && a.qrExpiresAt && a.qrExpiresAt.getTime() < now.getTime() - 10 * 60_000) {
          await this.db.billingPaymentAttempt.update({ where: { id: a.id }, data: { status: 'CANCELED', activeLock: null, statusDetail: 'expired' } });
          await this.db.billingInvoice.updateMany({ where: { id: a.invoiceId, status: 'PENDING' }, data: { status: 'OPEN' } });
        } else {
          await this.db.billingPaymentAttempt.update({ where: { id: a.id }, data: { updatedAt: now } });
        }
        stats.attempts++;
      } catch (e) {
        this.log.warn({ err: (e as Error).message, attemptId: a.id }, 'reconciliação de tentativa falhou');
      }
    }

    const cardSubs = await this.db.subscription.findMany({
      where: { paymentMode: 'CARD_RECURRING', status: { in: ['PENDING_PAYMENT', 'PAST_DUE', 'SUSPENDED'] }, providerSubscriptionId: { not: null } },
      take: 100,
    });
    for (const s of cardSubs) {
      try {
        const pa = await this.mp.getPreapproval(s.providerSubscriptionId!);
        if (pa.status !== s.providerSubscriptionStatus) {
          await this.db.subscription.update({ where: { id: s.id }, data: { providerSubscriptionStatus: pa.status } });
        }
        for (const np of await this.mp.searchPaymentsByExternalReference(s.externalReference)) {
          await this.applyProviderPayment(np, { subscriptionId: s.id }, now);
        }
        stats.subscriptions++;
      } catch (e) {
        this.log.warn({ err: (e as Error).message, subscriptionId: s.id }, 'reconciliação de assinatura falhou');
      }
    }

    const events = await this.db.billingWebhookEvent.findMany({
      where: { status: { in: ['RECEIVED', 'FAILED'] }, signatureValid: true, attempts: { lt: 8 }, receivedAt: { lt: new Date(now.getTime() - 60_000) } },
      take: 100,
      orderBy: { receivedAt: 'asc' },
    });
    for (const ev of events) {
      try {
        await this.processWebhookEvent(ev.id, now);
        stats.webhooks++;
      } catch {
        /* status já registrado no evento */
      }
    }

    for (const req of await this.db.planChangeRequest.findMany({ where: { status: 'PENDING_PROVIDER_SYNC' }, take: 50 })) {
      await this.syncPlanChange(req.id).catch(() => undefined);
      stats.planSyncs++;
    }

    for (const s of await this.db.subscription.findMany({ where: { providerCancelPending: true, providerSubscriptionId: { not: null } }, take: 50 })) {
      try {
        const pa = await this.mp.cancelPreapproval(s.providerSubscriptionId!);
        if (pa.status === 'cancelled') {
          await this.db.subscription.update({ where: { id: s.id }, data: { providerCancelPending: false, providerSubscriptionStatus: pa.status } });
          stats.cancels++;
        }
      } catch (e) {
        this.log.warn({ err: (e as Error).message, subscriptionId: s.id }, 'cancelamento no provedor ainda pendente');
      }
    }
    return stats;
  }

  /* ======================================================== mudança de plano */

  static async usage(tx: Tx, tenantId: string): Promise<DowngradeUsage> {
    const branches = await tx.branch.findMany({ where: { tenantId, status: 'ACTIVE' }, select: { id: true, name: true } });
    const techniciansByBranch: DowngradeUsage['techniciansByBranch'] = [];
    const cashRegistersByBranch: DowngradeUsage['cashRegistersByBranch'] = [];
    for (const b of branches) {
      const techs = await tx.membershipBranch.count({ where: { tenantId, branchId: b.id, isTechnician: true, membership: { status: 'ACTIVE' } } });
      const regs = await tx.cashRegister.count({ where: { tenantId, branchId: b.id, active: true } });
      techniciansByBranch.push({ branchId: b.id, branchName: b.name, count: techs });
      cashRegistersByBranch.push({ branchId: b.id, branchName: b.name, count: regs });
    }
    return { activeBranches: branches.length, techniciansByBranch, cashRegistersByBranch };
  }

  async previewPlanChange(tenantId: string, toPlanCode: string, now = new Date()) {
    const sub = await this.db.subscription.findUnique({ where: { tenantId }, include: { plan: true } });
    const toPlan = await this.db.plan.findUnique({ where: { code: toPlanCode } });
    if (!sub || !toPlan || !toPlan.active) throw new BillingError('NOT_FOUND', 'Plano não encontrado');
    const type = toPlan.priceCents > sub.priceCents ? 'UPGRADE' : 'DOWNGRADE';
    const prorationCents =
      type === 'UPGRADE' && sub.currentPeriodStart && sub.currentPeriodEnd
        ? computeProrationCents({ fromPriceCents: sub.priceCents, toPriceCents: toPlan.priceCents, periodStart: sub.currentPeriodStart, periodEnd: sub.currentPeriodEnd, at: now })
        : 0;
    const violations: DowngradeViolation[] =
      type === 'DOWNGRADE' ? downgradeViolations(await BillingEngine.usage(this.db as unknown as Tx, tenantId), toPlan as PlanLimits) : [];
    return {
      type,
      currentPlan: { code: sub.plan.code, name: sub.plan.name, priceCents: sub.priceCents },
      newPlan: { code: toPlan.code, name: toPlan.name, priceCents: toPlan.priceCents },
      prorationCents,
      effectiveAt: type === 'UPGRADE' ? 'após confirmação do pagamento da diferença' : sub.currentPeriodEnd,
      violations,
    };
  }

  async requestPlanChange(tenantId: string, toPlanCode: string, actorId: string, now = new Date()) {
    const result = await this.db.$transaction(async (tx) => {
      const subRow = await tx.subscription.findUnique({ where: { tenantId } });
      if (!subRow) throw new BillingError('NOT_FOUND', 'Assinatura não encontrada');
      await tx.$queryRaw`SELECT id FROM subscriptions WHERE id = ${subRow.id}::uuid FOR UPDATE`;
      const sub = await tx.subscription.findUniqueOrThrow({ where: { id: subRow.id } });
      if (sub.status !== 'ACTIVE' || !sub.currentPeriodStart || !sub.currentPeriodEnd) {
        throw new BillingError('PRECONDITION_FAILED', 'Mudança de plano disponível apenas com assinatura ativa e em dia');
      }
      const toPlan = await tx.plan.findUnique({ where: { code: toPlanCode } });
      if (!toPlan || !toPlan.active) throw new BillingError('NOT_FOUND', 'Plano não encontrado');
      if (toPlan.id === sub.planId) throw new BillingError('CONFLICT', 'Este já é o plano atual');
      const pending = await tx.planChangeRequest.findUnique({ where: { pendingLock: sub.id } });
      if (pending) throw new BillingError('CONFLICT', 'Já existe uma mudança de plano pendente; cancele-a antes');

      if (toPlan.priceCents > sub.priceCents) {
        const proration = computeProrationCents({
          fromPriceCents: sub.priceCents,
          toPriceCents: toPlan.priceCents,
          periodStart: sub.currentPeriodStart,
          periodEnd: sub.currentPeriodEnd,
          at: now,
        });
        if (proration <= 0) throw new BillingError('PRECONDITION_FAILED', 'Ciclo no fim: aguarde a renovação para trocar de plano');
        const invoice = await tx.billingInvoice.create({
          data: {
            tenantId,
            subscriptionId: sub.id,
            planId: toPlan.id,
            kind: 'PRORATION',
            periodStart: now,
            periodEnd: sub.currentPeriodEnd,
            amountCents: proration,
            dueAt: new Date(now.getTime() + this.prorationDueDays * 86_400_000),
            status: 'OPEN',
            externalReference: randomUUID(),
          },
        });
        const req = await tx.planChangeRequest.create({
          data: {
            tenantId,
            subscriptionId: sub.id,
            fromPlanId: sub.planId,
            toPlanId: toPlan.id,
            type: 'UPGRADE',
            effectiveAt: now,
            prorationCents: proration,
            invoiceId: invoice.id,
            status: 'PENDING_PAYMENT',
            createdBy: actorId,
            pendingLock: sub.id,
          },
        });
        await this.audit(tx, tenantId, 'upgrade_requested', 'plan_change_request', req.id, { toPlan: toPlan.code, proration }, actorId);
        return { request: req, invoiceId: invoice.id, sync: false };
      }

      const usage = await BillingEngine.usage(tx, tenantId);
      const violations = downgradeViolations(usage, toPlan as PlanLimits);
      if (violations.length) throw new BillingError('PLAN_DOWNGRADE_BLOCKED', 'Ajuste o uso antes de agendar o downgrade', violations);
      const needsSync = sub.paymentMode === 'CARD_RECURRING' && Boolean(sub.providerSubscriptionId);
      const req = await tx.planChangeRequest.create({
        data: {
          tenantId,
          subscriptionId: sub.id,
          fromPlanId: sub.planId,
          toPlanId: toPlan.id,
          type: 'DOWNGRADE',
          effectiveAt: sub.currentPeriodEnd,
          status: needsSync ? 'PENDING_PROVIDER_SYNC' : 'SCHEDULED',
          createdBy: actorId,
          pendingLock: sub.id,
        },
      });
      await tx.subscription.update({ where: { id: sub.id }, data: { scheduledPlanId: toPlan.id, version: { increment: 1 } } });
      await this.audit(tx, tenantId, 'downgrade_scheduled', 'plan_change_request', req.id, { toPlan: toPlan.code }, actorId);
      return { request: req, invoiceId: null, sync: needsSync };
    });
    if (result.sync) await this.syncPlanChange(result.request.id).catch(() => undefined);
    return this.db.planChangeRequest.findUniqueOrThrow({ where: { id: result.request.id }, include: { toPlan: true, invoice: true } });
  }

  /** Sincroniza o valor da renovação futura do cartão e VERIFICA o resultado antes de confirmar. */
  async syncPlanChange(requestId: string, now = new Date()): Promise<void> {
    const req = await this.db.planChangeRequest.findUnique({ where: { id: requestId }, include: { subscription: true, toPlan: true } });
    if (!req || req.status !== 'PENDING_PROVIDER_SYNC') return;
    const sub = req.subscription;
    try {
      if (!sub.providerSubscriptionId) throw new Error('assinatura sem vínculo no provedor');
      const pa = await this.mp.updatePreapprovalAmount(sub.providerSubscriptionId, req.toPlan.priceCents);
      if (pa.amountCents !== req.toPlan.priceCents) throw new Error(`valor no provedor (${pa.amountCents}) diverge do esperado`);
      await this.db.$transaction(async (tx) => {
        if (req.type === 'UPGRADE') {
          await tx.subscription.update({ where: { id: sub.id }, data: { planId: req.toPlanId, priceCents: req.toPlan.priceCents, version: { increment: 1 } } });
          await tx.planChangeRequest.update({ where: { id: req.id }, data: { status: 'APPLIED', appliedAt: now, pendingLock: null, providerSyncError: null } });
          await this.audit(tx, sub.tenantId, 'plan_upgraded', 'subscription', sub.id, { toPlan: req.toPlan.code });
        } else {
          await tx.planChangeRequest.update({ where: { id: req.id }, data: { status: 'SCHEDULED', providerSyncError: null } });
          await this.audit(tx, sub.tenantId, 'downgrade_synced', 'subscription', sub.id, { toPlan: req.toPlan.code });
        }
      });
    } catch (e) {
      await this.db.planChangeRequest.update({ where: { id: req.id }, data: { providerSyncError: (e as Error).message.slice(0, 480) } });
      throw e;
    }
  }

  async cancelPlanChange(tenantId: string, requestId: string, actorId: string) {
    const req = await this.db.planChangeRequest.findFirst({ where: { id: requestId, tenantId }, include: { subscription: true, fromPlan: true } });
    if (!req) throw new BillingError('NOT_FOUND', 'Solicitação não encontrada');
    if (!['PENDING_PAYMENT', 'PENDING_PROVIDER_SYNC', 'SCHEDULED'].includes(req.status)) throw new BillingError('CONFLICT', 'Solicitação não pode mais ser cancelada');
    if (req.type === 'UPGRADE' && req.status === 'PENDING_PROVIDER_SYNC') {
      throw new BillingError('CONFLICT', 'Diferença já paga; a mudança está em sincronização com o provedor');
    }
    if (req.type === 'DOWNGRADE' && req.status === 'SCHEDULED' && req.subscription.paymentMode === 'CARD_RECURRING' && req.subscription.providerSubscriptionId) {
      const pa = await this.mp.updatePreapprovalAmount(req.subscription.providerSubscriptionId, req.subscription.priceCents);
      if (pa.amountCents !== req.subscription.priceCents) throw new BillingError('PROVIDER_ERROR', 'Não foi possível restaurar o valor no provedor; tente novamente');
    }
    await this.db.$transaction(async (tx) => {
      if (req.invoiceId) {
        const active = await tx.billingPaymentAttempt.findFirst({ where: { invoiceId: req.invoiceId, status: 'PENDING' } });
        if (active) throw new BillingError('CONFLICT', 'Há um pagamento em processamento para esta diferença');
        await tx.billingInvoice.updateMany({ where: { id: req.invoiceId, status: { in: OPEN_INVOICE } }, data: { status: 'VOID' } });
        await tx.billingPaymentAttempt.updateMany({ where: { activeLock: req.invoiceId }, data: { activeLock: null, status: 'CANCELED' } });
      }
      if (req.type === 'DOWNGRADE') {
        await tx.subscription.update({ where: { id: req.subscriptionId }, data: { scheduledPlanId: null, version: { increment: 1 } } });
        // fatura de renovação já gerada com o valor do downgrade e sem cobrança ativa volta ao plano atual
        const open = await tx.billingInvoice.findFirst({ where: { subscriptionId: req.subscriptionId, kind: 'SUBSCRIPTION', status: 'OPEN', planId: req.toPlanId } });
        if (open) {
          const busy = await tx.billingPaymentAttempt.findFirst({ where: { invoiceId: open.id, status: { in: ['CREATED', 'PENDING'] } } });
          if (busy) throw new BillingError('CONFLICT', 'A fatura de renovação já possui cobrança em andamento');
          await tx.billingInvoice.update({ where: { id: open.id }, data: { planId: req.fromPlanId, amountCents: req.subscription.priceCents } });
        }
      }
      await tx.planChangeRequest.update({ where: { id: req.id }, data: { status: 'CANCELED', canceledAt: new Date(), pendingLock: null } });
      await this.audit(tx, tenantId, 'plan_change_canceled', 'plan_change_request', req.id, undefined, actorId);
    });
  }

  /* ============================================== cancelamento e reativação */

  async cancelSubscription(tenantId: string, actorId: string, now = new Date()) {
    const sub = await this.db.subscription.findUnique({ where: { tenantId } });
    if (!sub) throw new BillingError('NOT_FOUND', 'Assinatura não encontrada');
    if (!['ACTIVE', 'PAST_DUE'].includes(sub.status)) throw new BillingError('CONFLICT', 'Assinatura não pode ser cancelada neste estado');
    await this.db.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id: sub.id },
        data: {
          cancelAtPeriodEnd: true,
          cancelRequestedAt: now,
          status: sub.status === 'ACTIVE' ? 'CANCEL_AT_PERIOD_END' : sub.status,
          providerCancelPending: Boolean(sub.providerSubscriptionId && sub.paymentMode === 'CARD_RECURRING'),
          version: { increment: 1 },
        },
      });
      // fatura de renovação ainda não paga é anulada (sem novas cobranças)
      await tx.billingInvoice.updateMany({ where: { subscriptionId: sub.id, kind: 'SUBSCRIPTION', status: 'OPEN', periodStart: { gte: sub.currentPeriodEnd ?? now } }, data: { status: 'VOID' } });
      await this.audit(tx, tenantId, 'cancel_requested', 'subscription', sub.id, undefined, actorId);
    });
    let providerCanceled = sub.paymentMode !== 'CARD_RECURRING' || !sub.providerSubscriptionId;
    if (!providerCanceled) {
      try {
        const pa = await this.mp.cancelPreapproval(sub.providerSubscriptionId!);
        providerCanceled = pa.status === 'cancelled';
        if (providerCanceled) {
          await this.db.subscription.update({ where: { id: sub.id }, data: { providerCancelPending: false, providerSubscriptionStatus: pa.status } });
        }
      } catch (e) {
        this.log.warn({ err: (e as Error).message }, 'cancelamento no provedor pendente; será reconciliado');
      }
    }
    return { providerCanceled, accessUntil: sub.currentPeriodEnd };
  }

  async reactivate(tenantId: string, actorId: string, now = new Date()) {
    const sub = await this.db.subscription.findUnique({ where: { tenantId } });
    if (!sub) throw new BillingError('NOT_FOUND', 'Assinatura não encontrada');
    if (sub.status !== 'CANCEL_AT_PERIOD_END' || !sub.currentPeriodEnd || sub.currentPeriodEnd <= now) {
      throw new BillingError('CONFLICT', 'Reativação disponível apenas antes do fim do período pago');
    }
    let paymentMode = sub.paymentMode;
    let note: string | null = null;
    if (sub.paymentMode === 'CARD_RECURRING' && sub.providerSubscriptionId) {
      const pa = await this.mp.getPreapproval(sub.providerSubscriptionId);
      if (pa.status === 'cancelled') {
        // autorização recorrente encerrada no provedor: próxima fatura via Pix até novo vínculo de cartão
        paymentMode = 'PIX_MANUAL';
        note = 'A autorização do cartão foi encerrada no Mercado Pago. A próxima fatura será por Pix; você poderá vincular um cartão novamente na renovação.';
      }
    }
    await this.db.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id: sub.id },
        data: { status: 'ACTIVE', cancelAtPeriodEnd: false, cancelRequestedAt: null, providerCancelPending: false, paymentMode, version: { increment: 1 } },
      });
      await this.audit(tx, tenantId, 'reactivated', 'subscription', sub.id, { paymentMode }, actorId);
    });
    return { status: 'ACTIVE', paymentMode, note };
  }
}
