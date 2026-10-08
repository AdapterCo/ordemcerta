import { AsyncLocalStorage } from 'node:async_hooks';
import type { Permission, TenantRole } from '@ordemcerta/shared';
import { Errors } from './errors';

export interface AuthContext {
  userId: string;
  sessionId: string;
  email: string;
  name: string;
  platformRole: 'PLATFORM_SUPERADMIN' | null;
  mfaVerified: boolean;
  tenantId: string | null;
  membershipId: string | null;
  role: TenantRole | null;
  permissions: ReadonlySet<Permission>;
  /** Filiais autorizadas (vazio + allBranches=true para dono/admin). */
  branchIds: string[];
  allBranches: boolean;
  technicianBranchIds: string[];
  /** Acesso temporário de suporte da plataforma (somente leitura, auditado). */
  supportAccess: boolean;
}

export interface RequestContext {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
  auth?: AuthContext;
}

export const als = new AsyncLocalStorage<RequestContext>();

export function ctx(): RequestContext {
  const c = als.getStore();
  if (!c) throw new Error('Contexto de requisição ausente');
  return c;
}

export function maybeCtx(): RequestContext | undefined {
  return als.getStore();
}

export function auth(): AuthContext {
  const a = ctx().auth;
  if (!a) throw Errors.unauthenticated();
  return a;
}

/** tenant_id SEMPRE do contexto autenticado — nunca do corpo da requisição. */
export function currentTenantId(): string {
  const a = auth();
  if (!a.tenantId) throw Errors.forbidden('Selecione uma empresa para continuar');
  return a.tenantId;
}

export function can(p: Permission): boolean {
  return auth().permissions.has(p);
}

/** Verificação em service (defesa em profundidade além do guard do controller). */
export function assertCan(p: Permission): void {
  if (!can(p)) throw Errors.forbidden('Permissão insuficiente');
}

export function canAccessBranch(branchId: string): boolean {
  const a = auth();
  return a.allBranches || a.branchIds.includes(branchId);
}

/** Nunca confiar em branch_id do cliente sem verificar associação. */
export function assertBranch(branchId: string): void {
  if (!canAccessBranch(branchId)) throw Errors.forbidden('Sem acesso a esta filial');
}

/** Filtro Prisma de filiais: undefined = todas. */
export function branchScope(): { in: string[] } | undefined {
  const a = auth();
  return a.allBranches ? undefined : { in: a.branchIds };
}
