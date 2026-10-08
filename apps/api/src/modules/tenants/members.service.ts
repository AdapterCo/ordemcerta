import { Inject, Injectable } from '@nestjs/common';
import { verify } from '@node-rs/argon2';
import { emailTemplate, randomToken, sha256Hex, type Tx } from '@ordemcerta/server';
import { ROLE_LABELS, type TenantRole, inviteMemberSchema, updateMemberSchema } from '@ordemcerta/shared';
import type { z } from 'zod';
import { auth, currentTenantId } from '../../core/context';
import { SystemPrisma, TenantDb } from '../../core/database';
import { ENV, type AppEnv } from '../../core/env.provider';
import { Errors } from '../../core/errors';
import { PlanLimitsService } from '../../core/plan-limits.service';
import { AuditService } from '../../core/services';

@Injectable()
export class MembersService {
  constructor(
    private readonly db: TenantDb,
    private readonly system: SystemPrisma,
    private readonly limits: PlanLimitsService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: AppEnv,
  ) {}

  list() {
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      const members = await tx.tenantMembership.findMany({
        where: { tenantId },
        include: {
          user: { select: { id: true, name: true, email: true, status: true } },
          branches: { select: { branchId: true, isTechnician: true } },
        },
        orderBy: { createdAt: 'asc' },
      });
      const invitations = await tx.invitation.findMany({
        where: { tenantId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true, email: true, role: true, branchIds: true, expiresAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      });
      return { members, invitations };
    });
  }

  /** Técnicos ativos por filial (para atribuição de OS). */
  technicians(branchId?: string) {
    return this.db.run((tx) =>
      tx.membershipBranch.findMany({
        where: { tenantId: currentTenantId(), isTechnician: true, branchId, membership: { status: 'ACTIVE' } },
        select: { branchId: true, membership: { select: { id: true, user: { select: { id: true, name: true } } } } },
      }),
    );
  }

  private assertRoleChangeAllowed(target: TenantRole) {
    const a = auth();
    if (target === 'TENANT_OWNER') throw Errors.forbidden('Use a transferência de propriedade');
    if (target === 'TENANT_ADMIN' && a.role !== 'TENANT_OWNER') throw Errors.forbidden('Somente o proprietário define administradores');
  }

  private async validateBranches(tx: Tx, tenantId: string, ids: string[]) {
    if (!ids.length) return;
    const found = await tx.branch.count({ where: { tenantId, id: { in: ids }, status: 'ACTIVE' } });
    if (found !== new Set(ids).size) throw Errors.validation('Filial inválida ou inativa');
  }

  invite(input: z.infer<typeof inviteMemberSchema>) {
    this.assertRoleChangeAllowed(input.role);
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      await this.validateBranches(tx, tenantId, [...input.branchIds, ...input.technicianBranchIds]);
      if (input.role !== 'TENANT_ADMIN' && !input.branchIds.length) throw Errors.validation('Selecione ao menos uma filial');
      const already = await tx.tenantMembership.findFirst({ where: { tenantId, status: 'ACTIVE', user: { email: input.email } } });
      if (already) throw Errors.conflict('Este e-mail já participa da empresa');
      await tx.invitation.updateMany({ where: { tenantId, email: input.email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      const token = randomToken(32);
      const inv = await tx.invitation.create({
        data: {
          tenantId,
          email: input.email,
          role: input.role,
          branchIds: input.branchIds,
          technicianBranchIds: input.role === 'TECHNICIAN' ? input.branchIds : input.technicianBranchIds,
          tokenHash: sha256Hex(token),
          expiresAt: new Date(Date.now() + 7 * 86_400_000),
          invitedBy: auth().userId,
        },
      });
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } });
      const payload = { tenantName: tenant.name, role: ROLE_LABELS[input.role], link: `${this.env.APP_URL}/invite#token=${token}` };
      const content = emailTemplate('invitation', payload);
      await tx.emailOutbox.create({ data: { tenantId, toEmail: input.email, subject: content.subject, template: 'invitation', payloadJson: payload } });
      await this.audit.log(tx, { action: 'member_invited', entity: 'invitation', entityId: inv.id, metadata: { role: input.role } });
      return { id: inv.id, email: inv.email, role: inv.role, expiresAt: inv.expiresAt };
    });
  }

  revokeInvitation(id: string) {
    return this.db.run(async (tx) => {
      const n = await tx.invitation.updateMany({ where: { id, tenantId: currentTenantId(), acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      if (!n.count) throw Errors.notFound('Convite');
      await this.audit.log(tx, { action: 'invitation_revoked', entity: 'invitation', entityId: id });
    });
  }

  update(membershipId: string, input: z.infer<typeof updateMemberSchema>) {
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      const a = auth();
      const m = await tx.tenantMembership.findFirst({ where: { id: membershipId, tenantId }, include: { branches: true } });
      if (!m) throw Errors.notFound('Membro');
      if (m.role === 'TENANT_OWNER') throw Errors.forbidden('O proprietário só muda via transferência de propriedade');
      if (m.userId === a.userId && input.status === 'DISABLED') throw Errors.forbidden('Você não pode desativar o próprio acesso');
      if (m.role === 'TENANT_ADMIN' && a.role !== 'TENANT_OWNER') throw Errors.forbidden('Somente o proprietário altera administradores');
      if (input.role) this.assertRoleChangeAllowed(input.role);

      const role = (input.role ?? m.role) as TenantRole;
      const status = input.status ?? m.status;
      const branchIds = input.branchIds ?? m.branches.map((b) => b.branchId);
      const techIds = new Set(role === 'TECHNICIAN' ? branchIds : (input.technicianBranchIds ?? m.branches.filter((b) => b.isTechnician).map((b) => b.branchId)));
      await this.validateBranches(tx, tenantId, branchIds);

      // Quota: só conta novas vagas técnicas (ou reativação).
      const wasActive = m.status === 'ACTIVE';
      const previousTech = new Set(m.branches.filter((b) => b.isTechnician).map((b) => b.branchId));
      if (status === 'ACTIVE') {
        for (const b of branchIds) {
          if (techIds.has(b) && (!previousTech.has(b) || !wasActive)) await this.limits.assert(tx, tenantId, 'technicians_per_branch', b);
        }
      }
      await tx.tenantMembership.update({ where: { id: m.id }, data: { role, status } });
      await tx.membershipBranch.deleteMany({ where: { membershipId: m.id } });
      for (const b of branchIds) {
        await tx.membershipBranch.create({ data: { tenantId, membershipId: m.id, branchId: b, isTechnician: techIds.has(b) } });
      }
      await this.audit.log(tx, {
        action: 'member_updated',
        entity: 'tenant_membership',
        entityId: m.id,
        metadata: { role, status, branches: branchIds.length, technicianBranches: techIds.size },
      });
      return { id: m.id, role, status };
    });
  }

  /** Transferência de propriedade com confirmação de senha. */
  async transferOwnership(membershipId: string, password: string) {
    const a = auth();
    if (a.role !== 'TENANT_OWNER') throw Errors.forbidden('Somente o proprietário pode transferir a propriedade');
    const me = await this.system.user.findUniqueOrThrow({ where: { id: a.userId } });
    if (!(await verify(me.passwordHash, password).catch(() => false))) throw Errors.invalidCredentials();
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      const target = await tx.tenantMembership.findFirst({ where: { id: membershipId, tenantId, status: 'ACTIVE' } });
      if (!target || target.userId === a.userId) throw Errors.notFound('Membro');
      await tx.tenantMembership.update({ where: { id: target.id }, data: { role: 'TENANT_OWNER' } });
      await tx.tenantMembership.update({ where: { id: a.membershipId! }, data: { role: 'TENANT_ADMIN' } });
      await this.audit.log(tx, { action: 'ownership_transferred', entity: 'tenant_membership', entityId: target.id });
      return { ok: true };
    });
  }
}
