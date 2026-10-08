import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@ordemcerta/shared';

export const META_PUBLIC = 'oc:public';
export const META_NO_TENANT = 'oc:no-tenant';
export const META_PLATFORM = 'oc:platform';
export const META_PERMS = 'oc:perms';
export const META_OPERATIONAL = 'oc:operational';
export const META_IDEMPOTENT = 'oc:idempotent';

/** Rota pública (sem autenticação). */
export const Public = () => SetMetadata(META_PUBLIC, true);
/** Autenticada, mas não exige empresa selecionada (ex.: /auth/me). */
export const NoTenant = () => SetMetadata(META_NO_TENANT, true);
/** Somente PLATFORM_SUPERADMIN com MFA verificada. */
export const PlatformOnly = () => SetMetadata(META_PLATFORM, true);
/** Exige todas as permissões listadas (negar por padrão). */
export const Perm = (...perms: Permission[]) => SetMetadata(META_PERMS, perms);
/**
 * Escrita operacional: bloqueada quando a assinatura não está ativa
 * (PENDING_PAYMENT, SUSPENDED, CANCELED, PAST_DUE após tolerância).
 */
export const Operational = () => SetMetadata(META_OPERATIONAL, true);
/** Exige header Idempotency-Key e reaproveita a resposta de repetições. */
export const Idempotent = () => SetMetadata(META_IDEMPOTENT, true);
