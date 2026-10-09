import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { createHash } from 'node:crypto';
import { formatBRL, formatDateTimeBR, formatDocument, formatPhoneBR, ACCESSORY_LABELS, type AccessoryType } from '@ordemcerta/shared';
import { sanitizeText } from './templates';

/**
 * Geração de PDFs server-side (pdfkit). A4 e térmico 80mm. Nunca inclui
 * segredos (senha de desbloqueio, IMEI completo, laudo interno em documentos públicos).
 */

export type PdfFormat = 'A4' | 'THERMAL';

export interface PdfResult {
  buffer: Buffer;
  checksum: string;
}

interface Company {
  name: string;
  document?: string | null;
  phone?: string | null;
  address?: string | null;
  branchName?: string | null;
  timezone: string;
}

function collect(doc: PDFKit.PDFDocument): Promise<PdfResult> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => {
      const buffer = Buffer.concat(chunks);
      resolve({ buffer, checksum: createHash('sha256').update(buffer).digest('hex') });
    });
    doc.on('error', reject);
    doc.end();
  });
}

function newDoc(format: PdfFormat, title: string) {
  const doc =
    format === 'THERMAL'
      ? new PDFDocument({ size: [226, 1400], margins: { top: 10, bottom: 10, left: 8, right: 8 }, info: { Title: title } })
      : new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 40, left: 40, right: 40 }, info: { Title: title } });
  return doc;
}

const t = (v: unknown) => sanitizeText(v === null || v === undefined ? '' : String(v));

function header(doc: PDFKit.PDFDocument, format: PdfFormat, company: Company, title: string, subtitle?: string) {
  const big = format === 'A4' ? 16 : 11;
  const small = format === 'A4' ? 9 : 7;
  doc.font('Helvetica-Bold').fontSize(big).text(t(company.name), { align: format === 'A4' ? 'left' : 'center' });
  doc.font('Helvetica').fontSize(small);
  const line = [company.document ? `CNPJ/CPF ${formatDocument(company.document)}` : '', company.phone ? formatPhoneBR(company.phone) : '', company.branchName ?? '']
    .filter(Boolean)
    .join(' · ');
  if (line) doc.text(line, { align: format === 'A4' ? 'left' : 'center' });
  if (company.address) doc.text(t(company.address), { align: format === 'A4' ? 'left' : 'center' });
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fontSize(format === 'A4' ? 13 : 10).text(t(title), { align: 'center' });
  if (subtitle) doc.font('Helvetica').fontSize(small).text(t(subtitle), { align: 'center' });
  doc.moveDown(0.5);
}

function section(doc: PDFKit.PDFDocument, format: PdfFormat, label: string) {
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(format === 'A4' ? 10 : 8).text(t(label).toUpperCase());
  doc.font('Helvetica').fontSize(format === 'A4' ? 9 : 7);
}

function kv(doc: PDFKit.PDFDocument, pairs: Array<[string, string | null | undefined]>) {
  for (const [k, v] of pairs) {
    if (v === undefined) continue;
    doc.font('Helvetica-Bold').text(`${t(k)}: `, { continued: true }).font('Helvetica').text(t(v ?? '—'));
  }
}

function signatureLine(doc: PDFKit.PDFDocument, format: PdfFormat, label: string, signaturePng?: Buffer | null) {
  doc.moveDown(format === 'A4' ? 1.5 : 1);
  const width = format === 'A4' ? 250 : 180;
  const x = doc.page.margins.left;
  if (signaturePng) {
    try {
      doc.image(signaturePng, x, doc.y, { fit: [width, 50] });
      doc.moveDown(3.2);
    } catch {
      /* assinatura inválida: mantém linha em branco */
    }
  }
  const y = doc.y;
  doc.moveTo(x, y).lineTo(x + width, y).stroke();
  doc.moveDown(0.2).text(t(label));
}

async function qr(doc: PDFKit.PDFDocument, url: string, size: number) {
  const png = await QRCode.toBuffer(url, { margin: 1, width: size * 2 });
  doc.image(png, { fit: [size, size] });
}

/* ------------------------------------------------------- ficha de entrada */

export interface ServiceOrderPdfData {
  company: Company;
  number: number;
  receivedAt: Date;
  attendant: string;
  technician?: string | null;
  category: string;
  priority: string;
  customer: { name: string; phone?: string | null; document?: string | null; email?: string | null };
  device: { brand: string; model: string; color?: string | null; imeiMasked?: string | null; serialMasked?: string | null };
  accessories: Array<{ type: AccessoryType; description?: string | null; received: boolean }>;
  checklist: Array<{ label: string; ok: boolean | null; notes?: string }>;
  reportedIssue: string;
  /** Laudo técnico só é incluído na via interna/entrega, nunca em links públicos. */
  technicalReport?: string | null;
  estimatedDeliveryAt?: Date | null;
  quote?: { version: number; totalCents: number; lines: Array<{ description: string; qty: number; totalCents: number }> } | null;
  warrantyDays?: number | null;
  terms: Array<{ title: string; version: number; text: string }>;
  trackingUrl?: string | null;
  statusLookupUrl: string;
  payment?: { totalCents: number; paidCents: number; status: string } | null;
  pickup?: { receivedByName: string; deliveredAt: Date; deliveredBy: string } | null;
  signaturePng?: Buffer | null;
  documentHash?: string | null;
}

export async function buildServiceOrderPdf(data: ServiceOrderPdfData, format: PdfFormat): Promise<PdfResult> {
  const doc = newDoc(format, `OS ${data.number}`);
  const tz = data.company.timezone;
  header(doc, format, data.company, `ORDEM DE SERVIÇO Nº ${data.number}`, `Entrada: ${formatDateTimeBR(data.receivedAt, tz)} · Tipo: ${data.category}`);

  section(doc, format, 'Atendimento');
  kv(doc, [
    ['Atendente', data.attendant],
    ['Técnico', data.technician ?? 'A definir'],
    ['Prioridade', data.priority],
    ['Previsão', data.estimatedDeliveryAt ? formatDateTimeBR(data.estimatedDeliveryAt, tz) : 'A definir'],
  ]);

  section(doc, format, 'Cliente');
  kv(doc, [
    ['Nome', data.customer.name],
    ['Telefone', data.customer.phone ? formatPhoneBR(data.customer.phone) : '—'],
    ['CPF/CNPJ', data.customer.document ? formatDocument(data.customer.document) : undefined],
  ]);

  section(doc, format, 'Aparelho');
  kv(doc, [
    ['Marca/Modelo', `${data.device.brand} ${data.device.model}`],
    ['Cor', data.device.color ?? '—'],
    ['IMEI', data.device.imeiMasked || '—'],
    ['Serial', data.device.serialMasked || undefined],
  ]);

  section(doc, format, 'Acessórios recebidos');
  const acc = data.accessories.filter((a) => a.received);
  doc.text(acc.length ? acc.map((a) => `${ACCESSORY_LABELS[a.type]}${a.description ? ` (${t(a.description)})` : ''}`).join(', ') : 'Nenhum');

  if (data.checklist.length) {
    section(doc, format, 'Estado físico e testes iniciais');
    for (const c of data.checklist) {
      const mark = c.ok === null ? 'Não testado' : c.ok ? 'OK' : 'Com defeito';
      doc.text(`• ${t(c.label)}: ${mark}${c.notes ? ` — ${t(c.notes)}` : ''}`);
    }
  }

  section(doc, format, 'Defeito informado');
  doc.text(t(data.reportedIssue));

  if (data.technicalReport) {
    section(doc, format, 'Laudo técnico');
    doc.text(t(data.technicalReport));
  }

  if (data.quote) {
    section(doc, format, `Peças e serviços (orçamento v${data.quote.version})`);
    for (const l of data.quote.lines) doc.text(`${l.qty}x ${t(l.description)} — ${formatBRL(l.totalCents)}`);
    doc.font('Helvetica-Bold').text(`Total: ${formatBRL(data.quote.totalCents)}`).font('Helvetica');
  }

  if (data.warrantyDays) {
    section(doc, format, 'Garantia');
    doc.text(`${data.warrantyDays} dias contados da entrega, sem prejuízo da garantia legal.`);
  }

  if (data.payment) {
    section(doc, format, 'Pagamento');
    kv(doc, [
      ['Total', formatBRL(data.payment.totalCents)],
      ['Pago', formatBRL(data.payment.paidCents)],
      ['Situação', data.payment.status],
    ]);
  }

  for (const term of data.terms) {
    section(doc, format, `${term.title} (v${term.version})`);
    doc.text(t(term.text), { align: 'justify' });
  }

  section(doc, format, 'Consulta do serviço');
  if (data.trackingUrl) {
    doc.text('Acompanhe pelo QR Code ou link abaixo (não compartilhe):');
    await qr(doc, data.trackingUrl, format === 'A4' ? 90 : 80);
    doc.fontSize(format === 'A4' ? 7 : 6).text(data.trackingUrl).fontSize(format === 'A4' ? 9 : 7);
  } else {
    doc.text(`Consulte em ${data.statusLookupUrl} com o número da OS e o código do seu comprovante.`);
  }

  signatureLine(doc, format, `Assinatura do cliente — ${t(data.customer.name)}`, data.signaturePng);

  if (data.pickup) {
    section(doc, format, 'Retirada');
    kv(doc, [
      ['Recebido por', data.pickup.receivedByName],
      ['Data', formatDateTimeBR(data.pickup.deliveredAt, tz)],
      ['Responsável', data.pickup.deliveredBy],
    ]);
  }

  if (data.documentHash) {
    doc.moveDown(0.5).fontSize(6).fillColor('#666').text(`Hash do termo aceito (SHA-256): ${data.documentHash}`).fillColor('#000');
  }
  return collect(doc);
}

/* ---------------------------------------------------------------- orçamento */

export interface QuotePdfData {
  company: Company;
  orderNumber: number;
  version: number;
  createdAt: Date;
  expiresAt: Date;
  customerName: string;
  device: string;
  diagnosis?: string | null;
  lines: Array<{ description: string; qty: number; unitPriceCents: number; discountCents: number; totalCents: number; warrantyDays: number }>;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  estimatedDays?: number | null;
  notes?: string | null;
  termText: string;
  approval?: { approvedAt: Date; by: string; method: string; contentHash: string } | null;
}

export async function buildQuotePdf(data: QuotePdfData): Promise<PdfResult> {
  const doc = newDoc('A4', `Orçamento OS ${data.orderNumber}`);
  const tz = data.company.timezone;
  header(doc, 'A4', data.company, `ORÇAMENTO — OS Nº ${data.orderNumber} (versão ${data.version})`, `Emitido em ${formatDateTimeBR(data.createdAt, tz)} · válido até ${formatDateTimeBR(data.expiresAt, tz)}`);
  kv(doc, [
    ['Cliente', data.customerName],
    ['Aparelho', data.device],
    ['Diagnóstico', data.diagnosis ?? undefined],
  ]);
  section(doc, 'A4', 'Itens');
  for (const l of data.lines) {
    doc.text(
      `${l.qty}x ${t(l.description)} — unit. ${formatBRL(l.unitPriceCents)}${l.discountCents ? ` (desc. ${formatBRL(l.discountCents)})` : ''} = ${formatBRL(l.totalCents)} · garantia ${l.warrantyDays} dias`,
    );
  }
  doc.moveDown(0.5);
  kv(doc, [
    ['Subtotal', formatBRL(data.subtotalCents)],
    ['Descontos', formatBRL(data.discountCents)],
    ['Total', formatBRL(data.totalCents)],
    ['Prazo estimado', data.estimatedDays ? `${data.estimatedDays} dia(s) após aprovação` : undefined],
  ]);
  if (data.notes) {
    section(doc, 'A4', 'Observações');
    doc.text(t(data.notes));
  }
  section(doc, 'A4', 'Condições');
  doc.text(t(data.termText));
  if (data.approval) {
    section(doc, 'A4', 'Aprovação');
    kv(doc, [
      ['Aprovado em', formatDateTimeBR(data.approval.approvedAt, tz)],
      ['Por', data.approval.by],
      ['Meio', data.approval.method],
      ['Hash da versão', data.approval.contentHash],
    ]);
  }
  return collect(doc);
}

/* ----------------------------------------------------- comprovante de venda */

export interface SaleReceiptData {
  company: Company;
  number: number;
  confirmedAt: Date;
  operator: string;
  customerName?: string | null;
  items: Array<{ description: string; qty: number; unitPriceCents: number; discountCents: number }>;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  payments: Array<{ method: string; amountCents: number; changeCents: number; manual: boolean }>;
  footer: string;
}

export async function buildSaleReceiptPdf(data: SaleReceiptData, format: PdfFormat = 'THERMAL'): Promise<PdfResult> {
  const doc = newDoc(format, `Venda ${data.number}`);
  header(doc, format, data.company, 'COMPROVANTE DE VENDA', 'DOCUMENTO NÃO FISCAL');
  kv(doc, [
    ['Venda', String(data.number)],
    ['Data', formatDateTimeBR(data.confirmedAt, data.company.timezone)],
    ['Operador', data.operator],
    ['Cliente', data.customerName ?? undefined],
  ]);
  section(doc, format, 'Itens');
  for (const i of data.items) {
    doc.text(`${i.qty}x ${t(i.description)}  ${formatBRL(i.qty * i.unitPriceCents - i.discountCents)}`);
  }
  doc.moveDown(0.3);
  kv(doc, [
    ['Subtotal', formatBRL(data.subtotalCents)],
    ['Descontos', formatBRL(data.discountCents)],
    ['TOTAL', formatBRL(data.totalCents)],
  ]);
  section(doc, format, 'Pagamento');
  for (const p of data.payments) {
    doc.text(`${t(p.method)}: ${formatBRL(p.amountCents)}${p.changeCents ? ` (troco ${formatBRL(p.changeCents)})` : ''}${p.manual ? ' — registro manual' : ''}`);
  }
  doc.moveDown(0.5).font('Helvetica-Bold').text('NÃO É DOCUMENTO FISCAL', { align: 'center' }).font('Helvetica');
  doc.text(t(data.footer), { align: 'center' });
  return collect(doc);
}

/* ------------------------------------------------------------- relatórios */

export async function buildTablePdf(title: string, subtitle: string, columns: string[], rows: Array<Array<string | number>>): Promise<PdfResult> {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margins: { top: 30, bottom: 30, left: 30, right: 30 }, info: { Title: title } });
  doc.font('Helvetica-Bold').fontSize(14).text(t(title));
  doc.font('Helvetica').fontSize(8).text(t(subtitle)).moveDown(0.5);
  const width = doc.page.width - 60;
  const colW = width / Math.max(columns.length, 1);
  const drawRow = (cells: Array<string | number>, bold: boolean) => {
    const y = doc.y;
    if (y > doc.page.height - 50) doc.addPage();
    const top = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7);
    let maxH = 0;
    cells.forEach((c, i) => {
      const h = doc.heightOfString(t(c), { width: colW - 4 });
      maxH = Math.max(maxH, h);
      doc.text(t(c), 30 + i * colW, top, { width: colW - 4 });
    });
    doc.y = top + maxH + 3;
    doc.x = 30;
  };
  drawRow(columns, true);
  for (const r of rows) drawRow(r, false);
  return collect(doc);
}

/** Recibo de assinatura da plataforma (não fiscal). */
export async function buildSubscriptionReceiptPdf(data: {
  tenantName: string;
  planName: string;
  amountCents: number;
  periodStart: Date;
  periodEnd: Date;
  paidAt: Date;
  providerPaymentId: string;
}): Promise<PdfResult> {
  const doc = newDoc('A4', 'Recibo de assinatura');
  header(doc, 'A4', { name: 'OrdemCerta', timezone: 'America/Sao_Paulo' }, 'RECIBO DE ASSINATURA', 'DOCUMENTO NÃO FISCAL');
  kv(doc, [
    ['Empresa', data.tenantName],
    ['Plano', data.planName],
    ['Valor', formatBRL(data.amountCents)],
    ['Período', `${formatDateTimeBR(data.periodStart)} a ${formatDateTimeBR(data.periodEnd)}`],
    ['Pago em', formatDateTimeBR(data.paidAt)],
    ['Identificador do pagamento', data.providerPaymentId],
  ]);
  return collect(doc);
}
