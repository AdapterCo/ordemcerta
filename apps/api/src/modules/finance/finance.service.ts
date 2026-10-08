import { Injectable } from '@nestjs/common';
import type { LedgerEntryType, PaymentMethod, Receivable } from '@prisma/client';
import type { Tx } from '@ordemcerta/server';
import { ErrorCode, PAYMENT_METHOD_LABELS, type OrderPaymentStatus } from '@ordemcerta/shared';
import { auth, can } from '../../core/context';
import type { TxHooks } from '../../core/database';
import { DomainError, Errors } from '../../core/errors';
import { AuditService, OutboxService } from '../../core/services';
import { SettingsService } from '../../core/settings.service';

export interface PaymentPart {
  method: PaymentMethod;
  amountCents: number;
  tenderedCents?: number;
  externalReference?: string;
}

export interface LedgerEntry {
  branchId: string;
  sourceType: string;
  sourceId: string;
  entryType: LedgerEntryType;
  amountCents: number;
  method?: PaymentMethod | null;
  memo?: string;
}

/**
 * Motor financeiro único para OS e PDV. Princípios:
 *  - Faturamento ≠ recebimento ≠ lucro; sangria não é despesa.
 *  - Uma cobrança (receivable) por origem: OS e venda nunca duplicam cobrança.
 *  - Ledger imutável; correções por lançamento compensatório.
 *  - Sem integração de adquirência: recebimento registrado como MANUAL.
 */
@Injectable()
export class FinanceService {
  constructor(
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly settings: SettingsService,
  ) {}

  outstanding(r: Pick<Receivable, 'amountCents' | 'paidCents' | 'refundedCents'>) {
    return r.amountCents - (r.paidCents - r.refundedCents);
  }

  private receivableStatus(r: Pick<Receivable, 'amountCents' | 'paidCents' | 'refundedCents'>): Receivable['status'] {
    const net = r.paidCents - r.refundedCents;
    if (r.refundedCents > 0 && net === 0) return 'REFUNDED';
    if (net >= r.amountCents) return 'PAID';
    if (net > 0) return 'PARTIALLY_PAID';
    return 'OPEN';
  }

  orderPaymentStatus(r: Pick<Receivable, 'amountCents' | 'paidCents' | 'refundedCents'> | null): OrderPaymentStatus {
    if (!r) return 'UNBILLED';
    const net = r.paidCents - r.refundedCents;
    if (r.refundedCents > 0 && net === 0 && r.paidCents > 0) return 'REFUNDED';
    if (r.refundedCents > 0) return net >= r.amountCents ? 'PARTIALLY_REFUNDED' : 'PARTIALLY_REFUNDED';
    if (net >= r.amountCents) return 'PAID';
    if (net > 0) return 'PARTIALLY_PAID';
    return 'UNPAID';
  }

  async postLedger(tx: Tx, tenantId: string, entries: LedgerEntry[]) {
    if (!entries.length) return;
    await tx.financialLedger.createMany({
      data: entries.filter((e) => e.amountCents !== 0).map((e) => ({ tenantId, ...e, method: e.method ?? null, memo: e.memo ?? null })),
    });
  }

  async syncOrderPaymentStatus(tx: Tx, tenantId: string, orderId: string) {
    const r = await tx.receivable.findUnique({ where: { tenantId_sourceType_sourceId: { tenantId, sourceType: 'SERVICE_ORDER', sourceId: orderId } } });
    await tx.serviceOrder.update({ where: { id: orderId }, data: { paymentStatus: this.orderPaymentStatus(r) } });
  }

  /** Cria/ajusta a cobrança da OS (valor do orçamento aprovado ou taxa de diagnóstico). */
  async upsertOrderReceivable(tx: Tx, tenantId: string, order: { id: string; branchId: string; customerId: string }, amountCents: number) {
    const key = { tenantId_sourceType_sourceId: { tenantId, sourceType: 'SERVICE_ORDER' as const, sourceId: order.id } };
    const r = await tx.receivable.findUnique({ where: key });
    if (!r) {
      if (amountCents > 0) {
        await tx.receivable.create({
          data: { tenantId, branchId: order.branchId, sourceType: 'SERVICE_ORDER', sourceId: order.id, customerId: order.customerId, amountCents, status: 'OPEN' },
        });
      }
    } else {
      const net = r.paidCents - r.refundedCents;
      if (net > amountCents) throw Errors.precondition('Valor já recebido excede o novo total da OS; registre o estorno da diferença antes');
      const next = { amountCents, paidCents: r.paidCents, refundedCents: r.refundedCents };
      await tx.receivable.update({ where: { id: r.id }, data: { amountCents, status: this.receivableStatus(next), version: { increment: 1 } } });
    }
    await this.syncOrderPaymentStatus(tx, tenantId, order.id);
  }

  /** Registro de recebimento em sessão de caixa aberta, com alocação às cobranças. */
  async receive(
    tx: Tx,
    hooks: TxHooks,
    args: {
      tenantId: string;
      branchId: string;
      cashSessionId: string;
      receivableId: string;
      parts: PaymentPart[];
      idempotencyKey: string;
      notes?: string | null;
      customerId?: string | null;
    },
  ) {
    const { tenantId } = args;
    const actor = auth();
    const session = await this.lockOpenSession(tx, tenantId, args.cashSessionId, args.branchId);
    if (session.openedBy !== actor.userId && !can('cash:view_all')) throw Errors.forbidden('Use a sua própria sessão de caixa');

    const enabled = await this.settings.get(tx, tenantId, 'payments.enabled_methods', args.branchId);
    for (const p of args.parts) {
      if (!enabled.includes(p.method)) throw Errors.validation(`Meio de pagamento desabilitado: ${PAYMENT_METHOD_LABELS[p.method]}`);
      if (p.tenderedCents !== undefined && p.method !== 'CASH') throw Errors.validation('Troco só se aplica a dinheiro');
      if (p.tenderedCents !== undefined && p.tenderedCents < p.amountCents) throw Errors.validation('Valor entregue menor que o valor pago');
    }

    await tx.$queryRaw`SELECT id FROM receivables WHERE id = ${args.receivableId}::uuid FOR UPDATE`;
    const r = await tx.receivable.findFirst({ where: { id: args.receivableId, tenantId } });
    if (!r) throw Errors.notFound('Cobrança');
    if (r.branchId !== args.branchId) throw Errors.validation('Cobrança de outra filial');
    if (r.status === 'CANCELED') throw Errors.precondition('Cobrança cancelada');
    const total = args.parts.reduce((s, p) => s + p.amountCents, 0);
    const open = this.outstanding(r);
    if (total > open) {
      throw new DomainError(ErrorCode.PAYMENT_EXCEEDS_BALANCE, 'Valor maior que o saldo em aberto', 409, { outstandingCents: open, receivedCents: total });
    }

    const payments = [];
    for (const [i, p] of args.parts.entries()) {
      const changeCents = p.method === 'CASH' && p.tenderedCents ? p.tenderedCents - p.amountCents : 0;
      const payment = await tx.payment.create({
        data: {
          tenantId,
          branchId: args.branchId,
          cashSessionId: session.id,
          method: p.method,
          amountCents: p.amountCents,
          tenderedCents: p.tenderedCents ?? null,
          changeCents,
          provider: 'MANUAL',
          isManual: true,
          externalId: p.externalReference ?? null,
          idempotencyKey: `${args.idempotencyKey}:${i}`,
          receivedBy: actor.userId,
          notes: args.notes ?? null,
        },
      });
      await tx.paymentAllocation.create({ data: { tenantId, paymentId: payment.id, receivableId: r.id, amountCents: p.amountCents } });
      await tx.cashMovement.create({
        data: { tenantId, cashSessionId: session.id, type: 'PAYMENT_IN', method: p.method, amountCents: p.amountCents, paymentId: payment.id, actorId: actor.userId },
      });
      payments.push(payment);
    }
    const paidCents = r.paidCents + total;
    await tx.receivable.update({
      where: { id: r.id },
      data: { paidCents, status: this.receivableStatus({ amountCents: r.amountCents, paidCents, refundedCents: r.refundedCents }), version: { increment: 1 } },
    });
    await this.postLedger(
      tx,
      tenantId,
      payments.map((p) => ({ branchId: args.branchId, sourceType: 'PAYMENT', sourceId: p.id, entryType: 'PAYMENT_RECEIVED' as const, amountCents: p.amountCents, method: p.method })),
    );
    if (r.sourceType === 'SERVICE_ORDER') await this.syncOrderPaymentStatus(tx, tenantId, r.sourceId);
    await this.audit.log(tx, { action: 'payment_received', entity: 'receivable', entityId: r.id, metadata: { totalCents: total, parts: args.parts.length } });
    await this.outbox.add(tx, hooks, tenantId, {
      eventType: 'payment.received',
      aggregateType: 'receivable',
      aggregateId: r.id,
      payload: { receivableId: r.id, sourceType: r.sourceType, sourceId: r.sourceId, totalCents: total },
    });
    return { payments, receivableId: r.id, outstandingCents: open - total, changeCents: payments.reduce((s, p) => s + p.changeCents, 0) };
  }

  /** Estorno parcial/total; movimenta o caixa e o ledger por lançamento compensatório. */
  async refund(tx: Tx, args: { tenantId: string; paymentId: string; amountCents: number; reason: string; cashSessionId: string }) {
    const { tenantId } = args;
    const actor = auth();
    await tx.$queryRaw`SELECT id FROM payments WHERE id = ${args.paymentId}::uuid FOR UPDATE`;
    const payment = await tx.payment.findFirst({ where: { id: args.paymentId, tenantId }, include: { allocations: true } });
    if (!payment) throw Errors.notFound('Pagamento');
    const session = await this.lockOpenSession(tx, tenantId, args.cashSessionId, payment.branchId);
    const remaining = payment.amountCents - payment.refundedCents;
    if (args.amountCents > remaining) throw Errors.validation('Valor do estorno maior que o disponível', { remainingCents: remaining });

    const refund = await tx.refund.create({
      data: { tenantId, paymentId: payment.id, cashSessionId: session.id, amountCents: args.amountCents, reason: args.reason, createdBy: actor.userId },
    });
    const refunded = payment.refundedCents + args.amountCents;
    await tx.payment.update({
      where: { id: payment.id },
      data: { refundedCents: refunded, status: refunded === payment.amountCents ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
    });
    await tx.cashMovement.create({
      data: { tenantId, cashSessionId: session.id, type: 'REFUND_OUT', method: payment.method, amountCents: args.amountCents, paymentId: payment.id, reason: args.reason, actorId: actor.userId },
    });

    let left = args.amountCents;
    for (const alloc of payment.allocations) {
      if (left <= 0) break;
      await tx.$queryRaw`SELECT id FROM receivables WHERE id = ${alloc.receivableId}::uuid FOR UPDATE`;
      const r = await tx.receivable.findUniqueOrThrow({ where: { id: alloc.receivableId } });
      const take = Math.min(left, alloc.amountCents, r.paidCents - r.refundedCents);
      if (take <= 0) continue;
      const refundedCents = r.refundedCents + take;
      await tx.receivable.update({
        where: { id: r.id },
        data: { refundedCents, status: this.receivableStatus({ amountCents: r.amountCents, paidCents: r.paidCents, refundedCents }), version: { increment: 1 } },
      });
      if (r.sourceType === 'SERVICE_ORDER') await this.syncOrderPaymentStatus(tx, tenantId, r.sourceId);
      left -= take;
    }
    await this.postLedger(tx, tenantId, [
      { branchId: payment.branchId, sourceType: 'REFUND', sourceId: refund.id, entryType: 'REFUND', amountCents: -args.amountCents, method: payment.method, memo: args.reason.slice(0, 300) },
    ]);
    await this.audit.log(tx, { action: 'payment_refunded', entity: 'payment', entityId: payment.id, metadata: { amountCents: args.amountCents } });
    return refund;
  }

  async lockOpenSession(tx: Tx, tenantId: string, sessionId: string, branchId: string) {
    await tx.$queryRaw`SELECT id FROM cash_sessions WHERE id = ${sessionId}::uuid FOR UPDATE`;
    const s = await tx.cashSession.findFirst({ where: { id: sessionId, tenantId } });
    if (!s || s.status !== 'OPEN') throw new DomainError(ErrorCode.CASH_SESSION_REQUIRED, 'Abra o caixa para registrar recebimentos', 409);
    if (s.branchId !== branchId) throw Errors.validation('Sessão de caixa de outra filial');
    return s;
  }
}
