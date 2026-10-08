import { formatBRL, formatDateTimeBR, PUBLIC_STATUS_LABELS, type MessagingEventType, type TechnicalStatus } from '@ordemcerta/shared';

/** Eventos de domínio (outbox) → tipo de notificação ao cliente. */
export const OUTBOX_TO_MESSAGING: Record<string, MessagingEventType> = {
  'os.created': 'OS_RECEIVED',
  'os.diagnosis_started': 'OS_DIAGNOSIS_STARTED',
  'quote.sent': 'QUOTE_AVAILABLE',
  'quote.approved': 'QUOTE_APPROVED',
  'os.waiting_parts': 'OS_WAITING_PARTS',
  'os.repair_started': 'OS_REPAIR_STARTED',
  'os.ready': 'OS_READY',
  'os.delivered': 'OS_DELIVERED',
  'warranty.updated': 'WARRANTY_UPDATE',
};

export interface RenderContext {
  customerName: string;
  orderNumber?: number | null;
  device?: string | null;
  companyName: string;
  branchName?: string | null;
  technicalStatus?: TechnicalStatus | null;
  link: string;
  quoteTotalCents?: number | null;
  estimatedDeliveryAt?: Date | null;
  timezone: string;
}

/**
 * Valores das variáveis permitidas. Nunca inclui IMEI, senha, laudo interno
 * ou notas privadas (3.8).
 */
export function messageVariables(c: RenderContext): Record<string, string> {
  return {
    cliente_nome: c.customerName.split(' ')[0] ?? c.customerName,
    os_numero: c.orderNumber ? String(c.orderNumber) : '-',
    aparelho: c.device ?? '-',
    empresa_nome: c.companyName,
    filial_nome: c.branchName ?? c.companyName,
    status_publico: c.technicalStatus ? PUBLIC_STATUS_LABELS[c.technicalStatus] : '-',
    link_acompanhamento: c.link,
    valor_orcamento: c.quoteTotalCents ? formatBRL(c.quoteTotalCents) : '-',
    previsao_entrega: c.estimatedDeliveryAt ? formatDateTimeBR(c.estimatedDeliveryAt, c.timezone) : 'a confirmar',
  };
}

/** Delay (ms) até o fim do horário silencioso configurado, ou 0. */
export function quietHoursDelay(now: Date, quiet: { start: string; end: string } | null, timezone: string): number {
  if (!quiet) return 0;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const cur = h * 60 + m;
  const [sh, sm] = quiet.start.split(':').map(Number) as [number, number];
  const [eh, em] = quiet.end.split(':').map(Number) as [number, number];
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  const inQuiet = start <= end ? cur >= start && cur < end : cur >= start || cur < end;
  if (!inQuiet) return 0;
  const minutes = cur < end ? end - cur : 24 * 60 - cur + end;
  return minutes * 60_000;
}
