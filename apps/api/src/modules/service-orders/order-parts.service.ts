import { Injectable } from '@nestjs/common';
import { cancelPartPurchaseSchema, partPurchaseSchema } from '@ordemcerta/shared';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { assertBranch, assertCan, auth, currentTenantId } from '../../core/context';
import { TenantDb } from '../../core/database';
import { Errors } from '../../core/errors';
import { AuditService } from '../../core/services';
import { CashService } from '../finance/cash.service';
import { FinanceService } from '../finance/finance.service';

/**
 * Peças compradas para a OS no ato do serviço (fora do estoque).
 * Custo entra como COGS da OS no razão (relatórios de margem); quando pago com
 * dinheiro do caixa, registra a sangria correspondente na mesma transação.
 * Sem exclusão: cancelamento com motivo, estornando custo e caixa.
 */
@Injectable()
export class OrderPartsService {
  constructor(
    private readonly db: TenantDb,
    private readonly cash: CashService,
    private readonly finance: FinanceService,
    private readonly audit: AuditService,
  ) {}

  create(orderId: string, input: z.infer<typeof partPurchaseSchema>) {
    if (input.paymentMethod === 'CASH_REGISTER') assertCan('cash:operate');
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      const actorId = auth().userId;
      const o = await tx.serviceOrder.findFirst({ where: { id: orderId, tenantId }, select: { id: true, number: true, branchId: true, technicalStatus: true } });
      if (!o) throw Errors.notFound('OS');
      assertBranch(o.branchId);
      if (o.technicalStatus === 'CANCELED') throw Errors.precondition('OS cancelada: não é possível registrar compra de peça');
      const total = input.qty * input.unitCostCents;

      let cashMovementId: string | null = null;
      if (input.paymentMethod === 'CASH_REGISTER') {
        const session = await tx.cashSession.findFirst({ where: { id: input.cashSessionId!, tenantId }, select: { branchId: true } });
        if (!session || session.branchId !== o.branchId) throw Errors.validation('Selecione um caixa aberto da mesma filial da OS');
        const m = await this.cash.movementIn(
          tx,
          input.cashSessionId!,
          'WITHDRAWAL',
          { amountCents: total, reason: `Compra de peça — OS nº ${o.number}: ${input.description}`.slice(0, 300) },
          `part:${randomUUID()}`,
        );
        cashMovementId = m.id;
      }

      const p = await tx.orderPartPurchase.create({
        data: {
          tenantId,
          orderId: o.id,
          branchId: o.branchId,
          description: input.description,
          qty: input.qty,
          unitCostCents: input.unitCostCents,
          totalCostCents: total,
          supplierName: input.supplierName,
          paymentMethod: input.paymentMethod,
          cashMovementId,
          purchasedAt: input.purchasedAt ?? new Date(),
          notes: input.notes,
          createdBy: actorId,
        },
      });
      if (total > 0) {
        await this.finance.postLedger(tx, tenantId, [
          { branchId: o.branchId, sourceType: 'SERVICE_ORDER', sourceId: o.id, entryType: 'COGS', amountCents: total, memo: `Peça comprada: ${input.description}`.slice(0, 200) },
        ]);
      }
      await tx.serviceOrderEvent.create({
        data: {
          tenantId,
          orderId: o.id,
          actorId,
          eventType: 'part_purchased',
          payloadJson: { purchaseId: p.id, description: input.description, totalCostCents: total, paymentMethod: input.paymentMethod },
        },
      });
      await this.audit.log(tx, { action: 'part_purchased', entity: 'order_part_purchase', entityId: p.id, metadata: { orderId: o.id, totalCostCents: total, paymentMethod: input.paymentMethod } });
      return p;
    });
  }

  cancel(orderId: string, purchaseId: string, input: z.infer<typeof cancelPartPurchaseSchema>) {
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      const actorId = auth().userId;
      await tx.$queryRaw`SELECT id FROM order_part_purchases WHERE id = ${purchaseId}::uuid FOR UPDATE`;
      const p = await tx.orderPartPurchase.findFirst({ where: { id: purchaseId, orderId, tenantId } });
      if (!p) throw Errors.notFound('Compra de peça');
      assertBranch(p.branchId);
      if (p.canceledAt) throw Errors.conflict('Esta compra já foi cancelada');

      let cashRefund: 'original' | 'other' | 'not_returned' | null = null;
      if (p.cashMovementId) {
        assertCan('cash:operate');
        const mv = await tx.cashMovement.findFirstOrThrow({ where: { id: p.cashMovementId, tenantId }, select: { cashSessionId: true } });
        const s = await tx.cashSession.findFirstOrThrow({ where: { id: mv.cashSessionId, tenantId }, select: { status: true } });
        // Caixa original aberto: devolve nele. Fechado: devolve no caixa aberto escolhido ou registra que o dinheiro não voltou.
        let target: string | null = s.status === 'OPEN' ? mv.cashSessionId : null;
        if (!target && input.refundCashSessionId) {
          const other = await tx.cashSession.findFirst({ where: { id: input.refundCashSessionId, tenantId }, select: { status: true, branchId: true } });
          if (!other || other.status !== 'OPEN' || other.branchId !== p.branchId) throw Errors.validation('Escolha um caixa aberto da mesma filial da OS');
          target = input.refundCashSessionId;
        }
        if (target) {
          await this.cash.movementIn(
            tx,
            target,
            'SUPPLY',
            { amountCents: p.totalCostCents, reason: `Estorno de compra de peça: ${p.description}`.slice(0, 300) },
            `part-cancel:${p.id}`,
          );
          cashRefund = target === mv.cashSessionId ? 'original' : 'other';
        } else {
          cashRefund = 'not_returned';
        }
      }

      const canceled = await tx.orderPartPurchase.update({
        where: { id: p.id },
        data: { canceledAt: new Date(), canceledBy: actorId, cancelReason: input.reason },
      });
      if (p.totalCostCents > 0) {
        await this.finance.postLedger(tx, tenantId, [
          { branchId: p.branchId, sourceType: 'SERVICE_ORDER', sourceId: p.orderId, entryType: 'COGS', amountCents: -p.totalCostCents, memo: `Cancelamento peça: ${p.description}`.slice(0, 200) },
        ]);
      }
      await tx.serviceOrderEvent.create({
        data: { tenantId, orderId: p.orderId, actorId, eventType: 'part_purchase_canceled', payloadJson: { purchaseId: p.id, reason: input.reason, cashRefund } },
      });
      await this.audit.log(tx, { action: 'part_purchase_canceled', entity: 'order_part_purchase', entityId: p.id, metadata: { reason: input.reason, cashRefund } });
      return canceled;
    });
  }
}
