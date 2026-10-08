import { DEFAULT_DOCUMENT_TEMPLATES, sha256Hex, type Tx } from '@ordemcerta/server';
import type { DocumentTemplateType } from '@ordemcerta/shared';

/**
 * Links públicos: o token vai no fragmento (#), que o navegador não envia ao
 * servidor — não aparece em logs de proxy/servidor nem em Referer.
 */
export const trackingLink = (appUrl: string, number: number, token: string) => `${appUrl}/status/${number}#token=${token}`;
export const quoteLink = (appUrl: string, token: string) => `${appUrl}/quote#token=${token}`;

/** Modelo versionado ativo da empresa, ou o padrão do sistema (versão 0). */
export async function documentTemplate(tx: Tx, tenantId: string, type: DocumentTemplateType) {
  const t = await tx.documentTemplate.findFirst({ where: { tenantId, type, active: true }, orderBy: { version: 'desc' } });
  return t ? { version: t.version, content: t.content } : { version: 0, content: DEFAULT_DOCUMENT_TEMPLATES[type] };
}

export interface QuoteHashInput {
  orderId: string;
  version: number;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  expiresAt: Date;
  lines: Array<{ kind: string; productId: string | null; description: string; qty: number; unitPriceCents: number; discountCents: number; warrantyDays: number }>;
}

/** Hash canônico do conteúdo do orçamento: a aprovação se vincula a ESTA versão exata. */
export function quoteContentHash(q: QuoteHashInput): string {
  const canonical = {
    o: q.orderId,
    v: q.version,
    s: q.subtotalCents,
    d: q.discountCents,
    t: q.totalCents,
    e: q.expiresAt.toISOString(),
    l: q.lines.map((l) => [l.kind, l.productId ?? '', l.description, l.qty, l.unitPriceCents, l.discountCents, l.warrantyDays]),
  };
  return sha256Hex(JSON.stringify(canonical));
}

/** Mapeamento de eventos de domínio → tipos de notificação ao cliente. */
export const OUTBOX_TO_MESSAGING: Record<string, string> = {
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
