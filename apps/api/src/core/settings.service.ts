import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Tx } from '@ordemcerta/server';
import { z } from 'zod';
import { Errors } from './errors';

const checklistItems = z.array(z.object({ key: z.string().max(60), label: z.string().max(120) })).max(60);

/**
 * Políticas configuráveis por empresa (e opcionalmente por filial).
 * Valores padrão conservadores; nenhuma regra comercial hardcoded fora daqui.
 */
export const SETTING_DEFINITIONS = {
  'os.intake_checklist': {
    schema: checklistItems,
    default: [
      { key: 'screen', label: 'Tela (trincas/manchas)' },
      { key: 'body', label: 'Carcaça e tampa' },
      { key: 'buttons', label: 'Botões' },
      { key: 'camera', label: 'Câmeras' },
      { key: 'charging', label: 'Carregamento' },
      { key: 'audio', label: 'Áudio/microfone' },
      { key: 'touch', label: 'Touch' },
      { key: 'power_on', label: 'Liga' },
    ],
  },
  'os.post_repair_checklist': {
    schema: checklistItems,
    default: [
      { key: 'power_on', label: 'Liga e inicializa' },
      { key: 'touch', label: 'Touch e tela' },
      { key: 'charging', label: 'Carregamento' },
      { key: 'audio', label: 'Áudio e chamadas' },
      { key: 'cameras', label: 'Câmeras' },
      { key: 'connectivity', label: 'Wi-Fi/Bluetooth/rede' },
      { key: 'cleaning', label: 'Limpeza e fechamento' },
    ],
  },
  'os.default_warranty_days': { schema: z.number().int().min(0).max(3650), default: 90 },
  'os.sla_hours': { schema: z.number().int().min(1).max(24 * 60), default: 72 },
  /** Entrega exige quitação; override com permissão os:deliver_override e motivo. */
  'os.require_payment_for_delivery': { schema: z.boolean(), default: true },
  'os.unlock_secret_ttl_days': { schema: z.number().int().min(1).max(30), default: 7 },
  'stock.allow_negative': { schema: z.boolean(), default: false },
  'cash.one_session_per_operator': { schema: z.boolean(), default: true },
  'sales.max_discount_percent_without_permission': { schema: z.number().min(0).max(100), default: 0 },
  /** OTP adicional para aprovar/recusar orçamento no portal (enviado por e-mail do cliente). */
  'portal.require_otp_for_quote': { schema: z.boolean(), default: false },
  'portal.token_ttl_days': { schema: z.number().int().min(7).max(365), default: 120 },
  'quote.default_valid_days': { schema: z.number().int().min(1).max(60), default: 7 },
  'payments.enabled_methods': {
    schema: z.array(z.enum(['CASH', 'PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'BANK_TRANSFER', 'OTHER'])).min(1),
    default: ['CASH', 'PIX', 'CREDIT_CARD', 'DEBIT_CARD'],
  },
  'messaging.quiet_hours': {
    schema: z.object({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) }).nullable(),
    default: { start: '21:00', end: '08:00' },
  },
  'privacy.photo_retention_days': { schema: z.number().int().min(30).max(3650), default: 730 },
} as const;

export type SettingKey = keyof typeof SETTING_DEFINITIONS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTING_DEFINITIONS)[K]['schema']>;

@Injectable()
export class SettingsService {
  isKnown(key: string): key is SettingKey {
    return key in SETTING_DEFINITIONS;
  }

  /** Valor efetivo: filial > empresa > padrão. */
  async get<K extends SettingKey>(tx: Tx, tenantId: string, key: K, branchId?: string | null): Promise<SettingValue<K>> {
    const scopes = branchId ? [branchId, 'tenant'] : ['tenant'];
    const rows = await tx.setting.findMany({ where: { tenantId, key, scope: { in: scopes } } });
    const row = rows.find((r) => r.scope === branchId) ?? rows.find((r) => r.scope === 'tenant');
    const def = SETTING_DEFINITIONS[key];
    if (!row) return def.default as SettingValue<K>;
    const parsed = def.schema.safeParse(row.valueJson);
    return (parsed.success ? parsed.data : def.default) as SettingValue<K>;
  }

  async all(tx: Tx, tenantId: string, branchId?: string | null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(SETTING_DEFINITIONS) as SettingKey[]) out[key] = await this.get(tx, tenantId, key, branchId);
    return out;
  }

  async set(tx: Tx, tenantId: string, key: string, value: unknown, branchId: string | null, actorId: string) {
    if (!this.isKnown(key)) throw Errors.validation(`Configuração desconhecida: ${key}`);
    const parsed = SETTING_DEFINITIONS[key].schema.safeParse(value);
    if (!parsed.success) throw Errors.validation('Valor inválido', parsed.error.flatten());
    const scope = branchId ?? 'tenant';
    await tx.setting.upsert({
      where: { tenantId_scope_key: { tenantId, scope, key } },
      create: { tenantId, branchId, scope, key, valueJson: parsed.data as Prisma.InputJsonValue, updatedBy: actorId },
      update: { valueJson: parsed.data as Prisma.InputJsonValue, updatedBy: actorId },
    });
  }
}
