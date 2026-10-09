import { Inject, Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { randomToken, sha256Hex, emailTemplate } from '@ordemcerta/server';
import { ErrorCode, isOperational, permissionsForRole, type TenantRole } from '@ordemcerta/shared';
import { authenticator } from 'otplib';
import { auth as authCtx, maybeCtx } from '../../core/context';
import { SystemPrisma } from '../../core/database';
import { ENV, type AppEnv } from '../../core/env.provider';
import { DomainError, Errors } from '../../core/errors';
import { AuditService, CryptoService } from '../../core/services';
import { TokenService } from '../../core/token.service';

/** Argon2id — parâmetros OWASP (m=19 MiB, t=2, p=1). */
export const ARGON2_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
const DUMMY_HASH = '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$Gk3BXv5sqDSy4pTx5pGzUbKgr2WJ8rDZ2HgW6R1mQ2c';
const MAX_ATTEMPTS = 5;

export interface IssuedSession {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  sessionId: string;
}

export type LoginResult =
  | ({ kind: 'session' } & IssuedSession)
  | { kind: 'mfa_required'; mfaToken: string }
  | { kind: 'mfa_setup_required'; mfaToken: string }
  | { kind: 'password_change_required'; mfaToken: string };

@Injectable()
export class AuthService {
  constructor(
    private readonly db: SystemPrisma,
    private readonly tokens: TokenService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: AppEnv,
  ) {}

  hashPassword(password: string) {
    return hash(password, ARGON2_OPTS);
  }

  /* ---------------------------------------------------------------- login */

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.db.user.findUnique({ where: { email } });
    if (!user) {
      await verify(DUMMY_HASH, password).catch(() => false); // tempo constante contra enumeração
      throw Errors.invalidCredentials();
    }
    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      throw new DomainError(ErrorCode.ACCOUNT_LOCKED, 'Muitas tentativas. Tente novamente mais tarde.', 429, { until: user.lockedUntil });
    }
    const ok = await verify(user.passwordHash, password).catch(() => false);
    if (!ok || user.status !== 'ACTIVE') {
      const failed = user.failedLoginCount + 1;
      // bloqueio progressivo: 1, 2, 4, 8... minutos (máx. 60) a partir da 5ª falha
      const lockedUntil = failed >= MAX_ATTEMPTS ? new Date(now.getTime() + Math.min(2 ** (failed - MAX_ATTEMPTS), 60) * 60_000) : null;
      await this.db.user.update({ where: { id: user.id }, data: { failedLoginCount: failed, lockedUntil } });
      await this.audit.logSystem({ tenantId: null, actorId: user.id, action: 'login_failed', entity: 'user', entityId: user.id, metadata: { failed } });
      throw Errors.invalidCredentials();
    }
    await this.db.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });

    // Senha provisória (cadastro/redefinição pelo dono): troca obrigatória antes de qualquer sessão.
    if (user.mustChangePassword) return { kind: 'password_change_required', mfaToken: await this.tokens.signMfa(user.id, 'password') };
    return this.afterPassword(user);
  }

  /** Etapas seguintes à senha válida: MFA quando exigida, senão abre a sessão. */
  private async afterPassword(user: { id: string; mfaEnabled: boolean; platformRole: string | null }): Promise<LoginResult> {
    if (user.mfaEnabled) return { kind: 'mfa_required', mfaToken: await this.tokens.signMfa(user.id, 'verify') };
    if (user.platformRole === 'PLATFORM_SUPERADMIN') return { kind: 'mfa_setup_required', mfaToken: await this.tokens.signMfa(user.id, 'setup') };
    return { kind: 'session', ...(await this.createSession(user.id, false)) };
  }

  /** Troca obrigatória da senha provisória (token da etapa de login, válido por 5 min). */
  async completeFirstPassword(token: string, newPassword: string): Promise<LoginResult> {
    const { userId, purpose } = await this.tokens.verifyMfa(token);
    if (purpose !== 'password') throw Errors.unauthenticated();
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.mustChangePassword || user.status !== 'ACTIVE') throw Errors.unauthenticated('Etapa de troca de senha expirada; faça login novamente');
    if (await verify(user.passwordHash, newPassword).catch(() => false)) {
      throw Errors.validation('A nova senha deve ser diferente da senha provisória');
    }
    await this.db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: await this.hashPassword(newPassword), passwordChangedAt: new Date(), mustChangePassword: false },
      });
      await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'password_changed' } });
    });
    await this.audit.logSystem({ tenantId: null, actorId: user.id, action: 'temporary_password_replaced', entity: 'user', entityId: user.id });
    return this.afterPassword(user);
  }

  async verifyMfa(mfaToken: string, code: string): Promise<IssuedSession> {
    const { userId, purpose } = await this.tokens.verifyMfa(mfaToken);
    if (purpose !== 'verify') throw Errors.unauthenticated();
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.mfaEnabled || !user.mfaSecretEnc) throw Errors.unauthenticated();
    if (!authenticator.check(code, this.crypto.decrypt(user.mfaSecretEnc))) {
      await this.audit.logSystem({ tenantId: null, actorId: user.id, action: 'mfa_failed', entity: 'user', entityId: user.id });
      throw new DomainError(ErrorCode.MFA_INVALID, 'Código inválido', 401);
    }
    return this.createSession(user.id, true);
  }

  /** Inicia configuração de MFA (via token de etapa ou usuário autenticado). */
  async mfaSetup(userId: string): Promise<{ otpauthUrl: string; secret: string }> {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.mfaEnabled) throw Errors.conflict('MFA já habilitada');
    const secret = authenticator.generateSecret();
    await this.db.user.update({ where: { id: userId }, data: { mfaSecretEnc: this.crypto.encrypt(secret) } });
    return { otpauthUrl: authenticator.keyuri(user.email, 'OrdemCerta', secret), secret };
  }

  async mfaEnable(userId: string, code: string): Promise<void> {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.mfaSecretEnc) throw Errors.precondition('Inicie a configuração de MFA');
    if (!authenticator.check(code, this.crypto.decrypt(user.mfaSecretEnc))) throw new DomainError(ErrorCode.MFA_INVALID, 'Código inválido', 401);
    await this.db.user.update({ where: { id: userId }, data: { mfaEnabled: true } });
    await this.audit.logSystem({ tenantId: null, actorId: userId, action: 'mfa_enabled', entity: 'user', entityId: userId });
  }

  async mfaSetupWithToken(mfaToken: string) {
    const { userId, purpose } = await this.tokens.verifyMfa(mfaToken);
    if (purpose !== 'setup') throw Errors.unauthenticated();
    return this.mfaSetup(userId);
  }

  async mfaEnableWithToken(mfaToken: string, code: string): Promise<IssuedSession> {
    const { userId, purpose } = await this.tokens.verifyMfa(mfaToken);
    if (purpose !== 'setup') throw Errors.unauthenticated();
    await this.mfaEnable(userId, code);
    return this.createSession(userId, true);
  }

  async mfaDisable(userId: string, code: string) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.platformRole) throw Errors.forbidden('MFA é obrigatória para a plataforma');
    if (!user.mfaEnabled || !user.mfaSecretEnc || !authenticator.check(code, this.crypto.decrypt(user.mfaSecretEnc))) {
      throw new DomainError(ErrorCode.MFA_INVALID, 'Código inválido', 401);
    }
    await this.db.user.update({ where: { id: userId }, data: { mfaEnabled: false, mfaSecretEnc: null } });
    await this.audit.logSystem({ tenantId: null, actorId: userId, action: 'mfa_disabled', entity: 'user', entityId: userId });
  }

  /* -------------------------------------------------------------- sessões */

  async createSession(userId: string, mfaVerified: boolean, preferredTenantId?: string): Promise<IssuedSession> {
    const c = maybeCtx();
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    let tenantId: string | null = null;
    let membershipId: string | null = null;
    if (!user.platformRole) {
      const memberships = await this.db.tenantMembership.findMany({
        where: { userId, status: 'ACTIVE', tenant: { status: { not: 'CANCELED' } } },
        orderBy: { createdAt: 'asc' },
      });
      const m = memberships.find((x) => x.tenantId === preferredTenantId) ?? memberships[0];
      if (m) {
        tenantId = m.tenantId;
        membershipId = m.id;
      }
    }
    const secret = randomToken(32);
    const session = await this.db.session.create({
      data: {
        userId,
        refreshHash: sha256Hex(secret),
        tenantId,
        membershipId,
        mfaVerified,
        userAgent: c?.userAgent?.slice(0, 300) ?? null,
        ipHash: this.crypto.ipHash(c?.ip),
        expiresAt: new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
      },
    });
    await this.db.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    await this.audit.logSystem({ tenantId, actorId: userId, action: 'login', entity: 'session', entityId: session.id });
    const access = await this.tokens.signAccess({ sub: userId, sid: session.id, tid: tenantId });
    return { accessToken: access.token, expiresIn: access.expiresIn, refreshToken: `${session.id}.${secret}`, sessionId: session.id };
  }

  /** Rotação do refresh token; reuso de token antigo revoga a sessão inteira. */
  async refresh(refreshToken: string | undefined): Promise<IssuedSession> {
    const [sessionId, secret] = (refreshToken ?? '').split('.');
    if (!sessionId || !secret || !/^[0-9a-f-]{36}$/i.test(sessionId)) throw Errors.unauthenticated();
    const session = await this.db.session.findUnique({ where: { id: sessionId }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt < new Date() || session.user.status !== 'ACTIVE') throw Errors.unauthenticated();
    if (sha256Hex(secret) !== session.refreshHash) {
      await this.db.session.update({ where: { id: session.id }, data: { revokedAt: new Date(), revokeReason: 'refresh_reuse' } });
      await this.audit.logSystem({ tenantId: session.tenantId, actorId: session.userId, action: 'refresh_reuse_detected', entity: 'session', entityId: session.id });
      throw Errors.unauthenticated('Sessão encerrada por segurança');
    }
    let tenantId = session.tenantId;
    if (tenantId && !session.user.platformRole) {
      const m = await this.db.tenantMembership.findFirst({ where: { tenantId, userId: session.userId, status: 'ACTIVE' } });
      if (!m) tenantId = null;
    }
    const next = randomToken(32);
    await this.db.session.update({
      where: { id: session.id },
      data: { refreshHash: sha256Hex(next), rotatedAt: new Date(), lastUsedAt: new Date(), tenantId },
    });
    const access = await this.tokens.signAccess({ sub: session.userId, sid: session.id, tid: tenantId });
    return { accessToken: access.token, expiresIn: access.expiresIn, refreshToken: `${session.id}.${next}`, sessionId: session.id };
  }

  async logout(sessionId: string) {
    await this.db.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'logout' } });
  }

  async logoutByRefresh(refreshToken: string | undefined) {
    const [sessionId] = (refreshToken ?? '').split('.');
    if (sessionId && /^[0-9a-f-]{36}$/i.test(sessionId)) await this.logout(sessionId);
  }

  async listSessions(userId: string) {
    return this.db.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, userAgent: true, createdAt: true, lastUsedAt: true, mfaVerified: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeSession(userId: string, sessionId: string) {
    const n = await this.db.session.updateMany({ where: { id: sessionId, userId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'user_revoked' } });
    if (!n.count) throw Errors.notFound('Sessão');
  }

  async switchTenant(tenantId: string) {
    const a = authCtx();
    let membershipId: string | null = null;
    if (a.platformRole) {
      const grant = await this.db.supportAccessGrant.findFirst({
        where: { tenantId, platformUserId: a.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      });
      if (!grant || !a.mfaVerified) throw Errors.forbidden('Sem acesso autorizado a esta empresa');
      await this.audit.logSystem({ tenantId, action: 'support_session_started', entity: 'support_access_grant', entityId: grant.id });
    } else {
      const m = await this.db.tenantMembership.findFirst({ where: { tenantId, userId: a.userId, status: 'ACTIVE' } });
      if (!m) throw Errors.forbidden('Sem acesso a esta empresa');
      membershipId = m.id;
    }
    await this.db.session.update({ where: { id: a.sessionId }, data: { tenantId, membershipId } });
    const access = await this.tokens.signAccess({ sub: a.userId, sid: a.sessionId, tid: tenantId });
    return { accessToken: access.token, expiresIn: access.expiresIn };
  }

  async me() {
    const a = authCtx();
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: a.userId },
      select: { id: true, name: true, email: true, platformRole: true, mfaEnabled: true },
    });
    const memberships = await this.db.tenantMembership.findMany({
      where: { userId: a.userId, status: 'ACTIVE' },
      select: { tenantId: true, role: true, tenant: { select: { name: true, status: true } } },
    });
    let current = null;
    if (a.tenantId) {
      const tenant = await this.db.tenant.findUniqueOrThrow({
        where: { id: a.tenantId },
        select: { id: true, name: true, timezone: true, primaryColor: true, onboardingCompletedAt: true, status: true },
      });
      const sub = await this.db.subscription.findUnique({ where: { tenantId: a.tenantId }, include: { plan: true } });
      const branches = await this.db.branch.findMany({
        where: { tenantId: a.tenantId, status: 'ACTIVE', ...(a.allBranches ? {} : { id: { in: a.branchIds } }) },
        select: { id: true, name: true, timezone: true },
        orderBy: { createdAt: 'asc' },
      });
      current = {
        tenant,
        role: a.role,
        supportAccess: a.supportAccess,
        permissions: [...a.permissions],
        allBranches: a.allBranches,
        branches,
        technicianBranchIds: a.technicianBranchIds,
        subscription: sub
          ? {
              status: sub.status,
              operational: tenant.status !== 'CANCELED' && isOperational(sub),
              paymentMode: sub.paymentMode,
              planCode: sub.plan.code,
              planName: sub.plan.name,
              currentPeriodEnd: sub.currentPeriodEnd,
              graceUntil: sub.graceUntil,
            }
          : null,
      };
    }
    return {
      user: { ...user, mfaVerified: a.mfaVerified },
      tenants: memberships.map((m) => ({ tenantId: m.tenantId, name: m.tenant.name, status: m.tenant.status, role: m.role })),
      current,
    };
  }

  /* --------------------------------------------------- recuperação de senha */

  /** Sempre responde igual (sem enumeração de contas). */
  async forgotPassword(email: string) {
    const user = await this.db.user.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE') return;
    const token = randomToken(32);
    await this.db.$transaction(async (tx) => {
      await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
      await tx.passwordResetToken.create({ data: { userId: user.id, tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + 30 * 60_000) } });
      const content = emailTemplate('password_reset', { name: user.name, link: `${this.env.APP_URL}/reset-password#token=${token}` });
      await tx.emailOutbox.create({
        data: { toEmail: user.email, subject: content.subject, template: 'password_reset', payloadJson: { name: user.name, link: `${this.env.APP_URL}/reset-password#token=${token}` } },
      });
    });
    await this.audit.logSystem({ tenantId: null, actorId: user.id, action: 'password_reset_requested', entity: 'user', entityId: user.id });
  }

  async resetPassword(token: string, password: string) {
    const rec = await this.db.passwordResetToken.findUnique({ where: { tokenHash: sha256Hex(token) } });
    if (!rec || rec.usedAt || rec.expiresAt < new Date()) throw Errors.tokenInvalid();
    const passwordHash = await this.hashPassword(password);
    await this.db.$transaction(async (tx) => {
      const used = await tx.passwordResetToken.updateMany({ where: { id: rec.id, usedAt: null }, data: { usedAt: new Date() } });
      if (!used.count) throw Errors.tokenInvalid();
      await tx.user.update({ where: { id: rec.userId }, data: { passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null } });
      await tx.session.updateMany({ where: { userId: rec.userId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'password_reset' } });
    });
    await this.audit.logSystem({ tenantId: null, actorId: rec.userId, action: 'password_reset', entity: 'user', entityId: rec.userId });
  }

  async changePassword(currentPassword: string, newPassword: string) {
    const a = authCtx();
    const user = await this.db.user.findUniqueOrThrow({ where: { id: a.userId } });
    if (!(await verify(user.passwordHash, currentPassword).catch(() => false))) throw Errors.invalidCredentials();
    await this.db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash: await this.hashPassword(newPassword), passwordChangedAt: new Date() } });
      await tx.session.updateMany({ where: { userId: user.id, revokedAt: null, NOT: { id: a.sessionId } }, data: { revokedAt: new Date(), revokeReason: 'password_changed' } });
    });
    await this.audit.logSystem({ tenantId: null, action: 'password_changed', entity: 'user', entityId: user.id });
  }

  permissionsPreview(role: TenantRole) {
    return [...permissionsForRole(role)];
  }
}
