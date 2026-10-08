import MercadoPagoConfig, { Invoice, InvalidWebhookSignatureError, Payment, PreApproval, WebhookSignatureValidator } from 'mercadopago';
import type { BillingPaymentStatus } from '@ordemcerta/shared';

/**
 * Adapter do Mercado Pago para o billing da PLATAFORMA (conta da operadora do
 * SaaS). Usa exclusivamente o SDK oficial (mercadopago@2): Payment (Pix
 * avulso), PreApproval (assinatura de cartão), Invoice (cobranças
 * autorizadas de assinatura) e WebhookSignatureValidator.
 *
 * Nada aqui é usado para recebimentos das assistências (17.2).
 */

export class MercadoPagoNotConfiguredError extends Error {
  constructor() {
    super('Mercado Pago: integração não configurada');
  }
}

export interface NormalizedPayment {
  id: string;
  status: BillingPaymentStatus;
  rawStatus: string;
  statusDetail: string | null;
  amountCents: number;
  currency: string;
  externalReference: string | null;
  dateApproved: string | null;
  paymentMethodId: string | null;
  raw: Record<string, unknown>;
}

export interface PixCharge {
  providerPaymentId: string;
  status: BillingPaymentStatus;
  qrCode: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
  expiresAt: Date | null;
}

export interface PreapprovalInfo {
  id: string;
  status: string;
  initPoint: string | null;
  externalReference: string | null;
  amountCents: number | null;
  nextPaymentDate: string | null;
}

export interface AuthorizedPaymentInfo {
  id: string;
  preapprovalId: string | null;
  paymentId: string | null;
  status: string | null;
  amountCents: number | null;
}

export function mapMpStatus(status: string | undefined | null): BillingPaymentStatus {
  switch (status) {
    case 'approved':
      return 'APPROVED';
    case 'pending':
    case 'in_process':
    case 'authorized':
    case 'in_mediation':
      return 'PENDING';
    case 'rejected':
      return 'REJECTED';
    case 'cancelled':
      return 'CANCELED';
    case 'refunded':
      return 'REFUNDED';
    case 'charged_back':
      return 'CHARGEBACK';
    default:
      return 'PENDING';
  }
}

const toAmount = (cents: number) => Math.round(cents) / 100;
const toCents = (amount: unknown): number => {
  const n = typeof amount === 'number' ? amount : Number(amount);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};

export class MercadoPagoGateway {
  private readonly config: MercadoPagoConfig | null;

  constructor(
    accessToken: string | undefined,
    private readonly webhookSecret: string | undefined,
    private readonly toleranceSeconds = 300,
  ) {
    this.config = accessToken ? new MercadoPagoConfig({ accessToken, options: { timeout: 10_000 } }) : null;
  }

  get isConfigured(): boolean {
    return Boolean(this.config && this.webhookSecret);
  }

  private cfg(): MercadoPagoConfig {
    if (!this.config) throw new MercadoPagoNotConfiguredError();
    return this.config;
  }

  async createPixPayment(input: {
    amountCents: number;
    description: string;
    payerEmail: string;
    payerDocument?: { type: 'CPF' | 'CNPJ'; number: string } | null;
    externalReference: string;
    expiresAt: Date;
    notificationUrl: string;
    idempotencyKey: string;
  }): Promise<PixCharge> {
    const res = await new Payment(this.cfg()).create({
      body: {
        transaction_amount: toAmount(input.amountCents),
        description: input.description,
        payment_method_id: 'pix',
        external_reference: input.externalReference,
        notification_url: input.notificationUrl,
        date_of_expiration: input.expiresAt.toISOString().replace('Z', '-00:00'),
        payer: {
          email: input.payerEmail,
          ...(input.payerDocument ? { identification: { type: input.payerDocument.type, number: input.payerDocument.number } } : {}),
        },
      },
      requestOptions: { idempotencyKey: input.idempotencyKey },
    });
    const tx = (res.point_of_interaction as { transaction_data?: Record<string, unknown> } | undefined)?.transaction_data ?? {};
    return {
      providerPaymentId: String(res.id),
      status: mapMpStatus(res.status),
      qrCode: (tx.qr_code as string) ?? null,
      qrCodeBase64: (tx.qr_code_base64 as string) ?? null,
      ticketUrl: (tx.ticket_url as string) ?? null,
      expiresAt: res.date_of_expiration ? new Date(res.date_of_expiration) : input.expiresAt,
    };
  }

  async getPayment(id: string): Promise<NormalizedPayment> {
    const p = await new Payment(this.cfg()).get({ id });
    return {
      id: String(p.id),
      status: mapMpStatus(p.status),
      rawStatus: String(p.status ?? ''),
      statusDetail: p.status_detail ?? null,
      amountCents: toCents(p.transaction_amount),
      currency: String(p.currency_id ?? ''),
      externalReference: p.external_reference ?? null,
      dateApproved: p.date_approved ?? null,
      paymentMethodId: p.payment_method_id ?? null,
      raw: {
        id: p.id,
        status: p.status,
        status_detail: p.status_detail,
        transaction_amount: p.transaction_amount,
        currency_id: p.currency_id,
        external_reference: p.external_reference,
        date_approved: p.date_approved,
        date_last_updated: p.date_last_updated,
        payment_type_id: p.payment_type_id,
      },
    };
  }

  /** Busca pagamentos por external_reference (reconciliação de webhook ausente). */
  async searchPaymentsByExternalReference(externalReference: string): Promise<NormalizedPayment[]> {
    const res = await new Payment(this.cfg()).search({ options: { external_reference: externalReference, limit: 30 } as never });
    const results = (res.results ?? []) as Array<{ id?: number | string }>;
    const out: NormalizedPayment[] = [];
    for (const r of results) if (r.id !== undefined) out.push(await this.getPayment(String(r.id)));
    return out;
  }

  async createPreapproval(input: {
    reason: string;
    amountCents: number;
    payerEmail: string;
    externalReference: string;
    backUrl: string;
    idempotencyKey: string;
  }): Promise<PreapprovalInfo> {
    const res = await new PreApproval(this.cfg()).create({
      body: {
        reason: input.reason,
        external_reference: input.externalReference,
        payer_email: input.payerEmail,
        back_url: input.backUrl,
        status: 'pending',
        auto_recurring: {
          frequency: 1,
          frequency_type: 'months',
          transaction_amount: toAmount(input.amountCents),
          currency_id: 'BRL',
        },
      },
      requestOptions: { idempotencyKey: input.idempotencyKey },
    });
    return this.mapPreapproval(res as unknown as Record<string, unknown>);
  }

  async getPreapproval(id: string): Promise<PreapprovalInfo> {
    const res = await new PreApproval(this.cfg()).get({ id });
    return this.mapPreapproval(res as unknown as Record<string, unknown>);
  }

  /** Atualiza o valor das renovações futuras; o chamador verifica o resultado com getPreapproval. */
  async updatePreapprovalAmount(id: string, amountCents: number): Promise<PreapprovalInfo> {
    await new PreApproval(this.cfg()).update({
      id,
      body: { auto_recurring: { transaction_amount: toAmount(amountCents), currency_id: 'BRL' } } as never,
    });
    return this.getPreapproval(id);
  }

  async cancelPreapproval(id: string): Promise<PreapprovalInfo> {
    await new PreApproval(this.cfg()).update({ id, body: { status: 'cancelled' } as never });
    return this.getPreapproval(id);
  }

  /** Cobrança autorizada de assinatura (tópico subscription_authorized_payment). */
  async getAuthorizedPayment(id: string): Promise<AuthorizedPaymentInfo> {
    const r = (await new Invoice(this.cfg()).get({ id })) as unknown as Record<string, unknown>;
    const payment = (r.payment ?? {}) as Record<string, unknown>;
    return {
      id: String(r.id),
      preapprovalId: (r.preapproval_id as string) ?? null,
      paymentId: payment.id !== undefined && payment.id !== null ? String(payment.id) : null,
      status: (r.status as string) ?? null,
      amountCents: r.transaction_amount !== undefined ? toCents(r.transaction_amount) : null,
    };
  }

  /**
   * Valida a assinatura `x-signature` via SDK oficial (HMAC-SHA256 do manifesto
   * id/request-id/ts), com janela de tolerância contra replay.
   */
  validateWebhook(input: { xSignature: string | undefined; xRequestId: string | undefined; dataId: string | undefined }): {
    valid: boolean;
    reason?: string;
  } {
    if (!this.webhookSecret) return { valid: false, reason: 'NOT_CONFIGURED' };
    try {
      WebhookSignatureValidator.validate({
        xSignature: input.xSignature,
        xRequestId: input.xRequestId,
        dataId: input.dataId,
        secret: this.webhookSecret,
        tolerance: this.toleranceSeconds,
      } as never);
      return { valid: true };
    } catch (e) {
      if (e instanceof InvalidWebhookSignatureError) return { valid: false, reason: String(e.reason) };
      return { valid: false, reason: 'ERROR' };
    }
  }

  private mapPreapproval(r: Record<string, unknown>): PreapprovalInfo {
    const auto = (r.auto_recurring ?? {}) as Record<string, unknown>;
    return {
      id: String(r.id),
      status: String(r.status ?? ''),
      initPoint: (r.init_point as string) ?? null,
      externalReference: (r.external_reference as string) ?? null,
      amountCents: auto.transaction_amount !== undefined ? toCents(auto.transaction_amount) : null,
      nextPaymentDate: (r.next_payment_date as string) ?? null,
    };
  }
}
