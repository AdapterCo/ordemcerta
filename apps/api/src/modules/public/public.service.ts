import { Injectable } from '@nestjs/common';
import { randomNumericCode, sha256Hex, emailTemplate, renderPlaceholders } from '@ordemcerta/server';
import {
  DELIVERY_STATUS_LABELS,
  ErrorCode,
  formatBRL,
  isOperational,
  lineTotalCents,
  PUBLIC_STATUS_LABELS,
} from '@ordemcerta/shared';
import { maybeCtx } from '../../core/context';
import { SystemPrisma, TenantDb } from '../../core/database';
import { DomainError, Errors } from '../../core/errors';
import { AuditService, CryptoService } from '../../core/services';
import { SettingsService } from '../../core/settings.service';
import { documentTemplate } from '../service-orders/order-helpers';
import { QuotesService } from '../service-orders/quotes.service';

/** Eventos exibidos na linha do tempo pública (sem laudos internos ou notas privadas). */
const PUBLIC_EVENTS: Record<string, string> = {
  created: 'Aparelho recebido',
  created_warranty_return: 'Retorno em garantia recebido',
  diagnosis_started: 'Avaliação técnica iniciada',
  quote_sent: 'Orçamento disponível',
  quote_sent_awaiting_approval: 'Orçamento disponível',
  quote_approved: 'Orçamento aprovado',
  quote_rejected: 'Orçamento recusado',
  parts_requested: 'Aguardando peças',
  repair_started: 'Reparo iniciado',
  repair_completed: 'Pronto para retirada',
  returned_unrepaired: 'Disponível para devolução',
  delivered: 'Entregue',
  canceled: 'Serviço cancelado',
};

interface ResolvedToken {
  tenantId: string;
  orderId: string;
  kind: 'tracking' | 'quote';
  quoteId?: string;
}

/**
 * Portal do cliente. Autenticação SEMPRE por token opaco (hash no banco);
 * número da OS nunca é suficiente. Respostas genéricas contra enumeração.
 */
@Injectable()
export class PublicService {
  constructor(
    private readonly system: SystemPrisma,
    private readonly db: TenantDb,
    private readonly quotes: QuotesService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
  ) {}

  private notFound() {
    return new DomainError(ErrorCode.TOKEN_INVALID, 'Não encontramos o serviço. Confira o número e o código do comprovante.', 404);
  }

  async resolve(token: string, orderNumber?: number): Promise<ResolvedToken> {
    if (!token || token.length < 16 || token.length > 128) throw this.notFound();
    const hash = sha256Hex(token);
    const now = new Date();
    const t = await this.system.publicTrackingToken.findUnique({ where: { tokenHash: hash }, include: { order: { select: { number: true } } } });
    if (t && !t.revokedAt && t.expiresAt > now && (orderNumber === undefined || t.order.number === orderNumber)) {
      await this.system.publicTrackingToken.update({ where: { id: t.id }, data: { lastUsedAt: now } });
      return { tenantId: t.tenantId, orderId: t.orderId, kind: 'tracking' };
    }
    const q = await this.system.quoteAccessToken.findUnique({ where: { tokenHash: hash }, include: { quote: { select: { orderId: true, order: { select: { number: true } } } } } });
    if (q && !q.revokedAt && q.expiresAt > now && q.uses < q.maxUses && (orderNumber === undefined || q.quote.order.number === orderNumber)) {
      await this.system.quoteAccessToken.update({ where: { id: q.id }, data: { uses: { increment: 1 } } });
      return { tenantId: q.tenantId, orderId: q.quote.orderId, kind: 'quote', quoteId: q.quoteId };
    }
    throw this.notFound();
  }

  private acceptText(number: number, version: number, totalCents: number, template: string) {
    return renderPlaceholders(template, { versao: version, total: formatBRL(totalCents) }) + ` (OS ${number})`;
  }

  /** Dados mínimos públicos: status, previsão, orçamento disponível. */
  async view(token: string, orderNumber?: number) {
    const r = await this.resolve(token, orderNumber);
    return this.db.runFor(r.tenantId, async (tx) => {
      const o = await tx.serviceOrder.findFirstOrThrow({
        where: { id: r.orderId, tenantId: r.tenantId },
        include: {
          device: { select: { brand: true, model: true } },
          branch: { select: { name: true, phone: true } },
          customer: { select: { name: true, email: true } },
          notes: { where: { visibility: 'CUSTOMER' }, select: { text: true, createdAt: true }, orderBy: { createdAt: 'desc' } },
          quotes: { where: { status: { in: ['SENT', 'APPROVED'] } }, include: { lines: { orderBy: { position: 'asc' } } }, orderBy: { version: 'desc' }, take: 1 },
        },
      });
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: r.tenantId }, select: { name: true, primaryColor: true } });
      const approvalTpl = await documentTemplate(tx, r.tenantId, 'APPROVAL');
      const requireOtp = await this.settings.get(tx, r.tenantId, 'portal.require_otp_for_quote', o.branchId);
      const quote = o.quotes[0];
      const firstName = o.customer.name.split(' ')[0];
      return {
        company: { name: tenant.name, color: tenant.primaryColor, branch: o.branch.name, phone: o.branch.phone },
        order: {
          number: o.number,
          customerFirstName: firstName,
          device: `${o.device.brand} ${o.device.model}`,
          status: PUBLIC_STATUS_LABELS[o.technicalStatus],
          statusCode: o.technicalStatus,
          delivery: DELIVERY_STATUS_LABELS[o.deliveryStatus],
          receivedAt: o.receivedAt,
          estimatedDeliveryAt: o.estimatedDeliveryAt,
          warrantyUntil: o.warrantyUntil,
          messages: o.notes,
        },
        quote: quote
          ? {
              id: quote.id,
              version: quote.version,
              status: quote.status,
              expiresAt: quote.expiresAt,
              estimatedDays: quote.estimatedDays,
              subtotalCents: quote.subtotalCents,
              discountCents: quote.discountCents,
              totalCents: quote.totalCents,
              lines: quote.lines.map((l) => ({ description: l.description, qty: l.qty, totalCents: lineTotalCents(l), warrantyDays: l.warrantyDays })),
              canDecide: quote.status === 'SENT' && quote.expiresAt > new Date() && o.technicalStatus === 'WAITING_QUOTE_APPROVAL',
              acceptText: this.acceptText(o.number, quote.version, quote.totalCents, approvalTpl.content),
              requiresOtp: requireOtp,
              otpChannelAvailable: Boolean(o.customer.email),
            }
          : null,
        accessKind: r.kind,
      };
    });
  }

  async timeline(token: string) {
    const r = await this.resolve(token);
    return this.db.runFor(r.tenantId, async (tx) => {
      const events = await tx.serviceOrderEvent.findMany({
        where: { tenantId: r.tenantId, orderId: r.orderId, eventType: { in: Object.keys(PUBLIC_EVENTS) } },
        select: { eventType: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      });
      return events.map((e) => ({ label: PUBLIC_EVENTS[e.eventType], at: e.createdAt }));
    });
  }

  /** OTP por e-mail do cliente (quando a política exigir). */
  async requestOtp(token: string, quoteId: string) {
    const r = await this.resolve(token);
    return this.db.runFor(r.tenantId, async (tx) => {
      const o = await tx.serviceOrder.findFirstOrThrow({ where: { id: r.orderId, tenantId: r.tenantId }, include: { customer: true } });
      const q = await tx.quote.findFirst({ where: { id: quoteId, tenantId: r.tenantId, orderId: o.id, status: 'SENT' } });
      if (!q) throw this.notFound();
      if (!o.customer.email) {
        throw new DomainError(ErrorCode.INTEGRATION_NOT_CONFIGURED, 'Verificação adicional indisponível para este cadastro. Aprove pelo telefone ou no balcão.', 422);
      }
      const recent = await tx.publicOtp.count({ where: { tenantId: r.tenantId, orderId: o.id, createdAt: { gt: new Date(Date.now() - 60_000) } } });
      if (recent) throw new DomainError(ErrorCode.RATE_LIMITED, 'Aguarde 1 minuto para solicitar outro código', 429);
      const code = randomNumericCode(6);
      await tx.publicOtp.create({
        data: { tenantId: r.tenantId, orderId: o.id, purpose: 'QUOTE_DECISION', targetId: q.id, codeHash: sha256Hex(`${q.id}:${code}`), channel: 'EMAIL', expiresAt: new Date(Date.now() + 10 * 60_000) },
      });
      const content = emailTemplate('custom', { text: `Seu código para decidir o orçamento da OS ${o.number} é ${code}. Válido por 10 minutos. Não compartilhe.` });
      await tx.emailOutbox.create({
        data: { tenantId: r.tenantId, toEmail: o.customer.email, subject: `Código de confirmação — OS ${o.number}`, template: 'custom', payloadJson: { text: content.text } },
      });
      const email = o.customer.email;
      return { sentTo: `${email.slice(0, 2)}***@${email.split('@')[1]}` };
    });
  }

  private async verifyOtp(tx: Parameters<Parameters<TenantDb['runFor']>[1]>[0], tenantId: string, orderId: string, quoteId: string, code?: string) {
    if (!code) throw new DomainError(ErrorCode.OTP_REQUIRED, 'Informe o código enviado por e-mail', 422);
    const otp = await tx.publicOtp.findFirst({
      where: { tenantId, orderId, purpose: 'QUOTE_DECISION', targetId: quoteId, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp || otp.attempts >= 5) throw new DomainError(ErrorCode.OTP_INVALID, 'Código inválido ou expirado', 422);
    if (otp.codeHash !== sha256Hex(`${quoteId}:${code}`)) {
      await tx.publicOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw new DomainError(ErrorCode.OTP_INVALID, 'Código inválido ou expirado', 422);
    }
    await tx.publicOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
  }

  /** Aprovação/recusa pelo cliente, vinculada à versão exata e com evidências minimizadas. */
  async decide(token: string, quoteId: string, decision: 'approve' | 'reject', input: { otpCode?: string; signerName: string; acceptText: string; reason?: string }) {
    const r = await this.resolve(token);
    const sub = await this.system.subscription.findUnique({ where: { tenantId: r.tenantId }, select: { status: true, currentPeriodEnd: true, graceUntil: true } });
    if (!sub || !isOperational(sub)) {
      throw new DomainError(ErrorCode.SUBSCRIPTION_INACTIVE, 'No momento a assistência não pode receber aprovações online. Entre em contato com a loja.', 409);
    }
    const c = maybeCtx();
    return this.db.runFor(r.tenantId, async (tx, hooks) => {
      const q = await tx.quote.findFirst({ where: { id: quoteId, tenantId: r.tenantId, orderId: r.orderId } });
      if (!q) throw this.notFound();
      const o = await tx.serviceOrder.findFirstOrThrow({ where: { id: r.orderId, tenantId: r.tenantId } });
      const requireOtp = await this.settings.get(tx, r.tenantId, 'portal.require_otp_for_quote', o.branchId);
      if (requireOtp) await this.verifyOtp(tx, r.tenantId, o.id, q.id, input.otpCode);
      const tpl = await documentTemplate(tx, r.tenantId, 'APPROVAL');
      const expected = this.acceptText(o.number, q.version, q.totalCents, tpl.content);
      if (decision === 'approve' && input.acceptText !== expected) throw Errors.validation('Texto de aceite não corresponde à versão atual do orçamento');
      const evidence = {
        method: 'PORTAL' as const,
        signerName: input.signerName,
        acceptText: decision === 'approve' ? expected : undefined,
        otpVerified: requireOtp,
        ipHash: this.crypto.ipHash(c?.ip),
        userAgent: c?.userAgent?.slice(0, 200) ?? null,
      };
      if (decision === 'approve') await this.quotes.applyApproval(tx, hooks, q, o, evidence, true);
      else await this.quotes.applyRejection(tx, hooks, q, o, input.reason ?? 'Recusado pelo cliente no portal', evidence, true);
      await this.audit.log(tx, {
        tenantId: r.tenantId,
        actorId: null,
        actorType: 'CUSTOMER',
        action: decision === 'approve' ? 'quote_approved_portal' : 'quote_rejected_portal',
        entity: 'quote',
        entityId: q.id,
        metadata: { version: q.version, otp: requireOtp },
      });
      return { status: decision === 'approve' ? 'APPROVED' : 'REJECTED' };
    });
  }
}
