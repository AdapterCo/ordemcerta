import { Inject, Injectable } from '@nestjs/common';
import { buildQuotePdf, buildServiceOrderPdf, renderPlaceholders, sha256Hex, type PdfFormat } from '@ordemcerta/server';
import {
  DOCUMENT_TEMPLATE_LABELS,
  ORDER_PAYMENT_STATUS_LABELS,
  PRIORITY_LABELS,
  formatBRL,
  formatDateTimeBR,
  lineTotalCents,
  maskIdentifier,
  type DocumentTemplateType,
} from '@ordemcerta/shared';
import { assertBranch, auth, currentTenantId } from '../../core/context';
import { TenantDb } from '../../core/database';
import { ENV, type AppEnv } from '../../core/env.provider';
import { Errors } from '../../core/errors';
import { documentTemplate, trackingLink } from './order-helpers';
import { OrderSignaturesService } from './order-signatures.service';

export type OrderPdfType = 'intake' | 'pickup';

/** PDFs da OS (ficha A4/térmica, retirada) e do orçamento, com registro de emissão e checksum. */
@Injectable()
export class OrderDocumentsService {
  constructor(
    private readonly db: TenantDb,
    private readonly signatures: OrderSignaturesService,
    @Inject(ENV) private readonly env: AppEnv,
  ) {}

  async orderPdf(id: string, type: OrderPdfType, format: PdfFormat, trackingToken?: string) {
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      const o = await tx.serviceOrder.findFirst({
        where: { id, tenantId },
        include: {
          customer: true,
          device: true,
          branch: true,
          accessories: true,
          checklists: { where: { phase: 'INTAKE' }, orderBy: { completedAt: 'desc' }, take: 1 },
          terms: { orderBy: { acceptedAt: 'desc' } },
          pickupReceipt: true,
        },
      });
      if (!o) throw Errors.notFound('OS');
      assertBranch(o.branchId);
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      const userIds = [o.createdBy, o.assignedTechnicianId, o.pickupReceipt?.deliveredBy].filter(Boolean) as string[];
      const users = await tx.tenantMembership.findMany({ where: { tenantId, userId: { in: userIds } }, select: { userId: true, user: { select: { name: true } } } });
      const name = (uid?: string | null) => users.find((u) => u.userId === uid)?.user.name ?? null;

      // Token só é embutido (QR) se for o token vigente desta OS.
      let trackingUrl: string | null = null;
      if (trackingToken) {
        const valid = await tx.publicTrackingToken.findFirst({
          where: { tenantId, orderId: id, tokenHash: sha256Hex(trackingToken), revokedAt: null, expiresAt: { gt: new Date() } },
        });
        if (valid) trackingUrl = trackingLink(this.env.APP_URL, o.number, trackingToken);
      }
      const quote = o.approvedQuoteId
        ? await tx.quote.findFirst({ where: { id: o.approvedQuoteId, tenantId }, include: { lines: { orderBy: { position: 'asc' } } } })
        : null;
      const receivable = await tx.receivable.findUnique({ where: { tenantId_sourceType_sourceId: { tenantId, sourceType: 'SERVICE_ORDER', sourceId: id } } });

      const termTypes: DocumentTemplateType[] = type === 'intake' ? ['INTAKE', 'RESPONSIBILITY_TERM'] : ['PICKUP_RECEIPT', 'WARRANTY_TERM'];
      const vars = {
        taxa_diagnostico: o.diagnosisFeeCents ? formatBRL(o.diagnosisFeeCents) : 'sem taxa',
        link_consulta: `${this.env.APP_URL}/status`,
        dias_garantia: o.warrantyDays ?? 0,
      };
      const terms = [];
      for (const t of termTypes) {
        if (t === 'WARRANTY_TERM' && (!o.warrantyDays || o.technicalStatus !== 'READY')) continue;
        const tpl = await documentTemplate(tx, tenantId, t);
        terms.push({ title: DOCUMENT_TEMPLATE_LABELS[t], version: tpl.version, text: renderPlaceholders(tpl.content, vars) });
      }
      const signedTerm = o.terms.find((t) => t.termType === (type === 'intake' ? 'INTAKE' : 'PICKUP'));
      const signaturePng = signedTerm?.signatureFileId ? await this.signatures.read(tx, tenantId, signedTerm.signatureFileId) : null;
      const address = tenant.address as Record<string, string> | null;

      const pdf = await buildServiceOrderPdf(
        {
          company: {
            name: tenant.name,
            document: tenant.document,
            phone: o.branch.phone ?? tenant.phone,
            address: address ? [address.street, address.number, address.district, address.city, address.state].filter(Boolean).join(', ') : null,
            branchName: o.branch.name,
            timezone: o.branch.timezone,
          },
          number: o.number,
          receivedAt: o.receivedAt,
          attendant: name(o.createdBy) ?? '—',
          technician: name(o.assignedTechnicianId),
          category: o.category === 'DIAGNOSIS' ? 'Diagnóstico' : 'Reparo',
          priority: PRIORITY_LABELS[o.priority],
          customer: { name: o.customer.name, phone: o.customer.phoneE164, document: o.customer.document },
          device: {
            brand: o.device.brand,
            model: o.device.model,
            color: o.device.color,
            imeiMasked: o.device.imeiLast4 ? maskIdentifier(`00000000000${o.device.imeiLast4}`) : null,
            serialMasked: o.device.serialLast4 ? `••••${o.device.serialLast4}` : null,
          },
          accessories: o.accessories,
          checklist: ((o.checklists[0]?.itemsJson ?? []) as Array<{ label: string; ok: boolean | null; notes?: string }>).slice(0, 60),
          reportedIssue: o.reportedIssue,
          technicalReport: type === 'pickup' ? o.technicalReport : null,
          estimatedDeliveryAt: o.estimatedDeliveryAt,
          quote: quote
            ? { version: quote.version, totalCents: quote.totalCents, lines: quote.lines.map((l) => ({ description: l.description, qty: l.qty, totalCents: lineTotalCents(l) })) }
            : null,
          warrantyDays: type === 'pickup' ? o.warrantyDays : null,
          terms,
          trackingUrl,
          statusLookupUrl: `${this.env.APP_URL}/status`,
          payment: receivable
            ? { totalCents: receivable.amountCents, paidCents: receivable.paidCents - receivable.refundedCents, status: ORDER_PAYMENT_STATUS_LABELS[o.paymentStatus] }
            : null,
          pickup: type === 'pickup' && o.pickupReceipt ? { receivedByName: o.pickupReceipt.receivedByName, deliveredAt: o.pickupReceipt.deliveredAt, deliveredBy: name(o.pickupReceipt.deliveredBy) ?? '—' } : null,
          signaturePng,
          documentHash: signedTerm?.documentHash ?? null,
        },
        format,
      );
      await tx.issuedDocument.create({
        data: {
          tenantId,
          type: type === 'intake' ? 'INTAKE' : 'PICKUP_RECEIPT',
          templateVersion: Math.max(...terms.map((t) => t.version), 0),
          referenceType: 'SERVICE_ORDER',
          referenceId: id,
          checksum: pdf.checksum,
          format,
          issuedBy: auth().userId,
        },
      });
      return { buffer: pdf.buffer, filename: `os-${o.number}-${type}.pdf` };
    });
  }

  async quotePdf(quoteId: string) {
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      const q = await tx.quote.findFirst({
        where: { id: quoteId, tenantId },
        include: { lines: { orderBy: { position: 'asc' } }, order: { include: { customer: true, device: true, branch: true } } },
      });
      if (!q) throw Errors.notFound('Orçamento');
      assertBranch(q.order.branchId);
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      const tpl = await documentTemplate(tx, tenantId, 'QUOTE');
      const ev = q.approvalEvidenceJson as { method?: string; signerName?: string; customerName?: string } | null;
      const pdf = await buildQuotePdf({
        company: { name: tenant.name, document: tenant.document, phone: q.order.branch.phone ?? tenant.phone, branchName: q.order.branch.name, timezone: q.order.branch.timezone },
        orderNumber: q.order.number,
        version: q.version,
        createdAt: q.createdAt,
        expiresAt: q.expiresAt,
        customerName: q.order.customer.name,
        device: `${q.order.device.brand} ${q.order.device.model}`,
        diagnosis: q.order.diagnosis,
        lines: q.lines.map((l) => ({ ...l, totalCents: lineTotalCents(l) })),
        subtotalCents: q.subtotalCents,
        discountCents: q.discountCents,
        totalCents: q.totalCents,
        estimatedDays: q.estimatedDays,
        notes: q.notes,
        termText: renderPlaceholders(tpl.content, { validade: formatDateTimeBR(q.expiresAt, q.order.branch.timezone) }),
        approval:
          q.status === 'APPROVED' && q.approvedAt
            ? { approvedAt: q.approvedAt, by: ev?.signerName ?? ev?.customerName ?? q.order.customer.name, method: ev?.method ?? '—', contentHash: q.contentHash }
            : null,
      });
      await tx.issuedDocument.create({
        data: { tenantId, type: 'QUOTE', templateVersion: tpl.version, referenceType: 'QUOTE', referenceId: q.id, checksum: pdf.checksum, issuedBy: auth().userId },
      });
      return { buffer: pdf.buffer, filename: `orcamento-os-${q.order.number}-v${q.version}.pdf` };
    });
  }
}
