import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { buildSaleReceiptPdf, nextCounter } from '@ordemcerta/server';
import {
  computeTotals,
  confirmSaleSchema,
  createSaleSchema,
  discountPercent,
  ErrorCode,
  PAYMENT_METHOD_LABELS,
  paginationSchema,
  refundSaleSchema,
} from '@ordemcerta/shared';
import { z } from 'zod';
import { assertBranch, auth, branchScope, can, currentTenantId } from '../../core/context';
import { bumpVersion, TenantDb } from '../../core/database';
import { DomainError, Errors } from '../../core/errors';
import { AuditService, OutboxService } from '../../core/services';
import { SettingsService } from '../../core/settings.service';
import { FinanceService } from '../finance/finance.service';
import { StockService } from '../stock/stock.service';

export const saleQuerySchema = paginationSchema.extend({
  branchId: z.string().uuid().optional(),
  status: z.enum(['DRAFT', 'CONFIRMED', 'CANCELED', 'REFUNDED', 'PARTIALLY_REFUNDED']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  orderId: z.string().uuid().optional(),
});

/**
 * PDV: venda em rascunho → confirmação atômica (estoque + cobrança +
 * pagamentos + caixa + ledger). Venda confirmada nunca é apagada; somente
 * estornada. Comprovante NÃO FISCAL.
 */
@Injectable()
export class SalesService {
  constructor(
    private readonly db: TenantDb,
    private readonly stock: StockService,
    private readonly finance: FinanceService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  list(q: z.infer<typeof saleQuerySchema>) {
    if (q.branchId) assertBranch(q.branchId);
    return this.db.run(async (tx) => {
      const where: Prisma.SaleWhereInput = {
        tenantId: currentTenantId(),
        branchId: q.branchId ?? branchScope(),
        status: q.status,
        orderId: q.orderId,
        createdAt: { gte: q.from, lte: q.to },
      };
      const [items, total] = await Promise.all([
        tx.sale.findMany({ where, include: { items: true }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
        tx.sale.count({ where }),
      ]);
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  get(id: string) {
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      const s = await tx.sale.findFirst({ where: { id, tenantId }, include: { items: { include: { product: { select: { sku: true, kind: true } } } } } });
      if (!s) throw Errors.notFound('Venda');
      assertBranch(s.branchId);
      const receivable = await tx.receivable.findUnique({ where: { tenantId_sourceType_sourceId: { tenantId, sourceType: 'SALE', sourceId: id } } });
      const payments = receivable
        ? await tx.payment.findMany({ where: { tenantId, allocations: { some: { receivableId: receivable.id } } }, include: { refunds: true } })
        : [];
      return { ...s, receivable, payments };
    });
  }

  create(input: z.infer<typeof createSaleSchema>) {
    assertBranch(input.branchId);
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      if (input.customerId && !(await tx.customer.count({ where: { id: input.customerId, tenantId } }))) throw Errors.notFound('Cliente');
      if (input.orderId) {
        const o = await tx.serviceOrder.findFirst({ where: { id: input.orderId, tenantId }, select: { branchId: true } });
        if (!o) throw Errors.notFound('OS');
      }
      const products = await tx.product.findMany({ where: { tenantId, id: { in: input.items.map((i) => i.productId) }, active: true } });
      const byId = new Map(products.map((p) => [p.id, p]));
      let priceOverride = false;
      const lines = input.items.map((i) => {
        const p = byId.get(i.productId);
        if (!p) throw Errors.validation('Produto inválido ou inativo');
        const catalog = p.promoPriceCents ?? p.priceCents;
        const unit = i.unitPriceCents ?? catalog;
        if (unit < catalog) priceOverride = true;
        return { product: p, qty: i.qty, unitPriceCents: unit, discountCents: i.discountCents };
      });
      let totals;
      try {
        totals = computeTotals(lines, input.discountCents);
      } catch (e) {
        throw Errors.validation((e as Error).message);
      }
      const catalogSubtotal = lines.reduce((s, l) => s + l.qty * (l.product.promoPriceCents ?? l.product.priceCents), 0);
      const effectiveDiscount = catalogSubtotal - totals.totalCents;
      if (effectiveDiscount > 0 || priceOverride) {
        const maxPct = await this.settings.get(tx, tenantId, 'sales.max_discount_percent_without_permission', input.branchId);
        if (!can('sales:discount') && discountPercent(catalogSubtotal, effectiveDiscount) > maxPct) {
          throw new DomainError(ErrorCode.DISCOUNT_NOT_ALLOWED, 'Desconto acima do permitido para o seu perfil', 403, { maxPercent: maxPct });
        }
      }
      const number = await nextCounter(tx, tenantId, 'sale');
      const sale = await tx.sale.create({
        data: {
          tenantId,
          branchId: input.branchId,
          number,
          customerId: input.customerId ?? null,
          orderId: input.orderId ?? null,
          createdBy: auth().userId,
          status: 'DRAFT',
          ...totals,
          items: {
            // tenantId herdado da venda (FK composta [tenantId, saleId]); não repetir no item.
            create: lines.map((l): Prisma.SaleItemUncheckedCreateWithoutSaleInput => ({
              productId: l.product.id,
              description: l.product.name,
              qty: l.qty,
              unitPriceCents: l.unitPriceCents,
              unitCostCents: l.product.costCents,
              discountCents: l.discountCents ?? 0,
            })),
          },
        },
        include: { items: true },
      });
      if (effectiveDiscount > 0) {
        await this.audit.log(tx, { action: 'sale_discount', entity: 'sale', entityId: sale.id, metadata: { discountCents: effectiveDiscount } });
      }
      return sale;
    });
  }

  /** Confirmação atômica: dupla confirmação/concorrência protegidas por versão + lock de estoque. */
  confirm(id: string, input: z.infer<typeof confirmSaleSchema>, idempotencyKey: string) {
    return this.db.run(async (tx, hooks) => {
      const tenantId = currentTenantId();
      await tx.$queryRaw`SELECT id FROM sales WHERE id = ${id}::uuid FOR UPDATE`;
      const sale = await tx.sale.findFirst({ where: { id, tenantId }, include: { items: true } });
      if (!sale) throw Errors.notFound('Venda');
      assertBranch(sale.branchId);
      if (sale.status !== 'DRAFT') throw Errors.conflict('Venda já confirmada ou cancelada');
      const paid = input.payments.reduce((s, p) => s + p.amountCents, 0);
      if (paid !== sale.totalCents) throw Errors.validation('A soma dos pagamentos deve ser igual ao total da venda', { totalCents: sale.totalCents, paidCents: paid });
      await bumpVersion(tx, 'sales', id, sale.version);

      const costs = await this.stock.saleOut(tx, { tenantId, branchId: sale.branchId, saleId: id, items: sale.items.map((i) => ({ productId: i.productId, qty: i.qty })) });
      const receivable = await tx.receivable.create({
        data: { tenantId, branchId: sale.branchId, sourceType: 'SALE', sourceId: id, customerId: sale.customerId, amountCents: sale.totalCents, status: 'OPEN' },
      });
      const result =
        sale.totalCents > 0
          ? await this.finance.receive(tx, hooks, {
              tenantId,
              branchId: sale.branchId,
              cashSessionId: input.cashSessionId,
              receivableId: receivable.id,
              parts: input.payments,
              idempotencyKey: `sale:${id}:${idempotencyKey}`,
              customerId: sale.customerId,
            })
          : { payments: [], changeCents: 0 };
      const cogs = sale.items.reduce((s, i) => s + i.qty * (costs.get(i.productId) ?? i.unitCostCents), 0);
      await this.finance.postLedger(tx, tenantId, [
        { branchId: sale.branchId, sourceType: 'SALE', sourceId: id, entryType: 'REVENUE_SALE', amountCents: sale.subtotalCents },
        { branchId: sale.branchId, sourceType: 'SALE', sourceId: id, entryType: 'DISCOUNT', amountCents: -sale.discountCents },
        { branchId: sale.branchId, sourceType: 'SALE', sourceId: id, entryType: 'COGS', amountCents: cogs },
      ]);
      const confirmed = await tx.sale.update({
        where: { id },
        data: { status: 'CONFIRMED', confirmedAt: new Date(), cashSessionId: input.cashSessionId },
        include: { items: true },
      });
      await this.audit.log(tx, { action: 'sale_confirmed', entity: 'sale', entityId: id, metadata: { totalCents: sale.totalCents } });
      await this.outbox.add(tx, hooks, tenantId, { eventType: 'sale.confirmed', aggregateType: 'sale', aggregateId: id, payload: { number: sale.number, totalCents: sale.totalCents } });
      return { sale: confirmed, changeCents: result.changeCents };
    });
  }

  cancel(id: string, reason: string) {
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      const sale = await tx.sale.findFirst({ where: { id, tenantId } });
      if (!sale) throw Errors.notFound('Venda');
      assertBranch(sale.branchId);
      if (sale.status !== 'DRAFT') throw Errors.precondition('Venda confirmada não pode ser cancelada; utilize o estorno');
      await tx.sale.update({ where: { id }, data: { status: 'CANCELED', canceledAt: new Date(), cancelReason: reason } });
      await this.audit.log(tx, { action: 'sale_canceled', entity: 'sale', entityId: id, metadata: { reason } });
      return { ok: true };
    });
  }

  /** Estorno/devolução de itens: dinheiro pelo meio original, estoque opcionalmente devolvido, ledger compensatório. */
  refund(id: string, input: z.infer<typeof refundSaleSchema>) {
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      await tx.$queryRaw`SELECT id FROM sales WHERE id = ${id}::uuid FOR UPDATE`;
      const sale = await tx.sale.findFirst({ where: { id, tenantId }, include: { items: true } });
      if (!sale) throw Errors.notFound('Venda');
      assertBranch(sale.branchId);
      if (!['CONFIRMED', 'PARTIALLY_REFUNDED'].includes(sale.status)) throw Errors.precondition('Somente vendas confirmadas podem ser estornadas');

      let amount = 0;
      let cost = 0;
      for (const r of input.items) {
        const item = sale.items.find((i) => i.id === r.saleItemId);
        if (!item) throw Errors.validation('Item inválido');
        if (r.qty > item.qty - item.refundedQty) throw Errors.validation(`Quantidade a estornar maior que a disponível: ${item.description}`);
        const lineNet = item.qty * item.unitPriceCents - item.discountCents;
        amount += Math.floor((lineNet * r.qty) / item.qty);
        cost += r.qty * item.unitCostCents;
        await tx.saleItem.update({ where: { id: item.id }, data: { refundedQty: item.refundedQty + r.qty } });
        if (input.returnToStock) {
          await this.stock.saleReturn(tx, { tenantId, branchId: sale.branchId, saleId: id, productId: item.productId, qty: r.qty, unitCostCents: item.unitCostCents });
        }
      }
      // desconto geral proporcional
      if (sale.discountCents > 0 && sale.subtotalCents > 0) {
        const lineDiscounts = sale.items.reduce((s, i) => s + i.discountCents, 0);
        const header = sale.discountCents - lineDiscounts;
        if (header > 0) amount -= Math.floor((header * amount) / (sale.subtotalCents - lineDiscounts || 1));
      }
      amount = Math.min(amount, sale.totalCents - sale.refundedCents);
      if (amount <= 0) throw Errors.validation('Nada a estornar');

      const receivable = await tx.receivable.findUniqueOrThrow({ where: { tenantId_sourceType_sourceId: { tenantId, sourceType: 'SALE', sourceId: id } } });
      const payments = await tx.payment.findMany({
        where: { tenantId, allocations: { some: { receivableId: receivable.id } } },
        orderBy: { receivedAt: 'desc' },
      });
      payments.sort((a, b) => Number(b.method === input.method) - Number(a.method === input.method));
      let left = amount;
      for (const p of payments) {
        if (left <= 0) break;
        const take = Math.min(left, p.amountCents - p.refundedCents);
        if (take <= 0) continue;
        await this.finance.refund(tx, { tenantId, paymentId: p.id, amountCents: take, reason: input.reason, cashSessionId: input.cashSessionId });
        left -= take;
      }
      if (left > 0) throw Errors.precondition('Pagamentos insuficientes para o estorno');

      const refundedCents = sale.refundedCents + amount;
      await tx.sale.update({ where: { id }, data: { refundedCents, status: refundedCents >= sale.totalCents ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
      await this.finance.postLedger(tx, tenantId, [
        { branchId: sale.branchId, sourceType: 'SALE', sourceId: id, entryType: 'REVENUE_REVERSAL', amountCents: -amount, memo: input.reason.slice(0, 300) },
        ...(input.returnToStock ? [{ branchId: sale.branchId, sourceType: 'SALE', sourceId: id, entryType: 'COGS' as const, amountCents: -cost, memo: 'Devolução ao estoque' }] : []),
      ]);
      await this.audit.log(tx, { action: 'sale_refunded', entity: 'sale', entityId: id, metadata: { amountCents: amount, returnToStock: input.returnToStock } });
      return { refundedCents: amount };
    });
  }

  async receipt(id: string, format: 'A4' | 'THERMAL') {
    const data = await this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      const s = await tx.sale.findFirst({ where: { id, tenantId }, include: { items: true, branch: true } });
      if (!s) throw Errors.notFound('Venda');
      assertBranch(s.branchId);
      if (s.status === 'DRAFT') throw Errors.precondition('Venda não confirmada');
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      const receivable = await tx.receivable.findUnique({ where: { tenantId_sourceType_sourceId: { tenantId, sourceType: 'SALE', sourceId: id } } });
      const payments = receivable ? await tx.payment.findMany({ where: { tenantId, allocations: { some: { receivableId: receivable.id } } } }) : [];
      const operator = await tx.tenantMembership.findFirst({ where: { tenantId, userId: s.createdBy }, select: { user: { select: { name: true } } } });
      const customer = s.customerId ? await tx.customer.findFirst({ where: { id: s.customerId, tenantId }, select: { name: true } }) : null;
      const pdf = await buildSaleReceiptPdf(
        {
          company: { name: tenant.name, document: tenant.document, phone: s.branch.phone ?? tenant.phone, branchName: s.branch.name, timezone: s.branch.timezone },
          number: s.number,
          confirmedAt: s.confirmedAt ?? s.createdAt,
          operator: operator?.user.name ?? '—',
          customerName: customer?.name,
          items: s.items,
          subtotalCents: s.subtotalCents,
          discountCents: s.discountCents,
          totalCents: s.totalCents,
          payments: payments.map((p) => ({ method: PAYMENT_METHOD_LABELS[p.method], amountCents: p.amountCents, changeCents: p.changeCents, manual: p.isManual })),
          footer: 'Obrigado pela preferência!',
        },
        format,
      );
      await tx.issuedDocument.create({
        data: { tenantId, type: 'SALE_RECEIPT', templateVersion: 1, referenceType: 'SALE', referenceId: id, checksum: pdf.checksum, format, issuedBy: auth().userId },
      });
      return pdf;
    });
    return data.buffer;
  }
}
