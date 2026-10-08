import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export {
  formatBRL,
  formatDateBR,
  formatDateTimeBR,
  formatPhoneBR,
  formatDocument,
  parseBRLToCents,
  TECHNICAL_STATUS_LABELS,
  DELIVERY_STATUS_LABELS,
  ORDER_PAYMENT_STATUS_LABELS,
  PRIORITY_LABELS,
  PAYMENT_METHOD_LABELS,
  QUOTE_STATUS_LABELS,
  ROLE_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  INVOICE_STATUS_LABELS,
  MESSAGING_STATUS_LABELS,
  MESSAGING_EVENT_LABELS,
  WARRANTY_STATUS_LABELS,
  ACCESSORY_LABELS,
  DOCUMENT_TEMPLATE_LABELS,
} from '@ordemcerta/shared';

/** Converte período "últimos N dias" em ISO para filtros. */
export function lastDays(days: number) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function toDateInput(d: Date | string | null | undefined) {
  if (!d) return '';
  const x = new Date(d);
  return new Date(x.getTime() - x.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/** Lê o fragmento "#token=..." (tokens nunca trafegam na URL do servidor). */
export function fragmentParam(name: string): string | null {
  const h = window.location.hash.replace(/^#/, '');
  return new URLSearchParams(h).get(name);
}
