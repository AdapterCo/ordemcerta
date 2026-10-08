import type { TenantRole } from './enums';

/**
 * Permissões granulares por ação. Negar por padrão: só o que estiver
 * listado no papel é permitido. A API aplica em controllers E services.
 */
export const PERMISSIONS = [
  'os:view',
  'os:create',
  'os:update',
  'os:assign',
  'os:accept',
  'os:diagnose',
  'os:repair',
  'os:approve_override',
  'os:deliver',
  'os:deliver_override',
  'os:cancel',
  'os:reopen',
  'os:files',
  'os:internal_notes',
  'os:unlock_secret',
  'quote:create',
  'quote:send',
  'quote:approve_manual',
  'customer:view',
  'customer:edit',
  'customer:export',
  'customer:anonymize',
  'product:view',
  'product:edit',
  'stock:view',
  'stock:receive',
  'stock:adjust',
  'stock:transfer',
  'stock:reserve',
  'stock:override_negative',
  'sales:view',
  'sales:create',
  'sales:discount',
  'sales:cancel',
  'sales:refund',
  'payment:receive',
  'payment:refund',
  'cash:operate',
  'cash:close',
  'cash:view_all',
  'cash:register_manage',
  'reports:view',
  'reports:financial',
  'reports:export',
  'warranty:view',
  'warranty:manage',
  'messaging:view',
  'messaging:manage',
  'settings:edit',
  'documents:manage',
  'branches:manage',
  'users:manage',
  'billing:view',
  'billing:manage',
  'audit:view',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = [...PERMISSIONS] as Permission[];

export const ROLE_PERMISSIONS: Record<TenantRole, readonly Permission[]> = {
  TENANT_OWNER: ALL,
  TENANT_ADMIN: ALL.filter((p) => p !== 'billing:manage'),
  MANAGER: [
    'os:view', 'os:create', 'os:update', 'os:assign', 'os:accept', 'os:diagnose', 'os:repair',
    'os:approve_override', 'os:deliver', 'os:deliver_override', 'os:cancel', 'os:reopen', 'os:files',
    'os:internal_notes', 'os:unlock_secret',
    'quote:create', 'quote:send', 'quote:approve_manual',
    'customer:view', 'customer:edit', 'customer:export',
    'product:view', 'product:edit',
    'stock:view', 'stock:receive', 'stock:adjust', 'stock:transfer', 'stock:reserve', 'stock:override_negative',
    'sales:view', 'sales:create', 'sales:discount', 'sales:cancel', 'sales:refund',
    'payment:receive', 'payment:refund',
    'cash:operate', 'cash:close', 'cash:view_all', 'cash:register_manage',
    'reports:view', 'reports:financial', 'reports:export',
    'warranty:view', 'warranty:manage',
    'messaging:view', 'audit:view',
  ],
  RECEPTIONIST: [
    'os:view', 'os:create', 'os:update', 'os:deliver', 'os:files', 'os:internal_notes',
    'quote:create', 'quote:send',
    'customer:view', 'customer:edit',
    'product:view', 'stock:view',
    'sales:view', 'sales:create',
    'payment:receive', 'cash:operate',
    'warranty:view', 'warranty:manage',
    'messaging:view',
  ],
  TECHNICIAN: [
    'os:view', 'os:accept', 'os:diagnose', 'os:repair', 'os:files', 'os:internal_notes', 'os:unlock_secret',
    'quote:create',
    'customer:view',
    'product:view', 'stock:view', 'stock:reserve',
    'warranty:view',
  ],
  CASHIER: [
    'os:view', 'os:deliver',
    'customer:view', 'customer:edit',
    'product:view', 'stock:view',
    'sales:view', 'sales:create',
    'payment:receive',
    'cash:operate', 'cash:close',
  ],
  INVENTORY: [
    'product:view', 'product:edit',
    'stock:view', 'stock:receive', 'stock:adjust', 'stock:transfer', 'stock:reserve',
    'reports:view',
  ],
};

export function permissionsForRole(role: TenantRole): ReadonlySet<Permission> {
  return new Set(ROLE_PERMISSIONS[role] ?? []);
}

export function roleHasPermission(role: TenantRole, permission: Permission): boolean {
  return (ROLE_PERMISSIONS[role] ?? []).includes(permission);
}

/** Papéis que enxergam todas as filiais do tenant, sem associação explícita. */
export const ALL_BRANCHES_ROLES: readonly TenantRole[] = ['TENANT_OWNER', 'TENANT_ADMIN'];
