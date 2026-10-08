import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import {
  cashMovementSchema,
  cashRegisterSchema,
  closeCashSchema,
  createPaymentSchema,
  createReceivableSchema,
  openCashSchema,
  paginationSchema,
  refundPaymentSchema,
} from '@ordemcerta/shared';
import { z } from 'zod';
import { assertBranch, branchScope, currentTenantId } from '../../core/context';
import { TenantDb } from '../../core/database';
import { Idempotent, Operational, Perm } from '../../core/decorators';
import { Errors } from '../../core/errors';
import { Doc, ZBody, ZQuery } from '../../core/zod';
import { CashService } from './cash.service';
import { FinanceService } from './finance.service';

const receivableQuery = paginationSchema.extend({
  status: z.enum(['OPEN', 'PARTIALLY_PAID', 'PAID', 'CANCELED', 'REFUNDED']).optional(),
  branchId: z.string().uuid().optional(),
  sourceType: z.enum(['SALE', 'SERVICE_ORDER']).optional(),
  sourceId: z.string().uuid().optional(),
});
const paymentQuery = paginationSchema.extend({
  branchId: z.string().uuid().optional(),
  cashSessionId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
const historyQuery = paginationSchema.extend({ branchId: z.string().uuid().optional() });
const updateRegisterSchema = z.object({ name: z.string().trim().min(1).max(60).optional(), active: z.boolean().optional() });

@ApiTags('finance')
@ApiBearerAuth()
@Controller()
export class FinanceController {
  constructor(
    private readonly db: TenantDb,
    private readonly finance: FinanceService,
    private readonly cash: CashService,
  ) {}

  /* ------------------------------------------------------------ cobranças */

  @Get('receivables')
  @Perm('sales:view')
  @Doc('Contas a receber (OS e vendas)', { query: receivableQuery })
  receivables(@ZQuery(receivableQuery) q: z.infer<typeof receivableQuery>) {
    if (q.branchId) assertBranch(q.branchId);
    return this.db.run(async (tx) => {
      const where: Prisma.ReceivableWhereInput = {
        tenantId: currentTenantId(),
        branchId: q.branchId ?? branchScope(),
        status: q.status,
        sourceType: q.sourceType,
        sourceId: q.sourceId,
      };
      const [items, total] = await Promise.all([
        tx.receivable.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
        tx.receivable.count({ where }),
      ]);
      return { items: items.map((r) => ({ ...r, outstandingCents: this.finance.outstanding(r) })), total, page: q.page, pageSize: q.pageSize };
    });
  }

  @Post('receivables')
  @Perm('payment:receive')
  @Operational()
  @Doc('Gera a cobrança de uma OS a partir do orçamento aprovado (idempotente por origem)', { body: createReceivableSchema })
  createReceivable(@ZBody(createReceivableSchema) body: z.infer<typeof createReceivableSchema>) {
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      const order = await tx.serviceOrder.findFirst({ where: { id: body.sourceId, tenantId } });
      if (!order) throw Errors.notFound('OS');
      assertBranch(order.branchId);
      const amount = order.approvedQuoteId ? order.totalCents : order.diagnosisFeeCents;
      if (amount <= 0) throw Errors.precondition('OS sem orçamento aprovado ou taxa a cobrar');
      await this.finance.upsertOrderReceivable(tx, tenantId, order, amount);
      return tx.receivable.findUniqueOrThrow({ where: { tenantId_sourceType_sourceId: { tenantId, sourceType: 'SERVICE_ORDER', sourceId: order.id } } });
    });
  }

  /* ---------------------------------------------------------- pagamentos */

  @Post('payments')
  @Perm('payment:receive')
  @Operational()
  @Idempotent()
  @Doc('Registra recebimento manual (único ou misto) em caixa aberto', { body: createPaymentSchema })
  pay(@ZBody(createPaymentSchema) body: z.infer<typeof createPaymentSchema>, @Headers('idempotency-key') key: string) {
    assertBranch(body.branchId);
    return this.db.run((tx, hooks) =>
      this.finance.receive(tx, hooks, {
        tenantId: currentTenantId(),
        branchId: body.branchId,
        cashSessionId: body.cashSessionId,
        receivableId: body.receivableId,
        parts: body.parts,
        idempotencyKey: key,
        notes: body.notes,
      }),
    );
  }

  @Get('payments')
  @Perm('sales:view')
  @Doc('Recebimentos', { query: paymentQuery })
  payments(@ZQuery(paymentQuery) q: z.infer<typeof paymentQuery>) {
    if (q.branchId) assertBranch(q.branchId);
    return this.db.run(async (tx) => {
      const where: Prisma.PaymentWhereInput = {
        tenantId: currentTenantId(),
        branchId: q.branchId ?? branchScope(),
        cashSessionId: q.cashSessionId,
        receivedAt: { gte: q.from, lte: q.to },
      };
      const [items, total] = await Promise.all([
        tx.payment.findMany({ where, include: { allocations: true, refunds: true }, orderBy: { receivedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
        tx.payment.count({ where }),
      ]);
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  @Post('payments/:id/refund')
  @Perm('payment:refund')
  @Operational()
  @Idempotent()
  @Doc('Estorna pagamento (parcial ou total)', { body: refundPaymentSchema })
  refund(@Param('id', ParseUUIDPipe) id: string, @ZBody(refundPaymentSchema) body: z.infer<typeof refundPaymentSchema>) {
    return this.db.run((tx) => this.finance.refund(tx, { tenantId: currentTenantId(), paymentId: id, ...body }));
  }

  /* ---------------------------------------------------------------- caixa */

  @Get('cash-registers')
  @Perm('cash:operate')
  @Doc('Caixas cadastrados')
  registers(@Query('branchId') branchId?: string) {
    return this.cash.listRegisters(branchId && /^[0-9a-f-]{36}$/i.test(branchId) ? branchId : undefined);
  }

  @Post('cash-registers')
  @Perm('cash:register_manage')
  @Operational()
  @Doc('Cadastra caixa (limite do plano por filial)', { body: cashRegisterSchema })
  createRegister(@ZBody(cashRegisterSchema) body: z.infer<typeof cashRegisterSchema>) {
    return this.cash.createRegister(body);
  }

  @Patch('cash-registers/:id')
  @Perm('cash:register_manage')
  @Operational()
  @Doc('Renomeia/ativa/desativa caixa', { body: updateRegisterSchema })
  updateRegister(@Param('id', ParseUUIDPipe) id: string, @ZBody(updateRegisterSchema) body: z.infer<typeof updateRegisterSchema>) {
    return this.cash.updateRegister(id, body);
  }

  @Post('cash-sessions/open')
  @Perm('cash:operate')
  @Operational()
  @Idempotent()
  @Doc('Abre sessão de caixa com fundo de troco', { body: openCashSchema })
  open(@ZBody(openCashSchema) body: z.infer<typeof openCashSchema>) {
    return this.cash.open(body);
  }

  @Get('cash-sessions/current')
  @Perm('cash:operate')
  @Doc('Sessões abertas do operador (ou da filial, com permissão)')
  current(@Query('branchId') branchId?: string) {
    return this.cash.current(branchId && /^[0-9a-f-]{36}$/i.test(branchId) ? branchId : undefined);
  }

  @Get('cash-sessions')
  @Perm('cash:operate')
  @Doc('Histórico de sessões', { query: historyQuery })
  history(@ZQuery(historyQuery) q: z.infer<typeof historyQuery>) {
    if (q.branchId) assertBranch(q.branchId);
    return this.cash.history(q);
  }

  @Post('cash-sessions/:id/supply')
  @Perm('cash:operate')
  @Operational()
  @Idempotent()
  @Doc('Suprimento de caixa', { body: cashMovementSchema })
  supply(@Param('id', ParseUUIDPipe) id: string, @ZBody(cashMovementSchema) body: z.infer<typeof cashMovementSchema>, @Headers('idempotency-key') key: string) {
    return this.cash.movement(id, 'SUPPLY', body, key);
  }

  @Post('cash-sessions/:id/withdraw')
  @Perm('cash:operate')
  @Operational()
  @Idempotent()
  @Doc('Sangria (não é despesa)', { body: cashMovementSchema })
  withdraw(@Param('id', ParseUUIDPipe) id: string, @ZBody(cashMovementSchema) body: z.infer<typeof cashMovementSchema>, @Headers('idempotency-key') key: string) {
    return this.cash.movement(id, 'WITHDRAWAL', body, key);
  }

  /** Sem @Operational: fechamento permitido durante suspensão (exceção auditada). */
  @Post('cash-sessions/:id/close')
  @Perm('cash:close')
  @Idempotent()
  @HttpCode(200)
  @Doc('Fecha sessão com conferência por método', { body: closeCashSchema })
  close(@Param('id', ParseUUIDPipe) id: string, @Body() raw: unknown) {
    return this.cash.close(id, closeCashSchema.parse(raw));
  }

  @Get('cash-sessions/:id/summary')
  @Perm('cash:operate')
  @Doc('Resumo esperado por método e movimentações')
  summary(@Param('id', ParseUUIDPipe) id: string) {
    return this.cash.summary(id);
  }
}
