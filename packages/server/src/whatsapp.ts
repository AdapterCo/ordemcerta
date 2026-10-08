import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Mensageria. Interface `MessagingProvider` com o adaptador OFICIAL
 * (WhatsApp Business Platform Cloud API) como padrão. Credenciais BYOK:
 * pertencem à WABA do próprio tenant; o consumo é cobrado pela Meta
 * diretamente ao cliente (3.8.1).
 */

export class MessagingError extends Error {
  constructor(
    message: string,
    readonly code: 'NOT_CONFIGURED' | 'TOKEN_INVALID' | 'RATE_LIMITED' | 'RECIPIENT_INVALID' | 'TEMPLATE_INVALID' | 'PROVIDER_ERROR' | 'NOT_IMPLEMENTED',
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export interface ChannelCredentials {
  accessToken: string;
  phoneNumberId: string;
  wabaId: string;
}

export interface TemplateMessage {
  to: string; // E.164
  templateName: string;
  language: string;
  bodyParams: string[];
}

export interface MessagingProvider {
  readonly kind: 'WHATSAPP_CLOUD' | 'WHATSAPP_UNOFFICIAL_QR';
  readonly official: boolean;
  sendTemplate(creds: ChannelCredentials, msg: TemplateMessage): Promise<{ providerMessageId: string }>;
}

interface GraphError {
  error?: { message?: string; code?: number; error_subcode?: number; type?: string };
}

export class WhatsAppCloudProvider implements MessagingProvider {
  readonly kind = 'WHATSAPP_CLOUD' as const;
  readonly official = true;

  constructor(
    private readonly graphVersion: string,
    private readonly appId?: string,
    private readonly appSecret?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get isConfigured() {
    return Boolean(this.appId && this.appSecret);
  }

  private url(path: string) {
    return `https://graph.facebook.com/${this.graphVersion}/${path}`;
  }

  private async call<T>(path: string, init: RequestInit & { token?: string }): Promise<T> {
    const res = await this.fetchImpl(this.url(path), {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as T & GraphError;
    if (!res.ok) {
      const err = body.error ?? {};
      const code = err.code ?? 0;
      // Códigos Graph: 190 token inválido/expirado; 4/80007/130429 rate limit; 131026 destinatário indisponível; 132000-132001 template
      if (code === 190) throw new MessagingError('Token de acesso inválido ou expirado', 'TOKEN_INVALID', false);
      if ([4, 80007, 130429].includes(code)) throw new MessagingError('Limite de envio atingido', 'RATE_LIMITED', true);
      if ([131026, 131021].includes(code)) throw new MessagingError('Destinatário não pode receber mensagens', 'RECIPIENT_INVALID', false);
      if (code >= 132000 && code <= 132016) throw new MessagingError('Template inválido ou não aprovado', 'TEMPLATE_INVALID', false);
      throw new MessagingError(`Erro do provedor (${code || res.status})`, 'PROVIDER_ERROR', res.status >= 500);
    }
    return body;
  }

  async sendTemplate(creds: ChannelCredentials, msg: TemplateMessage) {
    const res = await this.call<{ messages?: Array<{ id: string }> }>(`${creds.phoneNumberId}/messages`, {
      method: 'POST',
      token: creds.accessToken,
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: msg.to.replace(/^\+/, ''),
        type: 'template',
        template: {
          name: msg.templateName,
          language: { code: msg.language },
          components: msg.bodyParams.length
            ? [{ type: 'body', parameters: msg.bodyParams.map((text) => ({ type: 'text', text })) }]
            : [],
        },
      }),
    });
    const id = res.messages?.[0]?.id;
    if (!id) throw new MessagingError('Resposta sem identificador de mensagem', 'PROVIDER_ERROR', true);
    return { providerMessageId: id };
  }

  /** Embedded Signup: troca o código recebido pelo token de acesso do cliente. */
  async exchangeEmbeddedSignupCode(code: string): Promise<{ accessToken: string; expiresIn: number | null }> {
    if (!this.isConfigured) throw new MessagingError('Integração Meta não configurada', 'NOT_CONFIGURED', false);
    const qs = new URLSearchParams({ client_id: this.appId!, client_secret: this.appSecret!, code });
    const res = await this.call<{ access_token?: string; expires_in?: number }>(`oauth/access_token?${qs}`, { method: 'GET' });
    if (!res.access_token) throw new MessagingError('Troca de código sem token', 'PROVIDER_ERROR', false);
    return { accessToken: res.access_token, expiresIn: res.expires_in ?? null };
  }

  /** Inscreve o app nos webhooks da WABA do cliente. */
  async subscribeAppToWaba(wabaId: string, token: string): Promise<void> {
    await this.call(`${wabaId}/subscribed_apps`, { method: 'POST', token });
  }

  async getPhoneNumber(phoneNumberId: string, token: string) {
    return this.call<{ id: string; display_phone_number?: string; verified_name?: string; quality_rating?: string }>(
      `${phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating`,
      { method: 'GET', token },
    );
  }

  /** Confirma que o número pertence à WABA informada (rejeita vinculação cruzada). */
  async listWabaPhoneNumbers(wabaId: string, token: string): Promise<string[]> {
    const res = await this.call<{ data?: Array<{ id: string }> }>(`${wabaId}/phone_numbers?fields=id`, { method: 'GET', token });
    return (res.data ?? []).map((p) => p.id);
  }

  async getWaba(wabaId: string, token: string) {
    return this.call<Record<string, unknown>>(`${wabaId}?fields=id,name,currency,timezone_id,message_template_namespace`, { method: 'GET', token });
  }

  async listTemplates(wabaId: string, token: string) {
    const res = await this.call<{ data?: Array<{ id: string; name: string; status: string; language: string }> }>(
      `${wabaId}/message_templates?fields=id,name,status,language&limit=200`,
      { method: 'GET', token },
    );
    return res.data ?? [];
  }

  /** Valida X-Hub-Signature-256 (HMAC-SHA256 do corpo bruto com o App Secret). */
  verifyWebhookSignature(rawBody: Buffer, header: string | undefined): boolean {
    if (!this.appSecret || !header?.startsWith('sha256=')) return false;
    const expected = createHmac('sha256', this.appSecret).update(rawBody).digest('hex');
    const received = header.slice('sha256='.length);
    if (expected.length !== received.length) return false;
    return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
  }
}

/**
 * Adaptador NÃO OFICIAL (conexão por QR Code). Explicitamente identificado
 * como não oficial: sujeito a desconexão/restrição e sem garantia de
 * continuidade. Não incluído nesta instalação: qualquer envio falha com
 * NOT_IMPLEMENTED, nunca simula sucesso.
 */
export class UnofficialQrProvider implements MessagingProvider {
  readonly kind = 'WHATSAPP_UNOFFICIAL_QR' as const;
  readonly official = false;
  async sendTemplate(): Promise<{ providerMessageId: string }> {
    throw new MessagingError('Adaptador não oficial (QR Code) não está habilitado nesta instalação', 'NOT_IMPLEMENTED', false);
  }
}

/* ------------------------------------------------ webhook payload parsing */

export interface WhatsAppStatusUpdate {
  phoneNumberId: string;
  wabaId: string | null;
  providerMessageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed' | string;
  timestamp: number;
  errorCode?: number;
}

/** Extrai atualizações de status do payload oficial (object=whatsapp_business_account). */
export function parseWhatsAppStatuses(payload: unknown): WhatsAppStatusUpdate[] {
  const out: WhatsAppStatusUpdate[] = [];
  const p = payload as { object?: string; entry?: Array<{ id?: string; changes?: Array<{ field?: string; value?: Record<string, unknown> }> }> };
  if (p?.object !== 'whatsapp_business_account') return out;
  for (const entry of p.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      const v = ch.value ?? {};
      const meta = (v.metadata ?? {}) as { phone_number_id?: string };
      for (const s of (v.statuses ?? []) as Array<Record<string, unknown>>) {
        if (!meta.phone_number_id || !s.id) continue;
        const errors = (s.errors ?? []) as Array<{ code?: number }>;
        out.push({
          phoneNumberId: meta.phone_number_id,
          wabaId: entry.id ?? null,
          providerMessageId: String(s.id),
          status: String(s.status),
          timestamp: Number(s.timestamp ?? 0),
          errorCode: errors[0]?.code,
        });
      }
    }
  }
  return out;
}

/** Mensagens recebidas (para registrar opt-out: "SAIR", "PARAR", "STOP"). */
export function parseWhatsAppInbound(payload: unknown): Array<{ phoneNumberId: string; from: string; text: string }> {
  const out: Array<{ phoneNumberId: string; from: string; text: string }> = [];
  const p = payload as { object?: string; entry?: Array<{ changes?: Array<{ value?: Record<string, unknown> }> }> };
  if (p?.object !== 'whatsapp_business_account') return out;
  for (const entry of p.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      const v = ch.value ?? {};
      const meta = (v.metadata ?? {}) as { phone_number_id?: string };
      for (const m of (v.messages ?? []) as Array<Record<string, unknown>>) {
        const text = ((m.text as { body?: string } | undefined)?.body ?? '').trim();
        if (meta.phone_number_id && m.from) out.push({ phoneNumberId: meta.phone_number_id, from: `+${String(m.from)}`, text });
      }
    }
  }
  return out;
}

export const OPT_OUT_KEYWORDS = ['SAIR', 'PARAR', 'STOP', 'CANCELAR', 'DESCADASTRAR'];
