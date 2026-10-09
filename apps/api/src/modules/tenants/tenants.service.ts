import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { branchSchema, supportAccessGrantSchema, updateBranchSchema, updateTenantSchema } from '@ordemcerta/shared';
import type { z } from 'zod';
import { assertBranch, auth, branchScope, currentTenantId } from '../../core/context';
import { SystemPrisma, TenantDb } from '../../core/database';
import { Errors } from '../../core/errors';
import { PlanLimitsService } from '../../core/plan-limits.service';
import { AuditService, SubscriptionStateService } from '../../core/services';
import { SettingsService } from '../../core/settings.service';

@Injectable()
export class TenantsService {
  constructor(
    private readonly db: TenantDb,
    private readonly system: SystemPrisma,
    private readonly limits: PlanLimitsService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly subscriptions: SubscriptionStateService,
  ) {}

  getTenant() {
    return this.db.run((tx) =>
      tx.tenant.findUniqueOrThrow({
        where: { id: currentTenantId() },
        select: {
          id: true, name: true, legalName: true, document: true, status: true, timezone: true, phone: true, email: true,
          address: true, primaryColor: true, onboardingCompletedAt: true, createdAt: true,
        },
      }),
    );
  }

  updateTenant(input: z.infer<typeof updateTenantSchema>) {
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      const data: Prisma.TenantUpdateInput = {};
      for (const k of ['name', 'legalName', 'document', 'timezone', 'phone', 'email', 'primaryColor'] as const) {
        if (input[k] !== undefined) (data as Record<string, unknown>)[k] = input[k];
      }
      if (input.address !== undefined) data.address = input.address as Prisma.InputJsonValue;
      const t = await tx.tenant.update({ where: { id: tenantId }, data, select: { id: true, name: true } });
      await this.audit.log(tx, { action: 'tenant_updated', entity: 'tenant', entityId: tenantId, metadata: { fields: Object.keys(data) } });
      return t;
    });
  }

  completeOnboarding() {
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      const branches = await tx.branch.count({ where: { tenantId, status: 'ACTIVE' } });
      if (!branches) throw Errors.precondition('Cadastre ao menos uma filial');
      await tx.tenant.update({ where: { id: tenantId }, data: { onboardingCompletedAt: new Date() } });
      await this.audit.log(tx, { action: 'onboarding_completed', entity: 'tenant', entityId: tenantId });
      return { ok: true };
    });
  }

  usage() {
    return this.db.run((tx) => this.limits.usage(tx, currentTenantId()));
  }

  /* --------------------------------------------------------------- filiais */

  listBranches(includeInactive = false) {
    return this.db.run((tx) =>
      tx.branch.findMany({
        where: { tenantId: currentTenantId(), ...(includeInactive ? {} : { status: 'ACTIVE' }), id: branchScope() },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  getBranch(id: string) {
    assertBranch(id);
    return this.db.run(async (tx) => {
      const b = await tx.branch.findFirst({ where: { id, tenantId: currentTenantId() }, include: { stockLocations: true, cashRegisters: true } });
      if (!b) throw Errors.notFound('Filial');
      return b;
    });
  }

  createBranch(input: z.infer<typeof branchSchema>) {
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      await this.limits.assert(tx, tenantId, 'branches');
      const branch = await tx.branch.create({
        data: {
          tenantId,
          name: input.name,
          phone: input.phone,
          timezone: input.timezone,
          address: (input.address ?? undefined) as Prisma.InputJsonValue | undefined,
          businessHours: (input.businessHours ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
      await tx.stockLocation.create({ data: { tenantId, branchId: branch.id, name: 'Principal', isDefault: true } });
      await this.audit.log(tx, { action: 'branch_created', entity: 'branch', entityId: branch.id });
      return branch;
    });
  }

  updateBranch(id: string, input: z.infer<typeof updateBranchSchema>) {
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      const current = await tx.branch.findFirst({ where: { id, tenantId } });
      if (!current) throw Errors.notFound('Filial');
      if (input.status === 'ACTIVE' && current.status === 'INACTIVE') await this.limits.assert(tx, tenantId, 'branches');
      if (input.status === 'INACTIVE' && current.status === 'ACTIVE') {
        const open = await tx.cashSession.count({ where: { tenantId, branchId: id, status: 'OPEN' } });
        if (open) throw Errors.precondition('Feche os caixas abertos da filial antes de desativá-la');
      }
      const data: Prisma.BranchUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.phone !== undefined) data.phone = input.phone;
      if (input.timezone !== undefined) data.timezone = input.timezone;
      if (input.status !== undefined) data.status = input.status;
      if (input.address !== undefined) data.address = input.address as Prisma.InputJsonValue;
      if (input.businessHours !== undefined) data.businessHours = input.businessHours as Prisma.InputJsonValue;
      const b = await tx.branch.update({ where: { id }, data });
      await this.audit.log(tx, { action: 'branch_updated', entity: 'branch', entityId: id, metadata: { fields: Object.keys(data) } });
      return b;
    });
  }

  /* --------------------------------------------------------- configurações */

  getSettings(branchId?: string) {
    if (branchId) assertBranch(branchId);
    return this.db.run((tx) => this.settings.all(tx, currentTenantId(), branchId));
  }

  putSettings(entries: Array<{ key: string; value?: unknown; branchId?: string | null }>) {
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      for (const e of entries) {
        if (e.branchId) assertBranch(e.branchId);
        await this.settings.set(tx, tenantId, e.key, e.value, e.branchId ?? null, auth().userId);
      }
      await this.audit.log(tx, { action: 'settings_updated', entity: 'settings', metadata: { keys: entries.map((e) => e.key) } });
      return this.settings.all(tx, tenantId);
    });
  }

  /* -------------------------------------------- acesso de suporte (LGPD) */

  async grantSupportAccess(input: z.infer<typeof supportAccessGrantSchema>) {
    const a = auth();
    if (a.role !== 'TENANT_OWNER') throw Errors.forbidden('Somente o proprietário autoriza acesso de suporte');
    const platformUser = await this.system.user.findUnique({ where: { email: input.platformUserEmail }, select: { id: true, platformRole: true } });
    if (!platformUser?.platformRole) throw Errors.notFound('Usuário de suporte');
    return this.db.run(async (tx) => {
      const g = await tx.supportAccessGrant.create({
        data: {
          tenantId: a.tenantId!,
          platformUserId: platformUser.id,
          reason: input.reason,
          grantedBy: a.userId,
          expiresAt: new Date(Date.now() + input.hours * 3600_000),
        },
      });
      await this.audit.log(tx, { action: 'support_access_granted', entity: 'support_access_grant', entityId: g.id, metadata: { hours: input.hours } });
      return g;
    });
  }

  listSupportAccess() {
    return this.db.run((tx) => tx.supportAccessGrant.findMany({ where: { tenantId: currentTenantId() }, orderBy: { createdAt: 'desc' }, take: 50 }));
  }

  revokeSupportAccess(id: string) {
    return this.db.run(async (tx) => {
      const n = await tx.supportAccessGrant.updateMany({ where: { id, tenantId: currentTenantId(), revokedAt: null }, data: { revokedAt: new Date() } });
      if (!n.count) throw Errors.notFound('Acesso');
      await this.audit.log(tx, { action: 'support_access_revoked', entity: 'support_access_grant', entityId: id });
    });
  }

  auditTrail(query: { entity?: string; entityId?: string; page: number; pageSize: number }) {
    return this.db.run(async (tx) => {
      const where: Prisma.AuditLogWhereInput = { tenantId: currentTenantId(), entity: query.entity, entityId: query.entityId };
      const [items, total] = await Promise.all([
        tx.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
        tx.auditLog.count({ where }),
      ]);
      return { items, total, page: query.page, pageSize: query.pageSize };
    });
  }

  invalidateSubscriptionCache() {
    this.subscriptions.invalidate(currentTenantId());
  }
}
