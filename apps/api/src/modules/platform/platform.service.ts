import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { integrationStatus, QUEUES, type QueueName } from '@ordemcerta/server';
import { platformPlanSchema, platformSettingSchema, platformTenantStatusSchema } from '@ordemcerta/shared';
import type { z } from 'zod';
import { auth } from '../../core/context';
import { SystemPrisma } from '../../core/database';
import { ENV, type AppEnv } from '../../core/env.provider';
import { Errors } from '../../core/errors';
import { AuditService, QueueService, SubscriptionStateService } from '../../core/services';

/**
 * Administração SaaS. Sem acesso a dados operacionais dos clientes (OS,
 * clientes, vendas) — apenas métricas agregadas, assinaturas e auditoria.
 */
@Injectable()
export class PlatformService {
  constructor(
    private readonly db: SystemPrisma,
    private readonly audit: AuditService,
    private readonly queues: QueueService,
    private readonly subscriptions: SubscriptionStateService,
    @Inject(ENV) private readonly env: AppEnv,
  ) {}

  private log(action: string, entity: string, entityId: string | null, metadata?: Record<string, unknown>) {
    return this.audit.logSystem({ tenantId: null, actorId: auth().userId, action: `platform_${action}`, entity, entityId, metadata });
  }

  async metrics() {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const byStatus = await this.db.subscription.groupBy({ by: ['status'], _count: true, _sum: { priceCents: true } });
    const count = (s: string) => byStatus.find((b) => b.status === s)?._count ?? 0;
    const mrr = byStatus.filter((b) => ['ACTIVE', 'PAST_DUE', 'CANCEL_AT_PERIOD_END'].includes(b.status)).reduce((s, b) => s + (b._sum.priceCents ?? 0), 0);
    const [churned, storage, messages, branches, users, failedWebhooks, unmatched] = await Promise.all([
      this.db.subscription.count({ where: { status: 'CANCELED', canceledAt: { gte: since } } }),
      this.db.serviceOrderFile.aggregate({ _sum: { sizeBytes: true } }),
      this.db.messageDelivery.count({ where: { createdAt: { gte: since }, status: { in: ['SENT', 'DELIVERED', 'READ'] } } }),
      this.db.branch.count({ where: { status: 'ACTIVE' } }),
      this.db.user.count({ where: { status: 'ACTIVE', platformRole: null } }),
      this.db.billingWebhookEvent.count({ where: { status: { in: ['FAILED', 'DEAD'] } } }),
      this.db.billingAuditLog.count({ where: { action: { in: ['payment_unmatched', 'payment_amount_mismatch', 'duplicate_payment_requires_refund'] }, createdAt: { gte: since } } }),
    ]);
    const jobs: Record<string, unknown> = {};
    for (const name of Object.values(QUEUES)) {
      try {
        jobs[name] = await this.queues.queue(name).getJobCounts('waiting', 'active', 'failed', 'delayed');
      } catch {
        jobs[name] = 'indisponível';
      }
    }
    const activeTenants = count('ACTIVE') + count('PAST_DUE') + count('CANCEL_AT_PERIOD_END');
    return {
      mrrCents: mrr,
      tenants: { active: activeTenants, pendingPayment: count('PENDING_PAYMENT'), pastDue: count('PAST_DUE'), suspended: count('SUSPENDED'), canceled: count('CANCELED') },
      churn30d: churned,
      churnRatePercent: activeTenants + churned ? Math.round((churned / (activeTenants + churned)) * 1000) / 10 : 0,
      storageBytes: storage._sum.sizeBytes ?? 0,
      messagesSent30d: messages,
      activeBranches: branches,
      activeUsers: users,
      billing: { failedWebhooks, reconciliationIssues30d: unmatched },
      jobs,
      integrations: integrationStatus(this.env),
    };
  }

  plans() {
    return this.db.plan.findMany({ orderBy: { sortOrder: 'asc' }, include: { priceHistory: { orderBy: { version: 'desc' } }, _count: { select: { subscriptions: true } } } });
  }

  async createPlan(input: z.infer<typeof platformPlanSchema>) {
    const p = await this.db.$transaction(async (tx) => {
      const plan = await tx.plan.create({
        data: {
          ...input,
          currency: 'BRL',
          billingPeriod: 'MONTHLY',
          limitsJson: { maxBranches: input.maxBranches, maxTechniciansPerBranch: input.maxTechniciansPerBranch, maxCashRegistersPerBranch: input.maxCashRegistersPerBranch },
        },
      });
      await tx.planPriceHistory.create({ data: { planId: plan.id, version: 1, priceCents: plan.priceCents, effectiveAt: new Date(), createdBy: auth().userId } });
      return plan;
    });
    await this.log('plan_created', 'plan', p.id, { code: p.code });
    return p;
  }

  /** Mudança de preço cria nova versão; assinaturas existentes mantêm o preço travado. */
  async updatePlan(id: string, input: Partial<z.infer<typeof platformPlanSchema>>) {
    const current = await this.db.plan.findUnique({ where: { id } });
    if (!current) throw Errors.notFound('Plano');
    const p = await this.db.$transaction(async (tx) => {
      const priceChanged = input.priceCents !== undefined && input.priceCents !== current.priceCents;
      const plan = await tx.plan.update({
        where: { id },
        data: {
          name: input.name,
          active: input.active,
          sortOrder: input.sortOrder,
          maxBranches: input.maxBranches,
          maxTechniciansPerBranch: input.maxTechniciansPerBranch,
          maxCashRegistersPerBranch: input.maxCashRegistersPerBranch,
          ...(priceChanged ? { priceCents: input.priceCents, priceVersion: { increment: 1 } } : {}),
        },
      });
      if (priceChanged) {
        await tx.planPriceHistory.create({ data: { planId: id, version: plan.priceVersion, priceCents: plan.priceCents, effectiveAt: new Date(), createdBy: auth().userId } });
      }
      return plan;
    });
    await this.log('plan_updated', 'plan', id, { fields: Object.keys(input) });
    return p;
  }

  async tenants(q: { search?: string; status?: string; page: number; pageSize: number }) {
    const where: Prisma.TenantWhereInput = {
      status: q.status as Prisma.EnumTenantStatusFilter['equals'],
      ...(q.search ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { document: q.search }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.tenant.findMany({
        where,
        select: {
          id: true, name: true, document: true, status: true, createdAt: true,
          subscription: { select: { status: true, paymentMode: true, priceCents: true, currentPeriodEnd: true, plan: { select: { code: true, name: true } } } },
          _count: { select: { branches: true, memberships: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.tenant.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  async tenant(id: string) {
    const t = await this.db.tenant.findUnique({
      where: { id },
      select: {
        id: true, name: true, legalName: true, document: true, status: true, createdAt: true, onboardingCompletedAt: true,
        subscription: { include: { plan: true, scheduledPlan: true } },
        billingInvoices: { orderBy: { periodStart: 'desc' }, take: 24 },
        _count: { select: { branches: true, memberships: true, customers: true, messagingChannels: true } },
      },
    });
    if (!t) throw Errors.notFound('Empresa');
    const storage = await this.db.serviceOrderFile.aggregate({ where: { tenantId: id }, _sum: { sizeBytes: true } });
    const orders = await this.db.serviceOrder.count({ where: { tenantId: id } });
    await this.log('tenant_viewed', 'tenant', id);
    return { ...t, usage: { storageBytes: storage._sum.sizeBytes ?? 0, serviceOrders: orders } };
  }

  async setTenantStatus(id: string, input: z.infer<typeof platformTenantStatusSchema>) {
    const t = await this.db.tenant.findUnique({ where: { id } });
    if (!t) throw Errors.notFound('Empresa');
    await this.db.tenant.update({ where: { id }, data: { status: input.status } });
    await this.db.billingAuditLog.create({ data: { tenantId: id, actorId: auth().userId, action: `manual_${input.status.toLowerCase()}`, entity: 'tenant', entityId: id, metadataJson: { reason: input.reason } } });
    await this.log('tenant_status', 'tenant', id, { status: input.status, reason: input.reason });
    this.subscriptions.invalidate(id);
    return { ok: true };
  }

  subscriptionsList(q: { status?: string; page: number; pageSize: number }) {
    const where: Prisma.SubscriptionWhereInput = { status: q.status as Prisma.EnumSubscriptionStatusFilter['equals'] };
    return Promise.all([
      this.db.subscription.findMany({ where, include: { plan: { select: { code: true } }, tenant: { select: { name: true } } }, orderBy: { updatedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.db.subscription.count({ where }),
    ]).then(([items, total]) => ({ items, total, page: q.page, pageSize: q.pageSize }));
  }

  invoicesList(q: { status?: string; page: number; pageSize: number }) {
    const where: Prisma.BillingInvoiceWhereInput = { status: q.status as Prisma.EnumInvoiceStatusFilter['equals'] };
    return Promise.all([
      this.db.billingInvoice.findMany({ where, include: { tenant: { select: { name: true } }, plan: { select: { code: true } } }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.db.billingInvoice.count({ where }),
    ]).then(([items, total]) => ({ items, total, page: q.page, pageSize: q.pageSize }));
  }

  billingEvents(q: { status?: string; page: number; pageSize: number }) {
    const where: Prisma.BillingWebhookEventWhereInput = { status: q.status as Prisma.EnumWebhookEventStatusFilter['equals'] };
    return Promise.all([
      this.db.billingWebhookEvent.findMany({ where, orderBy: { receivedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.db.billingWebhookEvent.count({ where }),
    ]).then(([items, total]) => ({ items, total, page: q.page, pageSize: q.pageSize }));
  }

  async reprocessEvent(id: string) {
    const ev = await this.db.billingWebhookEvent.findUnique({ where: { id } });
    if (!ev) throw Errors.notFound('Evento');
    if (!ev.signatureValid) throw Errors.precondition('Evento com assinatura inválida não é reprocessado');
    await this.db.billingWebhookEvent.update({ where: { id }, data: { status: 'RECEIVED', attempts: 0, error: null } });
    await this.queues.add('billing', 'webhook', { kind: 'webhook', eventId: id });
    await this.log('billing_event_reprocessed', 'billing_webhook_event', id);
    return { queued: true };
  }

  async runReconciliation() {
    await this.queues.add('billing', 'reconcile', { kind: 'reconcile' });
    await this.log('reconciliation_requested', 'billing', null);
    return { queued: true };
  }

  reconciliationIssues() {
    return this.db.billingAuditLog.findMany({
      where: { action: { in: ['payment_unmatched', 'payment_amount_mismatch', 'duplicate_payment_requires_refund', 'proration_reversed_review_required', 'coverage_revoked'] } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async auditTrail(q: { page: number; pageSize: number; tenantId?: string; action?: string }) {
    const where: Prisma.AuditLogWhereInput = {
      tenantId: q.tenantId,
      action: q.action ? { contains: q.action } : undefined,
      ...(q.tenantId ? {} : { OR: [{ tenantId: null }, { actorType: 'SUPPORT' }, { action: { startsWith: 'support_' } }] }),
    };
    const [items, total] = await Promise.all([
      this.db.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.db.auditLog.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  async jobs() {
    const out: Record<string, unknown> = {};
    for (const name of Object.values(QUEUES)) {
      const q = this.queues.queue(name);
      const failed = await q.getFailed(0, 49);
      out[name] = {
        counts: await q.getJobCounts('waiting', 'active', 'failed', 'delayed', 'completed'),
        failed: failed.map((j) => ({ id: j.id, name: j.name, attemptsMade: j.attemptsMade, failedReason: j.failedReason?.slice(0, 300), finishedOn: j.finishedOn })),
      };
    }
    return out;
  }

  async retryJob(queue: string, id: string) {
    if (!Object.values(QUEUES).includes(queue as QueueName)) throw Errors.notFound('Fila');
    const job = await this.queues.queue(queue as QueueName).getJob(id);
    if (!job) throw Errors.notFound('Job');
    await job.retry();
    await this.log('job_retried', 'job', `${queue}:${id}`);
    return { ok: true };
  }

  async getSettings() {
    const s = await this.db.platformSetting.findUnique({ where: { key: 'billing.grace_days' } });
    return { graceDays: Number((s?.valueJson as { value?: number } | null)?.value ?? 3) };
  }

  async putSettings(input: z.infer<typeof platformSettingSchema>) {
    if (input.graceDays !== undefined) {
      await this.db.platformSetting.upsert({
        where: { key: 'billing.grace_days' },
        create: { key: 'billing.grace_days', valueJson: { value: input.graceDays }, updatedBy: auth().userId },
        update: { valueJson: { value: input.graceDays }, updatedBy: auth().userId },
      });
      await this.log('settings_updated', 'platform_setting', 'billing.grace_days', { graceDays: input.graceDays });
    }
    return this.getSettings();
  }

  billingReviews() {
    return this.db.messagingChannel.findMany({
      where: { billingStatus: 'PENDING_REVIEW' },
      select: {
        id: true, name: true, tenantId: true, externalWabaId: true, displayPhoneMasked: true, status: true, updatedAt: true,
        tenant: { select: { name: true } },
        billingChecks: { orderBy: { checkedAt: 'desc' }, take: 5 },
      },
    });
  }

  /** Validação auditada do faturamento próprio da WABA (sem linha de crédito da plataforma). */
  async decideBillingReview(channelId: string, approve: boolean, notes: string) {
    const c = await this.db.messagingChannel.findUnique({ where: { id: channelId } });
    if (!c) throw Errors.notFound('Canal');
    await this.db.$transaction(async (tx) => {
      await tx.messagingBillingCheck.create({
        data: { tenantId: c.tenantId, channelId, status: approve ? 'VERIFIED_OWN_BILLING' : 'REJECTED', method: 'ASSISTED', checkedBy: auth().userId, notes },
      });
      await tx.messagingChannel.update({
        where: { id: channelId },
        data: approve
          ? {
              billingStatus: 'VERIFIED_OWN_BILLING',
              billingVerifiedAt: new Date(),
              billingVerificationMethod: 'ASSISTED',
              status: c.encryptedCredentialsRef ? 'ACTIVE' : 'NOT_CONNECTED',
            }
          : { billingStatus: 'REJECTED', status: 'BILLING_REVIEW_REQUIRED' },
      });
    });
    await this.log(approve ? 'messaging_billing_approved' : 'messaging_billing_rejected', 'messaging_channel', channelId, { notes });
    return { ok: true };
  }
}
