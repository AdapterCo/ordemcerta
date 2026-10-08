import { Controller, Get, Injectable, Module, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { createWarrantyClaimSchema, paginationSchema, updateWarrantyClaimSchema } from '@ordemcerta/shared';
import { z } from 'zod';
import { assertBranch, auth, branchScope, currentTenantId } from '../../core/context';
import { TenantDb } from '../../core/database';
import { Operational, Perm } from '../../core/decorators';
import { Errors } from '../../core/errors';
import { AuditService, OutboxService } from '../../core/services';
import { Doc, ZBody, ZQuery } from '../../core/zod';
import { ServiceOrdersModule } from '../service-orders/service-orders.module';
import { ServiceOrdersService } from '../service-orders/service-orders.service';

const claimQuery = paginationSchema.extend({
  status: z.enum(['OPEN', 'IN_ANALYSIS', 'APPROVED', 'DENIED', 'RESOLVED']).optional(),
  orderId: z.string().uuid().optional(),
});

const NEXT: Record<string, string[]> = {
  OPEN: ['IN_ANALYSIS', 'DENIED'],
  IN_ANALYSIS: ['APPROVED', 'DENIED'],
  APPROVED: ['RESOLVED'],
  DENIED: ['OPEN'],
  RESOLVED: [],
};

/**
 * Garantias: retorno vinculado à OS original (nunca apagada), triagem,
 * resolução ou negativa fundamentada. Prazo contratual informado não reduz a
 * garantia legal — reclamações fora do prazo contratual podem ser abertas.
 */
@Injectable()
export class WarrantiesService {
  constructor(
    private readonly db: TenantDb,
    private readonly orders: ServiceOrdersService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  list(q: z.infer<typeof claimQuery>) {
    return this.db.run(async (tx) => {
      const where: Prisma.WarrantyClaimWhereInput = { tenantId: currentTenantId(), status: q.status, orderId: q.orderId, order: { branchId: branchScope() } };
      const [items, total] = await Promise.all([
        tx.warrantyClaim.findMany({
          where,
          include: { order: { select: { number: true, branchId: true, warrantyUntil: true, customer: { select: { name: true } }, device: { select: { brand: true, model: true } } } } },
          orderBy: { createdAt: 'desc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        tx.warrantyClaim.count({ where }),
      ]);
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  get(id: string) {
    return this.db.run(async (tx) => {
      const c = await tx.warrantyClaim.findFirst({ where: { id, tenantId: currentTenantId() }, include: { order: { include: { customer: true, device: true } } } });
      if (!c) throw Errors.notFound('Garantia');
      assertBranch(c.order.branchId);
      const returnOrder = c.returnOrderId ? await tx.serviceOrder.findFirst({ where: { id: c.returnOrderId, tenantId: c.tenantId }, select: { id: true, number: true, technicalStatus: true } }) : null;
      return { ...c, returnOrder, withinContractualWarranty: Boolean(c.order.warrantyUntil && c.order.warrantyUntil >= c.createdAt) };
    });
  }

  create(input: z.infer<typeof createWarrantyClaimSchema>) {
    return this.db.run(async (tx, hooks) => {
      const o = await this.orders.load(tx, input.orderId);
      if (o.deliveryStatus !== 'DELIVERED') throw Errors.precondition('Garantia se aplica a OS entregue');
      if (input.originalLineId) {
        const line = await tx.quoteLine.findFirst({ where: { id: input.originalLineId, tenantId: o.tenantId, quoteId: o.approvedQuoteId ?? undefined } });
        if (!line) throw Errors.validation('Linha do orçamento aprovado inválida');
      }
      const claim = await tx.warrantyClaim.create({
        data: { tenantId: o.tenantId, orderId: o.id, originalLineId: input.originalLineId ?? null, reason: input.reason, createdBy: auth().userId },
      });
      await tx.serviceOrderEvent.create({ data: { tenantId: o.tenantId, orderId: o.id, actorId: auth().userId, eventType: 'warranty_claim_opened', payloadJson: { claimId: claim.id } } });
      await this.audit.log(tx, { action: 'warranty_claim_opened', entity: 'warranty_claim', entityId: claim.id });
      await this.outbox.add(tx, hooks, o.tenantId, {
        eventType: 'warranty.updated',
        aggregateType: 'service_order',
        aggregateId: o.id,
        payload: { orderId: o.id, number: o.number, branchId: o.branchId, customerId: o.customerId, claimId: claim.id, status: 'OPEN' },
      });
      return { ...claim, withinContractualWarranty: Boolean(o.warrantyUntil && o.warrantyUntil >= new Date()) };
    });
  }

  update(id: string, input: z.infer<typeof updateWarrantyClaimSchema>) {
    return this.db.run(async (tx, hooks) => {
      const c = await tx.warrantyClaim.findFirst({ where: { id, tenantId: currentTenantId() } });
      if (!c) throw Errors.notFound('Garantia');
      const o = await this.orders.load(tx, c.orderId);
      const data: Prisma.WarrantyClaimUncheckedUpdateInput = {};
      if (input.status && input.status !== c.status) {
        if (!NEXT[c.status]?.includes(input.status)) throw Errors.invalidTransition(c.status, input.status);
        if (input.status === 'DENIED' && !(input.denialReason ?? c.denialReason)) throw Errors.validation('Negativa exige fundamentação');
        data.status = input.status;
        if (input.status === 'RESOLVED') data.resolvedAt = new Date();
      }
      if (input.triageNotes !== undefined) data.triageNotes = input.triageNotes;
      if (input.resolution !== undefined) data.resolution = input.resolution;
      if (input.denialReason !== undefined) data.denialReason = input.denialReason;
      let returnOrder = null;
      if (input.createReturnOrder) {
        if (c.returnOrderId) throw Errors.conflict('OS de retorno já criada');
        returnOrder = await this.orders.createWarrantyReturn(tx, hooks, o, c.reason);
        data.returnOrderId = returnOrder.order.id;
      }
      const u = await tx.warrantyClaim.update({ where: { id }, data });
      await tx.serviceOrderEvent.create({ data: { tenantId: o.tenantId, orderId: o.id, actorId: auth().userId, eventType: 'warranty_claim_updated', payloadJson: { claimId: id, status: u.status } } });
      await this.audit.log(tx, { action: 'warranty_claim_updated', entity: 'warranty_claim', entityId: id, metadata: { status: u.status } });
      if (data.status) {
        await this.outbox.add(tx, hooks, o.tenantId, {
          eventType: 'warranty.updated',
          aggregateType: 'service_order',
          aggregateId: o.id,
          payload: { orderId: o.id, number: o.number, branchId: o.branchId, customerId: o.customerId, claimId: id, status: u.status },
        });
      }
      return { ...u, returnOrder: returnOrder ? { id: returnOrder.order.id, number: returnOrder.order.number, trackingUrl: returnOrder.trackingUrl } : null };
    });
  }
}

@ApiTags('warranties')
@ApiBearerAuth()
@Controller('warranties/claims')
export class WarrantiesController {
  constructor(private readonly warranties: WarrantiesService) {}

  @Get()
  @Perm('warranty:view')
  @Doc('Solicitações de garantia', { query: claimQuery })
  list(@ZQuery(claimQuery) q: z.infer<typeof claimQuery>) {
    return this.warranties.list(q);
  }

  @Post()
  @Perm('warranty:manage')
  @Operational()
  @Doc('Abre solicitação vinculada à OS original', { body: createWarrantyClaimSchema })
  create(@ZBody(createWarrantyClaimSchema) body: z.infer<typeof createWarrantyClaimSchema>) {
    return this.warranties.create(body);
  }

  @Get(':id')
  @Perm('warranty:view')
  @Doc('Detalhe da garantia')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.warranties.get(id);
  }

  @Patch(':id')
  @Perm('warranty:manage')
  @Operational()
  @Doc('Triagem/resolução/negativa fundamentada; pode abrir OS de retorno', { body: updateWarrantyClaimSchema })
  update(@Param('id', ParseUUIDPipe) id: string, @ZBody(updateWarrantyClaimSchema) body: z.infer<typeof updateWarrantyClaimSchema>) {
    return this.warranties.update(id, body);
  }
}

@Module({
  imports: [ServiceOrdersModule],
  controllers: [WarrantiesController],
  providers: [WarrantiesService],
})
export class WarrantiesModule {}
