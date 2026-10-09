import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { type Tx } from '@ordemcerta/server';
import { type TenantRole, createMemberSchema, updateMemberSchema } from '@ordemcerta/shared';
import { randomInt } from 'node:crypto';
import type { z } from 'zod';
import { auth, currentTenantId } from '../../core/context';
import { SystemPrisma, TenantDb } from '../../core/database';
import { Errors } from '../../core/errors';
import { PlanLimitsService } from '../../core/plan-limits.service';
import { AuditService } from '../../core/services';
import { ARGON2_OPTS } from '../auth/auth.service';

/** Senha provisória legível (sem caracteres ambíguos) que atende à política: letras + números, 12 caracteres. */
function temporaryPassword(): string {
  const letters = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const pick = (set: string, n: number) => Array.from({ length: n }, () => set[randomInt(set.length)]).join('');
  return `${pick(letters, 4)}-${pick(digits, 4)}-${pick(letters, 2)}`;
}

@Injectable()
export class MembersService {
  constructor(
    private readonly db: TenantDb,
    private readonly system: SystemPrisma,
    private readonly limits: PlanLimitsService,
    private readonly audit: AuditService,
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
      return { members };
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

  /**
   * Cadastro direto pelo dono/administrador. Usuário novo recebe senha provisória
   * (troca obrigatória no primeiro login). E-mail que já tem conta (ex.: trabalha em outra
   * empresa) só ganha o vínculo, sem alterar a senha dele.
   */
  async create(input: z.infer<typeof createMemberSchema>) {
    this.assertRoleChangeAllowed(input.role);
    if (input.role !== 'TENANT_ADMIN' && !input.branchIds.length) throw Errors.validation('Selecione ao menos uma filial');
    const tenantId = currentTenantId();
    const actorId = auth().userId;
    const provisional = input.password ?? temporaryPassword();
    const passwordHash = await hash(provisional, ARGON2_OPTS);
    const techIds = new Set(input.role === 'TECHNICIAN' ? input.branchIds : input.technicianBranchIds);

    // Papel de sistema: a tabela de usuários não é gravável pelo papel da aplicação (escopo de tenant explícito).
    const r = await this.system.$transaction(async (tx) => {
      await this.validateBranches(tx, tenantId, [...input.branchIds, ...input.technicianBranchIds]);
      let user = await tx.user.findUnique({ where: { email: input.email } });
      if (user?.platformRole) throw Errors.conflict('Este e-mail é reservado à administração da plataforma');
      const created = !user;
      if (!user) user = await tx.user.create({ data: { email: input.email, name: input.name, passwordHash, mustChangePassword: true } });
      const existing = await tx.tenantMembership.findUnique({ where: { tenantId_userId: { tenantId, userId: user.id } } });
      if (existing?.status === 'ACTIVE') throw Errors.conflict('Este e-mail já participa da empresa');
      const membership = existing
        ? await tx.tenantMembership.update({ where: { id: existing.id }, data: { role: input.role, status: 'ACTIVE' } })
        : await tx.tenantMembership.create({ data: { tenantId, userId: user.id, role: input.role } });
      await tx.membershipBranch.deleteMany({ where: { membershipId: membership.id } });
      for (const b of new Set(input.branchIds)) {
        const isTechnician = techIds.has(b);
        if (isTechnician) await this.limits.assert(tx, tenantId, 'technicians_per_branch', b);
        await tx.membershipBranch.create({ data: { tenantId, membershipId: membership.id, branchId: b, isTechnician } });
      }
      await tx.auditLog.create({
        data: {
          tenantId,
          actorId,
          action: created ? 'member_created' : 'member_linked_existing_user',
          entity: 'tenant_membership',
          entityId: membership.id,
          metadataJson: { role: input.role },
        },
      });
      return { membershipId: membership.id, created };
    });
    return {
      membershipId: r.membershipId,
      email: input.email,
      // exibida uma única vez; nunca armazenada em texto
      temporaryPassword: r.created ? provisional : null,
      existingAccount: !r.created,
    };
  }

  /**
   * Redefine a senha de um funcionário (ex.: esqueceu e o e-mail não está configurado).
   * Só para quem pertence exclusivamente a esta empresa: impede tomar a conta de quem
   * também trabalha em outra empresa. Proprietário e plataforma nunca.
   */
  async resetPassword(membershipId: string, password?: string) {
    const a = auth();
    const tenantId = currentTenantId();
    const m = await this.system.tenantMembership.findFirst({ where: { id: membershipId, tenantId }, include: { user: true } });
    if (!m) throw Errors.notFound('Membro');
    if (m.userId === a.userId) throw Errors.forbidden('Para a sua própria senha use "Alterar senha" no seu perfil');
    if (m.role === 'TENANT_OWNER' || m.user.platformRole) throw Errors.forbidden('Não é possível redefinir a senha deste usuário');
    if (m.role === 'TENANT_ADMIN' && a.role !== 'TENANT_OWNER') throw Errors.forbidden('Somente o proprietário redefine a senha de administradores');
    const elsewhere = await this.system.tenantMembership.count({ where: { userId: m.userId, NOT: { tenantId } } });
    if (elsewhere) throw Errors.forbidden('Este usuário também participa de outra empresa; ele deve usar "Esqueci a senha"');
    const provisional = password ?? temporaryPassword();
    const passwordHash = await hash(provisional, ARGON2_OPTS);
    await this.system.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: m.userId },
        data: { passwordHash, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null, passwordChangedAt: new Date() },
      });
      await tx.session.updateMany({ where: { userId: m.userId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'password_reset_by_admin' } });
      await tx.auditLog.create({ data: { tenantId, actorId: a.userId, action: 'member_password_reset', entity: 'tenant_membership', entityId: m.id } });
    });
    return { email: m.user.email, temporaryPassword: provisional };
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
