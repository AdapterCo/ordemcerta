import { Injectable } from '@nestjs/common';
import { Prisma, type PaymentMethod } from '@prisma/client';
import { isUniqueViolation, type Tx } from '@ordemcerta/server';
import { ErrorCode, PAYMENT_METHODS, cashMovementSchema, cashRegisterSchema, closeCashSchema, openCashSchema } from '@ordemcerta/shared';
import type { z } from 'zod';
import { assertBranch, auth, branchScope, can, currentTenantId } from '../../core/context';
import { TenantDb } from '../../core/database';
import { DomainError, Errors } from '../../core/errors';
import { PlanLimitsService } from '../../core/plan-limits.service';
import { AuditService, OutboxService, SubscriptionStateService } from '../../core/services';
import { SettingsService } from '../../core/settings.service';
import { FinanceService } from './finance.service';

type Totals = Record<PaymentMethod, number>;
const zero = (): Totals => Object.fromEntries(PAYMENT_METHODS.map((m) => [m, 0])) as Totals;

@Injectable()
export class CashService {
  constructor(
    private readonly db: TenantDb,
    private readonly limits: PlanLimitsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly settings: SettingsService,
    private readonly finance: FinanceService,
    private readonly subscriptions: SubscriptionStateService,
  ) {}

  /* ---------------------------------------------------------------- caixas */

  listRegisters(branchId?: string) {
    if (branchId) assertBranch(branchId);
    return this.db.run((tx) =>
      tx.cashRegister.findMany({
        where: { tenantId: currentTenantId(), branchId: branchId ?? branchScope() },
        include: { sessions: { where: { status: 'OPEN' }, select: { id: true, openedBy: true, openedAt: true } } },
        orderBy: [{ branchId: 'asc' }, { name: 'asc' }],
      }),
    );
  }

  createRegister(input: z.infer<typeof cashRegisterSchema>) {
    assertBranch(input.branchId);
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      await this.limits.assert(tx, tenantId, 'cash_registers_per_branch', input.branchId);
      const r = await tx.cashRegister.create({ data: { tenantId, branchId: input.branchId, name: input.name } });
      await this.audit.log(tx, { action: 'cash_register_created', entity: 'cash_register', entityId: r.id });
      return r;
    });
  }

  updateRegister(id: string, input: { name?: string; active?: boolean }) {
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      const r = await tx.cashRegister.findFirst({ where: { id, tenantId } });
      if (!r) throw Errors.notFound('Caixa');
      assertBranch(r.branchId);
      if (input.active === true && !r.active) await this.limits.assert(tx, tenantId, 'cash_registers_per_branch', r.branchId);
      if (input.active === false && (await tx.cashSession.count({ where: { tenantId, registerId: id, status: 'OPEN' } }))) {
        throw Errors.precondition('Feche a sessão aberta antes de desativar o caixa');
      }
      const u = await tx.cashRegister.update({ where: { id }, data: { name: input.name, active: input.active } });
      await this.audit.log(tx, { action: 'cash_register_updated', entity: 'cash_register', entityId: id, metadata: input });
      return u;
    });
  }

  /* --------------------------------------------------------------- sessões */

  open(input: z.infer<typeof openCashSchema>) {
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      const a = auth();
      const reg = await tx.cashRegister.findFirst({ where: { id: input.registerId, tenantId, active: true } });
      if (!reg) throw Errors.notFound('Caixa');
      assertBranch(reg.branchId);
      if (await this.settings.get(tx, tenantId, 'cash.one_session_per_operator', reg.branchId)) {
        const mine = await tx.cashSession.findFirst({ where: { tenantId, openedBy: a.userId, status: 'OPEN' } });
        if (mine) throw new DomainError(ErrorCode.CASH_SESSION_CONFLICT, 'Você já possui um caixa aberto', 409, { sessionId: mine.id });
      }
      try {
        const s = await tx.cashSession.create({
          data: { tenantId, branchId: reg.branchId, registerId: reg.id, openedBy: a.userId, openingFloatCents: input.openingFloatCents, openLock: reg.id },
        });
        if (input.openingFloatCents > 0) {
          await tx.cashMovement.create({
            data: { tenantId, cashSessionId: s.id, type: 'OPENING', method: 'CASH', amountCents: input.openingFloatCents, reason: 'Fundo de troco', actorId: a.userId },
          });
        }
        await this.audit.log(tx, { action: 'cash_opened', entity: 'cash_session', entityId: s.id, metadata: { openingFloatCents: input.openingFloatCents } });
        return s;
      } catch (e) {
        if (isUniqueViolation(e, 'open_lock')) throw new DomainError(ErrorCode.CASH_SESSION_CONFLICT, 'Este caixa já está aberto', 409);
        throw e;
      }
    });
  }

  current(branchId?: string) {
    return this.db.run((tx) =>
      tx.cashSession.findMany({
        where: {
          tenantId: currentTenantId(),
          status: 'OPEN',
          ...(can('cash:view_all') ? { branchId: branchId ?? branchScope() } : { openedBy: auth().userId }),
        },
        include: { register: { select: { name: true } } },
      }),
    );
  }

  history(q: { branchId?: string; page: number; pageSize: number }) {
    return this.db.run(async (tx) => {
      const where: Prisma.CashSessionWhereInput = {
        tenantId: currentTenantId(),
        branchId: q.branchId ?? branchScope(),
        ...(can('cash:view_all') ? {} : { openedBy: auth().userId }),
      };
      const [items, total] = await Promise.all([
        tx.cashSession.findMany({ where, include: { register: { select: { name: true } } }, orderBy: { openedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
        tx.cashSession.count({ where }),
      ]);
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  private async expected(tx: Tx, tenantId: string, sessionId: string) {
    const movements = await tx.cashMovement.findMany({ where: { tenantId, cashSessionId: sessionId }, orderBy: { createdAt: 'asc' } });
    const exp = zero();
    const inflow = zero();
    const refunds = zero();
    let supplies = 0;
    let withdrawals = 0;
    for (const m of movements) {
      switch (m.type) {
        case 'OPENING':
          exp.CASH += m.amountCents;
          break;
        case 'SUPPLY':
          exp.CASH += m.amountCents;
          supplies += m.amountCents;
          break;
        case 'WITHDRAWAL':
          exp.CASH -= m.amountCents;
          withdrawals += m.amountCents;
          break;
        case 'PAYMENT_IN':
          exp[m.method] += m.amountCents;
          inflow[m.method] += m.amountCents;
          break;
        case 'REFUND_OUT':
        case 'CHANGE_OUT':
          exp[m.method] -= m.amountCents;
          refunds[m.method] += m.amountCents;
          break;
      }
    }
    return { expected: exp, received: inflow, refunds, supplies, withdrawals, movements };
  }

  private async loadSession(tx: Tx, id: string) {
    const s = await tx.cashSession.findFirst({ where: { id, tenantId: currentTenantId() }, include: { register: { select: { name: true } } } });
    if (!s) throw Errors.notFound('Sessão de caixa');
    assertBranch(s.branchId);
    if (s.openedBy !== auth().userId && !can('cash:view_all')) throw Errors.forbidden('Sessão de outro operador');
    return s;
  }

  summary(id: string) {
    return this.db.run(async (tx) => {
      const s = await this.loadSession(tx, id);
      const e = await this.expected(tx, s.tenantId, id);
      return { session: s, ...e };
    });
  }

  /** Suprimento/sangria serializados por lock na sessão (sangrias simultâneas não estouram o saldo). */
  movement(id: string, type: 'SUPPLY' | 'WITHDRAWAL', input: z.infer<typeof cashMovementSchema>, idempotencyKey: string) {
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      await tx.$queryRaw`SELECT id FROM cash_sessions WHERE id = ${id}::uuid FOR UPDATE`;
      const s = await this.loadSession(tx, id);
      if (s.status !== 'OPEN') throw new DomainError(ErrorCode.CASH_SESSION_REQUIRED, 'Sessão de caixa fechada', 409);
      if (type === 'WITHDRAWAL') {
        const { expected } = await this.expected(tx, tenantId, id);
        if (input.amountCents > expected.CASH) throw Errors.precondition('Sangria maior que o dinheiro disponível no caixa', { availableCents: expected.CASH });
      }
      const m = await tx.cashMovement.create({
        data: { tenantId, cashSessionId: id, type, method: 'CASH', amountCents: input.amountCents, reason: input.reason, idempotencyKey, actorId: auth().userId },
      });
      await this.audit.log(tx, { action: type === 'SUPPLY' ? 'cash_supply' : 'cash_withdrawal', entity: 'cash_session', entityId: id, metadata: { amountCents: input.amountCents } });
      return m;
    });
  }

  /**
   * Fechamento com conferência por método. Permitido mesmo com assinatura
   * suspensa (exceção auditada, evita inconsistência financeira).
   */
  close(id: string, input: z.infer<typeof closeCashSchema>) {
    return this.db.run(async (tx, hooks) => {
      const tenantId = currentTenantId();
      await tx.$queryRaw`SELECT id FROM cash_sessions WHERE id = ${id}::uuid FOR UPDATE`;
      const s = await this.loadSession(tx, id);
      if (s.status !== 'OPEN') throw Errors.conflict('Sessão já fechada');
      await bumpCash(tx, id, s.version);
      const e = await this.expected(tx, tenantId, id);
      const declared = { ...zero(), ...input.declared } as Totals;
      const diff = zero();
      let total = 0;
      for (const m of PAYMENT_METHODS) {
        diff[m] = declared[m] - e.expected[m];
        total += diff[m];
      }
      const operational = await this.subscriptions.isOperational(tenantId);
      await tx.cashSession.update({
        where: { id },
        data: {
          status: 'CLOSED',
          openLock: null,
          closedBy: auth().userId,
          closedAt: new Date(),
          declaredTotalsJson: declared as Prisma.InputJsonValue,
          expectedTotalsJson: e.expected as Prisma.InputJsonValue,
          differenceCents: total,
          closeNotes: input.notes,
          closedWhileSuspended: !operational,
        },
      });
      await this.finance.postLedger(
        tx,
        tenantId,
        PAYMENT_METHODS.filter((m) => diff[m] !== 0).map((m) => ({
          branchId: s.branchId,
          sourceType: 'CASH_SESSION',
          sourceId: id,
          entryType: 'CASH_DIFFERENCE' as const,
          amountCents: diff[m],
          method: m,
          memo: 'Diferença de fechamento',
        })),
      );
      await this.audit.log(tx, {
        action: operational ? 'cash_closed' : 'cash_closed_while_suspended',
        entity: 'cash_session',
        entityId: id,
        metadata: { differenceCents: total },
      });
      await this.outbox.add(tx, hooks, tenantId, { eventType: 'cash.closed', aggregateType: 'cash_session', aggregateId: id, payload: { differenceCents: total } });
      return { id, expected: e.expected, declared, difference: diff, differenceCents: total };
    });
  }
}

async function bumpCash(tx: Tx, id: string, version: number) {
  const n = await tx.$executeRaw`UPDATE cash_sessions SET version = version + 1 WHERE id = ${id}::uuid AND version = ${version}`;
  if (n !== 1) throw Errors.versionConflict();
}
