import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type Quote, type ServiceOrder } from '@prisma/client';
import { randomToken, sha256Hex, type Tx } from '@ordemcerta/server';
import { computeTotals, createQuoteSchema, discountPercent, ErrorCode, manualApproveQuoteSchema } from '@ordemcerta/shared';
import type { z } from 'zod';
import { assertBranch, auth, can, currentTenantId } from '../../core/context';
import { TenantDb, type TxHooks } from '../../core/database';
import { ENV, type AppEnv } from '../../core/env.provider';
import { DomainError, Errors } from '../../core/errors';
import { AuditService, CryptoService, OutboxService } from '../../core/services';
import { SettingsService } from '../../core/settings.service';
import { FinanceService } from '../finance/finance.service';
import { quoteContentHash, quoteLink } from './order-helpers';
import { ServiceOrdersService } from './service-orders.service';

const QUOTABLE = ['DIAGNOSING', 'WAITING_QUOTE_APPROVAL', 'REJECTED', 'REOPENED'];

export interface ApprovalEvidence {
  method: 'IN_PERSON' | 'PHONE' | 'PORTAL';
  customerName?: string;
  signerName?: string;
  actorId?: string | null;
  acceptText?: string;
  otpVerified?: boolean;
  ipHash?: string | null;
  userAgent?: string | null;
  notes?: string | null;
}

@Injectable()
export class QuotesService {
  constructor(
    private readonly db: TenantDb,
    private readonly orders: ServiceOrdersService,
    private readonly finance: FinanceService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly crypto: CryptoService,
    @Inject(ENV) private readonly env: AppEnv,
  ) {}

  list(orderId: string) {
    return this.db.run(async (tx) => {
      const o = await this.orders.load(tx, orderId);
      return tx.quote.findMany({ where: { tenantId: o.tenantId, orderId }, include: { lines: { orderBy: { position: 'asc' } } }, orderBy: { version: 'desc' } });
    });
  }

  /** Nova versão: versões não finalizadas anteriores são substituídas. */
  create(orderId: string, input: z.infer<typeof createQuoteSchema>) {
    return this.db.run(async (tx) => {
      const o = await this.orders.load(tx, orderId);
      if (!QUOTABLE.includes(o.technicalStatus)) throw Errors.precondition('Orçamento só pode ser criado durante o diagnóstico/aprovação');
      const tenantId = o.tenantId;

      const productIds = input.lines.map((l) => l.productId).filter(Boolean) as string[];
      const products = productIds.length ? await tx.product.findMany({ where: { tenantId, id: { in: productIds } } }) : [];
      const byId = new Map(products.map((p) => [p.id, p]));
      const lines = input.lines.map((l, i) => {
        const p = l.productId ? byId.get(l.productId) : undefined;
        if (l.productId && !p) throw Errors.validation('Produto inválido');
        return { ...l, position: i, productId: l.productId ?? null, unitCostCents: l.unitCostCents || p?.costCents || 0 };
      });
      let totals;
      try {
        totals = computeTotals(lines, input.discountCents);
      } catch (e) {
        throw Errors.validation((e as Error).message);
      }
      if (totals.discountCents > 0 && !can('sales:discount')) {
        const max = await this.settings.get(tx, tenantId, 'sales.max_discount_percent_without_permission', o.branchId);
        if (discountPercent(totals.subtotalCents, totals.discountCents) > max) {
          throw new DomainError(ErrorCode.DISCOUNT_NOT_ALLOWED, 'Desconto acima do autorizado para o seu perfil', 403, { maxPercent: max });
        }
      }
      const last = await tx.quote.aggregate({ where: { tenantId, orderId }, _max: { version: true } });
      const version = (last._max.version ?? 0) + 1;
      const expiresAt = new Date(Date.now() + input.validDays * 86_400_000);
      await tx.quote.updateMany({ where: { tenantId, orderId, status: { in: ['DRAFT', 'SENT'] } }, data: { status: 'SUPERSEDED' } });
      await tx.quoteAccessToken.updateMany({ where: { tenantId, quote: { orderId }, revokedAt: null }, data: { revokedAt: new Date() } });
      const contentHash = quoteContentHash({ orderId, version, ...totals, expiresAt, lines });
      const q = await tx.quote.create({
        data: {
          tenantId,
          orderId,
          version,
          status: 'DRAFT',
          ...totals,
          estimatedDays: input.estimatedDays,
          notes: input.notes,
          expiresAt,
          contentHash,
          createdBy: auth().userId,
          lines: {
            create: lines.map((l) => ({
              tenantId,
              position: l.position,
              kind: l.kind,
              productId: l.productId,
              description: l.description,
              qty: l.qty,
              unitPriceCents: l.unitPriceCents,
              unitCostCents: l.unitCostCents,
              discountCents: l.discountCents,
              warrantyDays: l.warrantyDays,
            })),
          },
        },
        include: { lines: true },
      });
      await tx.serviceOrderEvent.create({ data: { tenantId, orderId, actorId: auth().userId, eventType: 'quote_created', payloadJson: { quoteId: q.id, version, totalCents: q.totalCents } } });
      await this.audit.log(tx, { action: 'quote_created', entity: 'quote', entityId: q.id, metadata: { version, totalCents: q.totalCents } });
      return q;
    });
  }

  private async loadQuote(tx: Tx, quoteId: string) {
    const q = await tx.quote.findFirst({ where: { id: quoteId, tenantId: currentTenantId() } });
    if (!q) throw Errors.notFound('Orçamento');
    const o = await this.orders.load(tx, q.orderId);
    return { q, o };
  }

  /** Envio: gera link opaco de uso limitado e move a OS para aguardando aprovação. */
  send(quoteId: string) {
    return this.db.run(async (tx, hooks) => {
      const { q, o } = await this.loadQuote(tx, quoteId);
      if (q.status !== 'DRAFT' && q.status !== 'SENT') throw Errors.conflict('Orçamento não pode ser enviado neste estado');
      if (q.expiresAt < new Date()) throw Errors.precondition('Orçamento expirado; crie nova versão');
      let order = o;
      if (o.technicalStatus === 'DIAGNOSING') {
        order = await this.orders.transition(tx, hooks, o, o.version, {
          to: 'WAITING_QUOTE_APPROVAL',
          action: 'submit-diagnosis',
          eventType: 'quote_sent_awaiting_approval',
          system: true,
        });
      } else if (o.technicalStatus !== 'WAITING_QUOTE_APPROVAL') {
        throw Errors.precondition('A OS precisa estar em diagnóstico ou aguardando aprovação');
      }
      await tx.quoteAccessToken.updateMany({ where: { tenantId: q.tenantId, quoteId: q.id, revokedAt: null }, data: { revokedAt: new Date() } });
      const token = randomToken(24);
      await tx.quoteAccessToken.create({ data: { tenantId: q.tenantId, quoteId: q.id, tokenHash: sha256Hex(token), expiresAt: q.expiresAt } });
      await tx.quote.update({ where: { id: q.id }, data: { status: 'SENT', sentAt: q.sentAt ?? new Date() } });
      await tx.serviceOrderEvent.create({ data: { tenantId: q.tenantId, orderId: q.orderId, actorId: auth().userId, eventType: 'quote_sent', payloadJson: { quoteId: q.id, version: q.version } } });
      await this.audit.log(tx, { action: 'quote_sent', entity: 'quote', entityId: q.id });
      await this.outbox.add(tx, hooks, q.tenantId, {
        eventType: 'quote.sent',
        aggregateType: 'service_order',
        aggregateId: q.orderId,
        payload: { orderId: q.orderId, number: order.number, quoteId: q.id, totalCents: q.totalCents, customerId: o.customerId, branchId: o.branchId, quoteTokenEnc: this.crypto.encrypt(token) },
      });
      return { quoteId: q.id, status: 'SENT', quoteUrl: quoteLink(this.env.APP_URL, token), expiresAt: q.expiresAt };
    });
  }

  /** Aplica aprovação vinculada à versão exata (usado pelo balcão e pelo portal). */
  async applyApproval(tx: Tx, hooks: TxHooks, q: Quote, o: ServiceOrder, evidence: ApprovalEvidence, system: boolean) {
    if (q.status !== 'SENT' && !(q.status === 'DRAFT' && !system)) throw Errors.conflict('Orçamento não está disponível para aprovação');
    if (q.expiresAt < new Date()) throw Errors.precondition('Orçamento expirado');
    const updated = await tx.quote.updateMany({
      where: { id: q.id, status: q.status, contentHash: q.contentHash },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
        approvedByCustomerId: o.customerId,
        approvalEvidenceJson: { ...evidence, version: q.version, contentHash: q.contentHash, totalCents: q.totalCents, at: new Date().toISOString() } as Prisma.InputJsonValue,
      },
    });
    if (updated.count !== 1) throw Errors.conflict('Orçamento alterado durante a aprovação; recarregue');
    await tx.quote.updateMany({ where: { tenantId: q.tenantId, orderId: q.orderId, status: 'APPROVED', NOT: { id: q.id } }, data: { status: 'SUPERSEDED' } });
    await tx.quoteAccessToken.updateMany({ where: { tenantId: q.tenantId, quoteId: q.id, revokedAt: null }, data: { usedAt: new Date(), revokedAt: new Date() } });
    const order = await this.orders.transition(tx, hooks, o, o.version, {
      to: 'APPROVED',
      action: 'approve',
      eventType: 'quote_approved',
      system,
      data: { approvedQuoteId: q.id, totalCents: q.totalCents },
      payload: { quoteId: q.id, version: q.version, method: evidence.method },
    });
    await this.finance.upsertOrderReceivable(tx, q.tenantId, o, q.totalCents);
    await this.outbox.add(tx, hooks, q.tenantId, {
      eventType: 'quote.approved',
      aggregateType: 'service_order',
      aggregateId: q.orderId,
      payload: { orderId: q.orderId, number: o.number, quoteId: q.id, customerId: o.customerId, branchId: o.branchId },
    });
    return order;
  }

  async applyRejection(tx: Tx, hooks: TxHooks, q: Quote, o: ServiceOrder, reason: string, evidence: ApprovalEvidence, system: boolean) {
    if (q.status !== 'SENT' && !(q.status === 'DRAFT' && !system)) throw Errors.conflict('Orçamento não está disponível para decisão');
    await tx.quote.update({
      where: { id: q.id },
      data: { status: 'REJECTED', rejectedAt: new Date(), rejectionReason: reason, approvalEvidenceJson: { ...evidence, decision: 'REJECTED', at: new Date().toISOString() } as Prisma.InputJsonValue },
    });
    await tx.quoteAccessToken.updateMany({ where: { tenantId: q.tenantId, quoteId: q.id, revokedAt: null }, data: { usedAt: new Date(), revokedAt: new Date() } });
    const order = await this.orders.transition(tx, hooks, o, o.version, {
      to: 'REJECTED',
      action: 'reject',
      eventType: 'quote_rejected',
      system,
      payload: { quoteId: q.id, reason },
    });
    // Política de taxa de diagnóstico previamente informada no aceite.
    if (o.diagnosisFeeCents > 0) await this.finance.upsertOrderReceivable(tx, q.tenantId, o, o.diagnosisFeeCents);
    await this.outbox.add(tx, hooks, q.tenantId, {
      eventType: 'quote.rejected',
      aggregateType: 'service_order',
      aggregateId: q.orderId,
      payload: { orderId: q.orderId, number: o.number, quoteId: q.id, customerId: o.customerId, branchId: o.branchId },
    });
    return order;
  }

  approveManual(quoteId: string, input: z.infer<typeof manualApproveQuoteSchema>) {
    return this.db.run(async (tx, hooks) => {
      const { q, o } = await this.loadQuote(tx, quoteId);
      const order = await this.applyApproval(
        tx,
        hooks,
        q,
        o,
        { method: input.method, customerName: input.customerName, actorId: auth().userId, notes: input.notes, ipHash: null },
        false,
      );
      await this.audit.log(tx, { action: 'quote_approved_manual', entity: 'quote', entityId: q.id, metadata: { method: input.method } });
      return order;
    });
  }

  reject(quoteId: string, reason: string) {
    return this.db.run(async (tx, hooks) => {
      const { q, o } = await this.loadQuote(tx, quoteId);
      const order = await this.applyRejection(tx, hooks, q, o, reason, { method: 'IN_PERSON', actorId: auth().userId }, false);
      await this.audit.log(tx, { action: 'quote_rejected_manual', entity: 'quote', entityId: q.id });
      return order;
    });
  }

  get(quoteId: string) {
    return this.db.run(async (tx) => {
      const q = await tx.quote.findFirst({ where: { id: quoteId, tenantId: currentTenantId() }, include: { lines: { orderBy: { position: 'asc' } }, order: { select: { branchId: true, number: true } } } });
      if (!q) throw Errors.notFound('Orçamento');
      assertBranch(q.order.branchId);
      return q;
    });
  }
}
