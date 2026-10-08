import { Injectable } from '@nestjs/common';
import { Prisma, type StockMovementType } from '@prisma/client';
import { nextCounter, type Tx } from '@ordemcerta/server';
import {
  stockAdjustSchema,
  stockConsumeSchema,
  stockQuerySchema,
  stockReceiveSchema,
  stockReleaseSchema,
  stockReserveSchema,
  stockTransferReceiveSchema,
  stockTransferSchema,
} from '@ordemcerta/shared';
import { z } from 'zod';
import { assertBranch, auth, branchScope, can, currentTenantId } from '../../core/context';
import { TenantDb, type TxHooks } from '../../core/database';
import { Errors } from '../../core/errors';
import { AuditService, OutboxService } from '../../core/services';
import { SettingsService } from '../../core/settings.service';
import { FinanceService } from '../finance/finance.service';

export const inventorySchema = z.object({
  branchId: z.string().uuid(),
  reason: z.string().trim().min(3).max(300),
  items: z.array(z.object({ productId: z.string().uuid(), countedQty: z.number().int().min(0) })).min(1).max(500),
});

interface LockedBalance {
  id: string;
  on_hand: number;
  reserved: number;
}

/**
 * Estoque por filial/local. Movimentações imutáveis com origem, autor,
 * quantidade (com sinal) e custo. Saldos travados com SELECT ... FOR UPDATE
 * em ordem determinística (evita deadlock e venda dupla da última unidade).
 */
@Injectable()
export class StockService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly settings: SettingsService,
    private readonly finance: FinanceService,
  ) {}

  async defaultLocation(tx: Tx, tenantId: string, branchId: string) {
    const loc = await tx.stockLocation.findFirst({ where: { tenantId, branchId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
    if (loc) return loc;
    return tx.stockLocation.create({ data: { tenantId, branchId, name: 'Principal', isDefault: true } });
  }

  private async resolveLocation(tx: Tx, tenantId: string, branchId: string, locationId?: string) {
    if (!locationId) return this.defaultLocation(tx, tenantId, branchId);
    const loc = await tx.stockLocation.findFirst({ where: { id: locationId, tenantId, branchId } });
    if (!loc) throw Errors.validation('Local de estoque inválido para a filial');
    return loc;
  }

  async lockBalance(tx: Tx, tenantId: string, locationId: string, productId: string): Promise<LockedBalance> {
    await tx.$executeRaw`
      INSERT INTO stock_balances (id, tenant_id, location_id, product_id, on_hand, reserved, version, updated_at)
      VALUES (gen_random_uuid(), ${tenantId}::uuid, ${locationId}::uuid, ${productId}::uuid, 0, 0, 0, now())
      ON CONFLICT (location_id, product_id) DO NOTHING`;
    const rows = await tx.$queryRaw<LockedBalance[]>`
      SELECT id, on_hand, reserved FROM stock_balances
      WHERE location_id = ${locationId}::uuid AND product_id = ${productId}::uuid FOR UPDATE`;
    return rows[0]!;
  }

  private async setBalance(tx: Tx, id: string, onHand: number, reserved: number) {
    await tx.stockBalance.update({ where: { id }, data: { onHand, reserved, version: { increment: 1 } } });
  }

  async stockProduct(tx: Tx, tenantId: string, productId: string) {
    const p = await tx.product.findFirst({ where: { id: productId, tenantId } });
    if (!p) throw Errors.notFound('Produto');
    if (p.kind === 'SERVICE') throw Errors.validation('Serviços não controlam estoque');
    return p;
  }

  private async movement(
    tx: Tx,
    data: {
      tenantId: string;
      branchId: string;
      locationId: string;
      productId: string;
      type: StockMovementType;
      quantity: number;
      unitCostCents: number;
      referenceType?: string;
      referenceId?: string;
      reason?: string;
      overrideNegative?: boolean;
    },
  ) {
    return tx.stockMovement.create({ data: { ...data, actorId: auth().userId } });
  }

  /** Política: impedir estoque negativo por padrão; override exige permissão e é auditado. */
  private async assertAvailable(tx: Tx, tenantId: string, branchId: string, b: LockedBalance, qty: number, productName: string, override = false) {
    const available = b.on_hand - b.reserved;
    if (available >= qty) return false;
    const allowNegative = await this.settings.get(tx, tenantId, 'stock.allow_negative', branchId);
    if (allowNegative) return true;
    if (override && can('stock:override_negative')) return true;
    throw Errors.insufficientStock({ product: productName, available, requested: qty });
  }

  /* ------------------------------------------------------------- consultas */

  balances(q: z.infer<typeof stockQuerySchema>) {
    if (q.branchId) assertBranch(q.branchId);
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      const where: Prisma.StockBalanceWhereInput = {
        tenantId,
        productId: q.productId,
        location: { branchId: q.branchId ?? branchScope() },
        ...(q.q ? { product: { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { sku: { contains: q.q, mode: 'insensitive' } }] } } : {}),
      };
      const rows = await tx.stockBalance.findMany({
        where,
        include: {
          product: { select: { id: true, sku: true, name: true, minStock: true, costCents: true, priceCents: true, kind: true } },
          location: { select: { id: true, name: true, branchId: true } },
        },
        orderBy: { product: { name: 'asc' } },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      });
      const items = rows
        .map((r) => ({ ...r, available: r.onHand - r.reserved, belowMin: r.onHand - r.reserved < r.product.minStock }))
        .filter((r) => !q.belowMin || r.belowMin);
      return { items, total: await tx.stockBalance.count({ where }), page: q.page, pageSize: q.pageSize };
    });
  }

  movements(q: { branchId?: string; productId?: string; page: number; pageSize: number }) {
    if (q.branchId) assertBranch(q.branchId);
    return this.db.run(async (tx) => {
      const where: Prisma.StockMovementWhereInput = { tenantId: currentTenantId(), branchId: q.branchId ?? branchScope(), productId: q.productId };
      const [items, total] = await Promise.all([
        tx.stockMovement.findMany({
          where,
          include: { product: { select: { name: true, sku: true } }, location: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        tx.stockMovement.count({ where }),
      ]);
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  alerts(branchId?: string) {
    if (branchId) assertBranch(branchId);
    return this.db.run(async (tx) => {
      const rows = await tx.stockBalance.findMany({
        where: { tenantId: currentTenantId(), location: { branchId: branchId ?? branchScope() }, product: { active: true, minStock: { gt: 0 } } },
        include: { product: { select: { id: true, name: true, sku: true, minStock: true } }, location: { select: { branchId: true, name: true } } },
      });
      return rows.filter((r) => r.onHand - r.reserved < r.product.minStock).map((r) => ({ ...r, available: r.onHand - r.reserved }));
    });
  }

  /* -------------------------------------------------------- movimentações */

  receive(input: z.infer<typeof stockReceiveSchema>) {
    assertBranch(input.branchId);
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      const loc = await this.resolveLocation(tx, tenantId, input.branchId, input.locationId);
      const items = [...input.items].sort((a, b) => a.productId.localeCompare(b.productId));
      for (const it of items) {
        const product = await this.stockProduct(tx, tenantId, it.productId);
        const b = await this.lockBalance(tx, tenantId, loc.id, it.productId);
        // custo médio ponderado pelo saldo total da empresa
        const agg = await tx.stockBalance.aggregate({ where: { tenantId, productId: it.productId }, _sum: { onHand: true } });
        const totalOnHand = Math.max(agg._sum.onHand ?? 0, 0);
        const newCost = totalOnHand + it.quantity > 0 ? Math.round((totalOnHand * product.costCents + it.quantity * it.unitCostCents) / (totalOnHand + it.quantity)) : it.unitCostCents;
        await this.setBalance(tx, b.id, b.on_hand + it.quantity, b.reserved);
        await this.movement(tx, {
          tenantId, branchId: input.branchId, locationId: loc.id, productId: it.productId, type: 'RECEIPT', quantity: it.quantity,
          unitCostCents: it.unitCostCents, referenceType: 'RECEIPT', reason: input.reference ?? undefined,
        });
        await tx.product.update({ where: { id: it.productId }, data: { costCents: newCost } });
      }
      await this.audit.log(tx, { action: 'stock_received', entity: 'branch', entityId: input.branchId, metadata: { items: items.length, reference: input.reference } });
      return { ok: true, items: items.length };
    });
  }

  adjust(input: z.infer<typeof stockAdjustSchema>) {
    assertBranch(input.branchId);
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      const product = await this.stockProduct(tx, tenantId, input.productId);
      const loc = await this.resolveLocation(tx, tenantId, input.branchId, input.locationId);
      const b = await this.lockBalance(tx, tenantId, loc.id, input.productId);
      let override = false;
      if (input.quantityDelta < 0) override = await this.assertAvailable(tx, tenantId, input.branchId, b, -input.quantityDelta, product.name, input.overrideNegative);
      await this.setBalance(tx, b.id, b.on_hand + input.quantityDelta, b.reserved);
      const m = await this.movement(tx, {
        tenantId, branchId: input.branchId, locationId: loc.id, productId: input.productId, type: input.type,
        quantity: input.quantityDelta, unitCostCents: product.costCents, referenceType: 'ADJUSTMENT', reason: input.reason, overrideNegative: override,
      });
      await this.audit.log(tx, {
        action: override ? 'stock_adjusted_negative_override' : 'stock_adjusted',
        entity: 'stock_movement',
        entityId: m.id,
        metadata: { productId: input.productId, delta: input.quantityDelta, type: input.type },
      });
      return m;
    });
  }

  /** Inventário: ajusta cada item à contagem física (diferença registrada como ADJUSTMENT). */
  inventory(input: z.infer<typeof inventorySchema>) {
    assertBranch(input.branchId);
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      const loc = await this.defaultLocation(tx, tenantId, input.branchId);
      const diffs = [];
      for (const it of [...input.items].sort((a, b) => a.productId.localeCompare(b.productId))) {
        const product = await this.stockProduct(tx, tenantId, it.productId);
        const b = await this.lockBalance(tx, tenantId, loc.id, it.productId);
        const delta = it.countedQty - b.on_hand;
        if (delta === 0) continue;
        if (it.countedQty < b.reserved) throw Errors.precondition(`${product.name}: contagem menor que a quantidade reservada para OS`);
        await this.setBalance(tx, b.id, it.countedQty, b.reserved);
        await this.movement(tx, {
          tenantId, branchId: input.branchId, locationId: loc.id, productId: it.productId, type: 'ADJUSTMENT', quantity: delta,
          unitCostCents: product.costCents, referenceType: 'INVENTORY', reason: input.reason,
        });
        diffs.push({ productId: it.productId, name: product.name, before: b.on_hand, counted: it.countedQty, delta });
      }
      await this.audit.log(tx, { action: 'inventory_reconciled', entity: 'branch', entityId: input.branchId, metadata: { adjusted: diffs.length } });
      return { adjusted: diffs };
    });
  }

  /* ------------------------------------------------------- reservas da OS */

  reserve(input: z.infer<typeof stockReserveSchema>) {
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      const order = await tx.serviceOrder.findFirst({ where: { id: input.orderId, tenantId } });
      if (!order) throw Errors.notFound('OS');
      assertBranch(order.branchId);
      if (['CANCELED', 'RETURNED_UNREPAIRED', 'READY'].includes(order.technicalStatus) || order.deliveryStatus === 'DELIVERED') {
        throw Errors.precondition('OS não aceita reserva de peças neste estado');
      }
      const product = await this.stockProduct(tx, tenantId, input.productId);
      const loc = await this.resolveLocation(tx, tenantId, order.branchId, input.locationId);
      const b = await this.lockBalance(tx, tenantId, loc.id, input.productId);
      await this.assertAvailable(tx, tenantId, order.branchId, b, input.quantity, product.name);
      await this.setBalance(tx, b.id, b.on_hand, b.reserved + input.quantity);
      const r = await tx.stockReservation.create({
        data: { tenantId, orderId: order.id, productId: input.productId, locationId: loc.id, quantity: input.quantity, createdBy: auth().userId },
      });
      await this.movement(tx, {
        tenantId, branchId: order.branchId, locationId: loc.id, productId: input.productId, type: 'RESERVE', quantity: input.quantity,
        unitCostCents: product.costCents, referenceType: 'SERVICE_ORDER', referenceId: order.id,
      });
      await tx.serviceOrderEvent.create({
        data: { tenantId, orderId: order.id, actorId: auth().userId, eventType: 'part_reserved', payloadJson: { productId: input.productId, name: product.name, quantity: input.quantity } },
      });
      return r;
    });
  }

  /** Baixa da peça na OS: transação atômica com estoque e custo (CMV). */
  consume(input: z.infer<typeof stockConsumeSchema>) {
    return this.db.run(async (tx, hooks) => {
      const tenantId = currentTenantId();
      await tx.$queryRaw`SELECT id FROM stock_reservations WHERE id = ${input.reservationId}::uuid FOR UPDATE`;
      const r = await tx.stockReservation.findFirst({ where: { id: input.reservationId, tenantId }, include: { order: true, product: true } });
      if (!r) throw Errors.notFound('Reserva');
      assertBranch(r.order.branchId);
      if (r.status !== 'ACTIVE') throw Errors.conflict('Reserva já finalizada');
      const remaining = r.quantity - r.consumedQty;
      const qty = input.quantity ?? remaining;
      if (qty > remaining) throw Errors.validation('Quantidade maior que a reservada', { remaining });
      const b = await this.lockBalance(tx, tenantId, r.locationId, r.productId);
      await this.setBalance(tx, b.id, b.on_hand - qty, b.reserved - qty);
      const consumed = r.consumedQty + qty;
      await tx.stockReservation.update({ where: { id: r.id }, data: { consumedQty: consumed, status: consumed === r.quantity ? 'CONSUMED' : 'ACTIVE' } });
      await this.movement(tx, {
        tenantId, branchId: r.order.branchId, locationId: r.locationId, productId: r.productId, type: 'OS_CONSUMPTION', quantity: -qty,
        unitCostCents: r.product.costCents, referenceType: 'SERVICE_ORDER', referenceId: r.orderId,
      });
      await this.finance.postLedger(tx, tenantId, [
        { branchId: r.order.branchId, sourceType: 'SERVICE_ORDER', sourceId: r.orderId, entryType: 'COGS', amountCents: qty * r.product.costCents, memo: r.product.name.slice(0, 200) },
      ]);
      await tx.serviceOrderEvent.create({
        data: { tenantId, orderId: r.orderId, actorId: auth().userId, eventType: 'part_consumed', payloadJson: { productId: r.productId, name: r.product.name, quantity: qty } },
      });
      await this.outbox.add(tx, hooks, tenantId, { eventType: 'stock.consumed', aggregateType: 'service_order', aggregateId: r.orderId, payload: { productId: r.productId, quantity: qty } });
      return { reservationId: r.id, consumed: qty, remaining: remaining - qty };
    });
  }

  release(input: z.infer<typeof stockReleaseSchema>) {
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      const r = await tx.stockReservation.findFirst({ where: { id: input.reservationId, tenantId }, include: { order: { select: { branchId: true } } } });
      if (!r) throw Errors.notFound('Reserva');
      assertBranch(r.order.branchId);
      await this.releaseReservation(tx, tenantId, r.id, input.reason);
      return { ok: true };
    });
  }

  async releaseReservation(tx: Tx, tenantId: string, reservationId: string, reason?: string) {
    await tx.$queryRaw`SELECT id FROM stock_reservations WHERE id = ${reservationId}::uuid FOR UPDATE`;
    const r = await tx.stockReservation.findFirstOrThrow({ where: { id: reservationId, tenantId }, include: { order: { select: { branchId: true } }, product: true } });
    if (r.status !== 'ACTIVE') return;
    const remaining = r.quantity - r.consumedQty;
    const b = await this.lockBalance(tx, tenantId, r.locationId, r.productId);
    await this.setBalance(tx, b.id, b.on_hand, Math.max(b.reserved - remaining, 0));
    await tx.stockReservation.update({ where: { id: r.id }, data: { status: 'RELEASED' } });
    await this.movement(tx, {
      tenantId, branchId: r.order.branchId, locationId: r.locationId, productId: r.productId, type: 'RELEASE', quantity: remaining,
      unitCostCents: r.product.costCents, referenceType: 'SERVICE_ORDER', referenceId: r.orderId, reason,
    });
  }

  /** Estorno controlado: libera todas as reservas ativas da OS (cancelamento/devolução). */
  async releaseAllForOrder(tx: Tx, tenantId: string, orderId: string, reason: string) {
    const active = await tx.stockReservation.findMany({ where: { tenantId, orderId, status: 'ACTIVE' }, orderBy: { productId: 'asc' } });
    for (const r of active) await this.releaseReservation(tx, tenantId, r.id, reason);
    return active.length;
  }

  /* ------------------------------------------------------------ vendas PDV */

  /** Saída de estoque de venda (chamado dentro da transação de confirmação). */
  async saleOut(tx: Tx, args: { tenantId: string; branchId: string; saleId: string; items: Array<{ productId: string; qty: number }> }) {
    const loc = await this.defaultLocation(tx, args.tenantId, args.branchId);
    const costs = new Map<string, number>();
    const grouped = new Map<string, number>();
    for (const it of args.items) grouped.set(it.productId, (grouped.get(it.productId) ?? 0) + it.qty);
    for (const [productId, qty] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const p = await tx.product.findFirstOrThrow({ where: { id: productId, tenantId: args.tenantId } });
      costs.set(productId, p.costCents);
      if (p.kind === 'SERVICE') continue;
      const b = await this.lockBalance(tx, args.tenantId, loc.id, productId);
      await this.assertAvailable(tx, args.tenantId, args.branchId, b, qty, p.name);
      await this.setBalance(tx, b.id, b.on_hand - qty, b.reserved);
      await this.movement(tx, {
        tenantId: args.tenantId, branchId: args.branchId, locationId: loc.id, productId, type: 'SALE', quantity: -qty,
        unitCostCents: p.costCents, referenceType: 'SALE', referenceId: args.saleId,
      });
    }
    return costs;
  }

  async saleReturn(tx: Tx, args: { tenantId: string; branchId: string; saleId: string; productId: string; qty: number; unitCostCents: number }) {
    const p = await tx.product.findFirstOrThrow({ where: { id: args.productId, tenantId: args.tenantId } });
    if (p.kind === 'SERVICE') return;
    const loc = await this.defaultLocation(tx, args.tenantId, args.branchId);
    const b = await this.lockBalance(tx, args.tenantId, loc.id, args.productId);
    await this.setBalance(tx, b.id, b.on_hand + args.qty, b.reserved);
    await this.movement(tx, {
      tenantId: args.tenantId, branchId: args.branchId, locationId: loc.id, productId: args.productId, type: 'SALE_CANCEL', quantity: args.qty,
      unitCostCents: args.unitCostCents, referenceType: 'SALE', referenceId: args.saleId,
    });
  }

  /* ---------------------------------------------------------- transferências */

  listTransfers(q: { status?: string; page: number; pageSize: number }) {
    return this.db.run(async (tx) => {
      const scope = branchScope();
      const where: Prisma.StockTransferWhereInput = {
        tenantId: currentTenantId(),
        status: q.status as Prisma.EnumTransferStatusFilter['equals'],
        ...(scope ? { OR: [{ sourceBranchId: scope }, { destBranchId: scope }] } : {}),
      };
      const [items, total] = await Promise.all([
        tx.stockTransfer.findMany({
          where,
          include: { lines: { include: { product: { select: { name: true, sku: true } } } }, sourceBranch: { select: { name: true } }, destBranch: { select: { name: true } } },
          orderBy: { sentAt: 'desc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        tx.stockTransfer.count({ where }),
      ]);
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  createTransfer(input: z.infer<typeof stockTransferSchema>) {
    assertBranch(input.sourceBranchId);
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      const dest = await tx.branch.findFirst({ where: { id: input.destBranchId, tenantId, status: 'ACTIVE' } });
      if (!dest) throw Errors.validation('Filial de destino inválida');
      const src = await this.defaultLocation(tx, tenantId, input.sourceBranchId);
      const dst = await this.defaultLocation(tx, tenantId, input.destBranchId);
      const number = await nextCounter(tx, tenantId, 'stock_transfer');
      const transfer = await tx.stockTransfer.create({
        data: {
          tenantId, number, sourceBranchId: input.sourceBranchId, destBranchId: input.destBranchId, sourceLocationId: src.id, destLocationId: dst.id,
          notes: input.notes, createdBy: auth().userId,
        },
      });
      for (const line of [...input.lines].sort((a, b) => a.productId.localeCompare(b.productId))) {
        const p = await this.stockProduct(tx, tenantId, line.productId);
        const b = await this.lockBalance(tx, tenantId, src.id, line.productId);
        await this.assertAvailable(tx, tenantId, input.sourceBranchId, b, line.quantity, p.name);
        await this.setBalance(tx, b.id, b.on_hand - line.quantity, b.reserved);
        await tx.stockTransferLine.create({ data: { tenantId, transferId: transfer.id, productId: line.productId, quantitySent: line.quantity, unitCostCents: p.costCents } });
        await this.movement(tx, {
          tenantId, branchId: input.sourceBranchId, locationId: src.id, productId: line.productId, type: 'TRANSFER_OUT', quantity: -line.quantity,
          unitCostCents: p.costCents, referenceType: 'STOCK_TRANSFER', referenceId: transfer.id,
        });
      }
      await this.audit.log(tx, { action: 'stock_transfer_sent', entity: 'stock_transfer', entityId: transfer.id, metadata: { lines: input.lines.length } });
      return transfer;
    });
  }

  /** Confirmação de recebimento com diferenças registradas. */
  receiveTransfer(id: string, input: z.infer<typeof stockTransferReceiveSchema>) {
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      await tx.$queryRaw`SELECT id FROM stock_transfers WHERE id = ${id}::uuid FOR UPDATE`;
      const t = await tx.stockTransfer.findFirst({ where: { id, tenantId }, include: { lines: true } });
      if (!t) throw Errors.notFound('Transferência');
      assertBranch(t.destBranchId);
      if (t.status !== 'IN_TRANSIT') throw Errors.conflict('Transferência já recebida ou cancelada');
      const received = new Map(input.lines.map((l) => [l.lineId, l.quantityReceived]));
      let diff = false;
      for (const line of [...t.lines].sort((a, b) => a.productId.localeCompare(b.productId))) {
        const qty = received.get(line.id);
        if (qty === undefined) throw Errors.validation('Informe a quantidade recebida de todas as linhas');
        if (qty > line.quantitySent) throw Errors.validation('Quantidade recebida maior que a enviada');
        if (qty !== line.quantitySent) diff = true;
        await tx.stockTransferLine.update({ where: { id: line.id }, data: { quantityReceived: qty } });
        if (qty > 0) {
          const b = await this.lockBalance(tx, tenantId, t.destLocationId, line.productId);
          await this.setBalance(tx, b.id, b.on_hand + qty, b.reserved);
          await this.movement(tx, {
            tenantId, branchId: t.destBranchId, locationId: t.destLocationId, productId: line.productId, type: 'TRANSFER_IN', quantity: qty,
            unitCostCents: line.unitCostCents, referenceType: 'STOCK_TRANSFER', referenceId: t.id,
          });
        }
      }
      const u = await tx.stockTransfer.update({
        where: { id },
        data: { status: diff ? 'RECEIVED_WITH_DIFF' : 'RECEIVED', receivedBy: auth().userId, receivedAt: new Date(), receiveNotes: input.notes, version: { increment: 1 } },
      });
      await this.audit.log(tx, { action: diff ? 'stock_transfer_received_with_diff' : 'stock_transfer_received', entity: 'stock_transfer', entityId: id });
      return u;
    });
  }

  emitHooks(_hooks: TxHooks) {
    return undefined;
  }
}
