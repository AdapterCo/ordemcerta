import { Injectable } from '@nestjs/common';
import type { Tx } from '@ordemcerta/server';
import type { QuotaKind } from '@ordemcerta/shared';
import { Errors } from './errors';

/**
 * Quotas do plano (17.1) validadas no backend, em transação e com lock por
 * tenant (advisory lock), impedindo que operações concorrentes ultrapassem o
 * limite. Downgrade agendado já restringe ao menor limite.
 */
@Injectable()
export class PlanLimitsService {
  async lock(tx: Tx, tenantId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'quota:' + tenantId}))`;
  }

  async limits(tx: Tx, tenantId: string) {
    const sub = await tx.subscription.findUnique({ where: { tenantId }, include: { plan: true, scheduledPlan: true } });
    if (!sub) throw Errors.subscriptionInactive('NONE');
    const p = sub.plan;
    const s = sub.scheduledPlan;
    return {
      planCode: p.code,
      maxBranches: Math.min(p.maxBranches, s?.maxBranches ?? Infinity),
      maxTechniciansPerBranch: Math.min(p.maxTechniciansPerBranch, s?.maxTechniciansPerBranch ?? Infinity),
      maxCashRegistersPerBranch: Math.min(p.maxCashRegistersPerBranch, s?.maxCashRegistersPerBranch ?? Infinity),
    };
  }

  /**
   * Garante vaga para +1 unidade. `exclude` permite reativar/reatribuir sem
   * contar o próprio registro.
   */
  async assert(tx: Tx, tenantId: string, kind: QuotaKind, branchId?: string, adding = 1) {
    await this.lock(tx, tenantId);
    const l = await this.limits(tx, tenantId);
    let current = 0;
    let limit = 0;
    if (kind === 'branches') {
      current = await tx.branch.count({ where: { tenantId, status: 'ACTIVE' } });
      limit = l.maxBranches;
    } else if (kind === 'technicians_per_branch') {
      current = await tx.membershipBranch.count({ where: { tenantId, branchId, isTechnician: true, membership: { status: 'ACTIVE' } } });
      limit = l.maxTechniciansPerBranch;
    } else {
      current = await tx.cashRegister.count({ where: { tenantId, branchId, active: true } });
      limit = l.maxCashRegistersPerBranch;
    }
    if (current + adding > limit) throw Errors.planLimit({ kind, limit, current, plan: l.planCode, branchId });
  }

  async usage(tx: Tx, tenantId: string) {
    const l = await this.limits(tx, tenantId);
    const branches = await tx.branch.findMany({ where: { tenantId, status: 'ACTIVE' }, select: { id: true, name: true }, orderBy: { createdAt: 'asc' } });
    const perBranch = [];
    for (const b of branches) {
      perBranch.push({
        branchId: b.id,
        branchName: b.name,
        technicians: await tx.membershipBranch.count({ where: { tenantId, branchId: b.id, isTechnician: true, membership: { status: 'ACTIVE' } } }),
        cashRegisters: await tx.cashRegister.count({ where: { tenantId, branchId: b.id, active: true } }),
      });
    }
    return { limits: l, activeBranches: branches.length, perBranch };
  }
}
