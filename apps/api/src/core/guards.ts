import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALL_BRANCHES_ROLES, permissionsForRole, type Permission, type TenantRole } from '@ordemcerta/shared';
import type { Request } from 'express';
import { ctx, type AuthContext } from './context';
import { SystemPrisma } from './database';
import { META_NO_TENANT, META_OPERATIONAL, META_PERMS, META_PLATFORM, META_PUBLIC } from './decorators';
import { Errors } from './errors';
import { AuditService, SubscriptionStateService } from './services';
import { TokenService, type AccessClaims } from './token.service';

/** Permissões do acesso temporário de suporte: somente leitura. */
const SUPPORT_PERMISSIONS: Permission[] = [
  'os:view', 'customer:view', 'product:view', 'stock:view', 'sales:view', 'reports:view',
  'warranty:view', 'messaging:view', 'audit:view', 'billing:view',
];

/** Resolve sessão + vínculo a cada requisição (revogação imediata de acesso). */
@Injectable()
export class AuthResolver {
  constructor(private readonly system: SystemPrisma) {}

  async resolve(claims: AccessClaims): Promise<AuthContext> {
    const session = await this.system.session.findFirst({
      where: { id: claims.sid, userId: claims.sub, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { user: { select: { id: true, email: true, name: true, status: true, platformRole: true } } },
    });
    if (!session || session.user.status !== 'ACTIVE') throw Errors.unauthenticated('Sessão encerrada');
    if ((claims.tid ?? null) !== (session.tenantId ?? null)) throw Errors.unauthenticated('Sessão desatualizada');

    const base: AuthContext = {
      userId: session.user.id,
      sessionId: session.id,
      email: session.user.email,
      name: session.user.name,
      platformRole: session.user.platformRole,
      mfaVerified: session.mfaVerified,
      tenantId: null,
      membershipId: null,
      role: null,
      permissions: new Set(),
      branchIds: [],
      allBranches: false,
      technicianBranchIds: [],
      supportAccess: false,
    };
    if (!session.tenantId) return base;

    const membership = await this.system.tenantMembership.findFirst({
      where: { tenantId: session.tenantId, userId: session.userId, status: 'ACTIVE' },
      include: { branches: { include: { branch: { select: { status: true } } } } },
    });
    if (membership) {
      const role = membership.role as TenantRole;
      const active = membership.branches.filter((b) => b.branch.status === 'ACTIVE');
      return {
        ...base,
        tenantId: session.tenantId,
        membershipId: membership.id,
        role,
        permissions: permissionsForRole(role),
        allBranches: ALL_BRANCHES_ROLES.includes(role),
        branchIds: active.map((b) => b.branchId),
        technicianBranchIds: active.filter((b) => b.isTechnician).map((b) => b.branchId),
      };
    }

    if (session.user.platformRole === 'PLATFORM_SUPERADMIN' && session.mfaVerified) {
      const grant = await this.system.supportAccessGrant.findFirst({
        where: { tenantId: session.tenantId, platformUserId: session.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      });
      if (grant) {
        return { ...base, tenantId: session.tenantId, permissions: new Set(SUPPORT_PERMISSIONS), allBranches: true, supportAccess: true };
      }
    }
    throw Errors.unauthenticated('Acesso à empresa revogado');
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly resolver: AuthResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    if (this.reflector.getAllAndOverride<boolean>(META_PUBLIC, [context.getHandler(), context.getClass()])) return true;
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw Errors.unauthenticated();
    const claims = await this.tokens.verifyAccess(header.slice(7));
    ctx().auth = await this.resolver.resolve(claims);
    return true;
  }
}

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly subscriptions: SubscriptionStateService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(META_PUBLIC, targets)) return true;
    const a = ctx().auth;
    if (!a) throw Errors.unauthenticated();
    const req = context.switchToHttp().getRequest<Request>();

    if (this.reflector.getAllAndOverride<boolean>(META_PLATFORM, targets)) {
      if (a.platformRole !== 'PLATFORM_SUPERADMIN') throw Errors.forbidden();
      if (!a.mfaVerified) throw Errors.forbidden('MFA obrigatória para a administração da plataforma');
      return true;
    }

    const noTenant = this.reflector.getAllAndOverride<boolean>(META_NO_TENANT, targets);
    if (!noTenant && !a.tenantId) throw Errors.forbidden('Selecione uma empresa para continuar');

    const perms = this.reflector.getAllAndOverride<Permission[]>(META_PERMS, targets) ?? [];
    for (const p of perms) if (!a.permissions.has(p)) throw Errors.forbidden('Permissão insuficiente');

    if (a.supportAccess) {
      if (req.method !== 'GET') throw Errors.forbidden('Acesso de suporte é somente leitura');
      await this.audit.logSystem({ action: 'support_access', entity: 'http', entityId: null, metadata: { path: req.path, method: req.method } });
    }

    if (a.tenantId && this.reflector.getAllAndOverride<boolean>(META_OPERATIONAL, targets)) {
      await this.subscriptions.assertOperational(a.tenantId);
    }
    return true;
  }
}
