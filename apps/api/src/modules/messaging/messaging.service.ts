import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  MessagingError,
  OPT_OUT_KEYWORDS,
  parseWhatsAppInbound,
  parseWhatsAppStatuses,
  sha256Hex,
  WhatsAppCloudProvider,
  type ChannelCredentials,
} from '@ordemcerta/server';
import {
  billingVerificationSchema,
  completeOnboardingSchema,
  createChannelSchema,
  maskPhone,
  MESSAGE_TEMPLATE_VARIABLES,
  paginationSchema,
  testMessageSchema,
  upsertTemplatesSchema,
} from '@ordemcerta/shared';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assertBranch, auth, currentTenantId } from '../../core/context';
import { SystemPrisma, TenantDb } from '../../core/database';
import { ENV, type AppEnv } from '../../core/env.provider';
import { Errors } from '../../core/errors';
import { AuditService, CryptoService, QueueService } from '../../core/services';

export const deliveriesQuery = paginationSchema.extend({
  status: z.enum(['QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED', 'BLOCKED']).optional(),
  orderId: z.string().uuid().optional(),
});

const STATUS_RANK: Record<string, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4 };

/**
 * WhatsApp oficial BYOK (3.8.1): conta/WABA/número/faturamento do PRÓPRIO
 * tenant. Envio real só com canal ACTIVE, que exige faturamento próprio
 * verificado (evidência auditável). Nenhuma linha de crédito da plataforma.
 */
@Injectable()
export class MessagingService {
  private readonly logger = new Logger('Messaging');
  readonly provider: WhatsAppCloudProvider;

  constructor(
    private readonly db: TenantDb,
    private readonly system: SystemPrisma,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly queues: QueueService,
    @Inject(ENV) private readonly env: AppEnv,
  ) {
    this.provider = new WhatsAppCloudProvider(env.META_GRAPH_VERSION, env.META_APP_ID, env.META_APP_SECRET);
  }

  private view<T extends { encryptedCredentialsRef: string | null }>(c: T) {
    const { encryptedCredentialsRef, ...rest } = c;
    return { ...rest, hasCredentials: Boolean(encryptedCredentialsRef) };
  }

  credentials(enc: string): ChannelCredentials {
    return JSON.parse(this.crypto.decrypt(enc)) as ChannelCredentials;
  }

  listChannels() {
    return this.db.run(async (tx) => (await tx.messagingChannel.findMany({ where: { tenantId: currentTenantId() }, orderBy: { createdAt: 'asc' } })).map((c) => this.view(c)));
  }

  createChannel(input: z.infer<typeof createChannelSchema>) {
    if (input.branchId) assertBranch(input.branchId);
    return this.db.run(async (tx) => {
      const c = await tx.messagingChannel.create({ data: { tenantId: currentTenantId(), branchId: input.branchId ?? null, name: input.name, provider: input.provider } });
      await this.audit.log(tx, { action: 'messaging_channel_created', entity: 'messaging_channel', entityId: c.id, metadata: { provider: input.provider } });
      return this.view(c);
    });
  }

  private async loadChannel(tx: Prisma.TransactionClient, id: string) {
    const c = await tx.messagingChannel.findFirst({ where: { id, tenantId: currentTenantId() } });
    if (!c) throw Errors.notFound('Canal');
    return c;
  }

  /** Status + checklist de prontidão (só "pronta" com mensagem real entregue e webhook recebido). */
  status(id: string) {
    return this.db.run(async (tx) => {
      const c = await this.loadChannel(tx, id);
      const approvedTemplates = await tx.messageTemplate.count({ where: { tenantId: c.tenantId, enabled: true, approvalStatus: 'APPROVED' } });
      return {
        ...this.view(c),
        official: c.provider === 'WHATSAPP_CLOUD',
        readiness: {
          credentialsStored: Boolean(c.encryptedCredentialsRef),
          ownBillingVerified: c.billingStatus === 'VERIFIED_OWN_BILLING',
          approvedTemplates,
          webhookReceived: Boolean(c.webhookLastReceivedAt),
          realMessageDelivered: Boolean(c.firstDeliveredAt),
          ready: c.status === 'ACTIVE' && Boolean(c.webhookLastReceivedAt) && Boolean(c.firstDeliveredAt) && approvedTemplates > 0,
        },
        notice: 'Tarifas e regras de cobrança das mensagens são definidas pela Meta e cobradas diretamente na conta do cliente; podem mudar. Valores exibidos aqui são operacionais/estimados, não fatura da Meta.',
      };
    });
  }

  startOnboarding(id: string) {
    return this.db.run(async (tx) => {
      const c = await this.loadChannel(tx, id);
      if (c.provider !== 'WHATSAPP_CLOUD') throw new MessagingError('Adaptador não oficial (QR Code) não está habilitado nesta instalação', 'NOT_IMPLEMENTED', false);
      if (!this.provider.isConfigured || !this.env.META_WEBHOOK_VERIFY_TOKEN) throw Errors.integrationNotConfigured('WhatsApp Business Platform (Meta)');
      await tx.messagingChannel.update({ where: { id }, data: { status: 'ONBOARDING' } });
      await this.audit.log(tx, { action: 'messaging_onboarding_started', entity: 'messaging_channel', entityId: id });
      if (this.env.META_EMBEDDED_SIGNUP_ENABLED && this.env.META_EMBEDDED_SIGNUP_CONFIG_ID) {
        return { mode: 'embedded_signup', appId: this.env.META_APP_ID, configId: this.env.META_EMBEDDED_SIGNUP_CONFIG_ID, graphVersion: this.env.META_GRAPH_VERSION };
      }
      return {
        mode: 'assisted',
        instructions: [
          'Use a sua própria conta Meta Business e WhatsApp Business Account (WABA).',
          'Configure a forma de pagamento da WABA diretamente na Meta (faturamento próprio).',
          'Gere um token de usuário do sistema com as permissões whatsapp_business_messaging e whatsapp_business_management.',
          'Informe o ID da WABA, o ID do número e o token. O token é armazenado criptografado e nunca é exibido novamente.',
        ],
      };
    });
  }

  /** Conclui a conexão: valida propriedade número↔WABA, inscreve webhooks e guarda token criptografado. */
  async completeOnboarding(id: string, input: z.infer<typeof completeOnboardingSchema>) {
    if (!this.provider.isConfigured) throw Errors.integrationNotConfigured('WhatsApp Business Platform (Meta)');
    let token = input.accessToken;
    let expiresIn: number | null = null;
    if (input.code) {
      const r = await this.provider.exchangeEmbeddedSignupCode(input.code);
      token = r.accessToken;
      expiresIn = r.expiresIn;
    }
    if (!token) throw Errors.validation('Informe o código do Embedded Signup ou o token do cliente');
    const numbers = await this.provider.listWabaPhoneNumbers(input.wabaId, token);
    if (!numbers.includes(input.phoneNumberId)) throw Errors.validation('O número informado não pertence a esta WABA');
    const taken = await this.system.messagingChannel.findFirst({ where: { externalPhoneId: input.phoneNumberId, NOT: { id } }, select: { id: true } });
    if (taken) throw Errors.conflict('Este número já está vinculado a outra conta');
    const phone = await this.provider.getPhoneNumber(input.phoneNumberId, token);
    await this.provider.subscribeAppToWaba(input.wabaId, token);

    return this.db.run(async (tx) => {
      const c = await this.loadChannel(tx, id);
      const creds: ChannelCredentials = { accessToken: token!, wabaId: input.wabaId, phoneNumberId: input.phoneNumberId };
      const verified = c.billingStatus === 'VERIFIED_OWN_BILLING';
      const u = await tx.messagingChannel.update({
        where: { id },
        data: {
          encryptedCredentialsRef: this.crypto.encrypt(JSON.stringify(creds)),
          externalPhoneId: input.phoneNumberId,
          externalWabaId: input.wabaId,
          displayPhoneMasked: phone.display_phone_number ? maskPhone(`+${phone.display_phone_number.replace(/\D/g, '')}`) : null,
          tokenExpiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
          status: verified ? 'ACTIVE' : 'CONNECTED_BILLING_PENDING',
          connectedAt: new Date(),
          disconnectedAt: null,
          lastError: null,
          version: { increment: 1 },
        },
      });
      await this.audit.log(tx, { action: 'messaging_channel_connected', entity: 'messaging_channel', entityId: id, metadata: { wabaId: input.wabaId, embedded: Boolean(input.code) } });
      return this.view(u);
    });
  }

  /** Reconexão: revalida o token armazenado. */
  connect(id: string) {
    return this.db.run(async (tx) => {
      const c = await this.loadChannel(tx, id);
      if (!c.encryptedCredentialsRef) throw Errors.precondition('Conclua a conexão oficial antes');
      const creds = this.credentials(c.encryptedCredentialsRef);
      try {
        await this.provider.getPhoneNumber(creds.phoneNumberId, creds.accessToken);
      } catch (e) {
        await tx.messagingChannel.update({ where: { id }, data: { status: 'ERROR', lastError: (e as Error).message.slice(0, 400) } });
        throw e;
      }
      const status = c.billingStatus === 'VERIFIED_OWN_BILLING' ? 'ACTIVE' : c.billingStatus === 'PENDING_REVIEW' ? 'BILLING_REVIEW_REQUIRED' : 'CONNECTED_BILLING_PENDING';
      const u = await tx.messagingChannel.update({ where: { id }, data: { status, lastError: null } });
      await this.audit.log(tx, { action: 'messaging_channel_reconnected', entity: 'messaging_channel', entityId: id });
      return this.view(u);
    });
  }

  /** Desconexão desabilita imediatamente novos envios e descarta credenciais; histórico preservado. */
  disconnect(id: string) {
    return this.db.run(async (tx) => {
      await this.loadChannel(tx, id);
      const u = await tx.messagingChannel.update({
        where: { id },
        data: { status: 'DISCONNECTED', encryptedCredentialsRef: null, disconnectedAt: new Date(), version: { increment: 1 } },
      });
      await tx.messageDelivery.updateMany({ where: { tenantId: u.tenantId, channelId: id, status: 'QUEUED' }, data: { status: 'BLOCKED', lastError: 'Canal desconectado' } });
      await this.audit.log(tx, { action: 'messaging_channel_disconnected', entity: 'messaging_channel', entityId: id });
      return this.view(u);
    });
  }

  billingStatus(id: string) {
    return this.db.run(async (tx) => {
      const c = await this.loadChannel(tx, id);
      const checks = await tx.messagingBillingCheck.findMany({ where: { tenantId: c.tenantId, channelId: id }, orderBy: { checkedAt: 'desc' } });
      return { billingStatus: c.billingStatus, billingVerifiedAt: c.billingVerifiedAt, method: c.billingVerificationMethod, checks };
    });
  }

  /**
   * Evidência de faturamento próprio enviada pelo tenant. A API da Meta não
   * expõe evidência suficiente de forma geral: fica BILLING_REVIEW_REQUIRED até
   * validação auditada pela plataforma.
   */
  submitBillingVerification(id: string, input: z.infer<typeof billingVerificationSchema>) {
    if (input.approve) throw Errors.forbidden('A aprovação do faturamento é feita pela equipe da plataforma');
    return this.db.run(async (tx) => {
      const c = await this.loadChannel(tx, id);
      if (!c.encryptedCredentialsRef) throw Errors.precondition('Conecte a conta oficial antes de enviar a evidência de faturamento');
      await tx.messagingBillingCheck.create({
        data: { tenantId: c.tenantId, channelId: id, status: 'PENDING_REVIEW', method: input.method, evidenceRef: input.evidenceFileId ?? null, checkedBy: auth().userId, notes: input.evidenceNote },
      });
      const u = await tx.messagingChannel.update({ where: { id }, data: { billingStatus: 'PENDING_REVIEW', status: 'BILLING_REVIEW_REQUIRED' } });
      await this.audit.log(tx, { action: 'messaging_billing_evidence_submitted', entity: 'messaging_channel', entityId: id, metadata: { method: input.method } });
      return this.view(u);
    });
  }

  listTemplates() {
    return this.db.run((tx) => tx.messageTemplate.findMany({ where: { tenantId: currentTenantId() }, orderBy: { eventType: 'asc' } }));
  }

  upsertTemplates(input: z.infer<typeof upsertTemplatesSchema>) {
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      const allowed = new Set<string>(MESSAGE_TEMPLATE_VARIABLES);
      for (const t of input.templates) {
        const bad = t.variables.filter((v) => !allowed.has(v));
        if (bad.length) throw Errors.validation(`Variáveis não permitidas: ${bad.join(', ')}`);
        const existing = await tx.messageTemplate.findUnique({ where: { tenantId_eventType_provider: { tenantId, eventType: t.eventType, provider: 'WHATSAPP_CLOUD' } } });
        const changed = existing && (existing.body !== t.body || existing.name !== t.name || existing.language !== t.language);
        await tx.messageTemplate.upsert({
          where: { tenantId_eventType_provider: { tenantId, eventType: t.eventType, provider: 'WHATSAPP_CLOUD' } },
          create: { tenantId, eventType: t.eventType, name: t.name, language: t.language, body: t.body, variablesJson: t.variables, enabled: t.enabled, approvalStatus: t.approvalStatus },
          update: {
            name: t.name,
            language: t.language,
            body: t.body,
            variablesJson: t.variables,
            enabled: t.enabled,
            // alteração de conteúdo exige nova aprovação na Meta
            approvalStatus: changed ? 'PENDING' : t.approvalStatus,
            version: changed ? { increment: 1 } : undefined,
          },
        });
      }
      await this.audit.log(tx, { action: 'message_templates_updated', entity: 'message_template', metadata: { count: input.templates.length } });
      return tx.messageTemplate.findMany({ where: { tenantId }, orderBy: { eventType: 'asc' } });
    });
  }

  /** Sincroniza status de aprovação dos templates com a WABA oficial do cliente. */
  syncTemplates(channelId: string) {
    return this.db.run(async (tx) => {
      const c = await this.loadChannel(tx, channelId);
      if (!c.encryptedCredentialsRef || !c.externalWabaId) throw Errors.precondition('Canal sem conexão oficial');
      const creds = this.credentials(c.encryptedCredentialsRef);
      const remote = await this.provider.listTemplates(c.externalWabaId, creds.accessToken);
      const local = await tx.messageTemplate.findMany({ where: { tenantId: c.tenantId } });
      for (const t of local) {
        const r = remote.find((x) => x.name === t.name && x.language === t.language);
        const status = r ? (r.status === 'APPROVED' ? 'APPROVED' : r.status === 'REJECTED' ? 'REJECTED' : 'PENDING') : 'DRAFT';
        await tx.messageTemplate.update({ where: { id: t.id }, data: { approvalStatus: status, externalTemplateId: r?.id ?? null } });
      }
      return tx.messageTemplate.findMany({ where: { tenantId: c.tenantId } });
    });
  }

  deliveries(q: z.infer<typeof deliveriesQuery>) {
    return this.db.run(async (tx) => {
      const where: Prisma.MessageDeliveryWhereInput = { tenantId: currentTenantId(), status: q.status, orderId: q.orderId };
      const [items, total] = await Promise.all([
        tx.messageDelivery.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
        tx.messageDelivery.count({ where }),
      ]);
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  /** Mensagem de teste real (somente canal ACTIVE + template aprovado). */
  test(input: z.infer<typeof testMessageSchema>) {
    return this.db.run(async (tx, hooks) => {
      const tenantId = currentTenantId();
      const c = await this.loadChannel(tx, input.channelId);
      if (c.status !== 'ACTIVE') throw Errors.precondition('Canal não está ativo (faturamento próprio não validado ou desconectado)');
      const tpl = await tx.messageTemplate.findFirst({ where: { tenantId, eventType: input.eventType, enabled: true, approvalStatus: 'APPROVED' } });
      if (!tpl) throw Errors.precondition('Não há template aprovado e habilitado para este evento');
      const customer = await tx.customer.findFirst({ where: { tenantId, OR: [{ whatsappE164: input.to }, { phoneE164: input.to }] } });
      if (!customer) throw Errors.validation('O número de teste precisa estar cadastrado como cliente (com consentimento)');
      const eventId = randomUUID();
      const d = await tx.messageDelivery.create({
        data: {
          tenantId,
          channelId: c.id,
          customerId: customer.id,
          templateId: tpl.id,
          eventId,
          eventType: input.eventType,
          dedupeKey: sha256Hex(`${eventId}:${tpl.id}:${input.to}`),
          recipientMasked: maskPhone(input.to),
          status: 'QUEUED',
        },
      });
      hooks.afterCommit(() => this.queues.add('messaging', 'send', { deliveryId: d.id, tenantId, test: true }));
      await this.audit.log(tx, { action: 'messaging_test_queued', entity: 'message_delivery', entityId: d.id });
      return d;
    });
  }

  /* ------------------------------------------------------------ webhook */

  verifyChallenge(mode?: string, token?: string, challenge?: string) {
    if (mode === 'subscribe' && token && this.env.META_WEBHOOK_VERIFY_TOKEN && token === this.env.META_WEBHOOK_VERIFY_TOKEN && challenge) return challenge;
    throw Errors.forbidden('Verificação de webhook inválida');
  }

  /** Webhook oficial: assinatura validada; tenant SEMPRE derivado do phone_number_id cadastrado. */
  async handleWebhook(rawBody: Buffer | undefined, signature: string | undefined, payload: unknown) {
    if (!rawBody || !this.provider.verifyWebhookSignature(rawBody, signature)) throw Errors.forbidden('Assinatura inválida');
    const now = new Date();
    for (const s of parseWhatsAppStatuses(payload)) {
      const channel = await this.system.messagingChannel.findUnique({ where: { externalPhoneId: s.phoneNumberId } });
      if (!channel || (s.wabaId && channel.externalWabaId && s.wabaId !== channel.externalWabaId)) continue;
      await this.system.messagingChannel.update({ where: { id: channel.id }, data: { webhookLastReceivedAt: now } });
      const d = await this.system.messageDelivery.findFirst({ where: { tenantId: channel.tenantId, providerMessageId: s.providerMessageId } });
      if (!d) continue;
      const next = s.status === 'sent' ? 'SENT' : s.status === 'delivered' ? 'DELIVERED' : s.status === 'read' ? 'READ' : s.status === 'failed' ? 'FAILED' : null;
      if (!next || (STATUS_RANK[next] ?? 0) <= (STATUS_RANK[d.status] ?? 0)) continue;
      await this.system.messageDelivery.update({
        where: { id: d.id },
        data: {
          status: next,
          deliveredAt: next === 'DELIVERED' ? now : d.deliveredAt,
          readAt: next === 'READ' ? now : d.readAt,
          lastError: next === 'FAILED' ? `Falha reportada pela Meta (${s.errorCode ?? 'sem código'})` : d.lastError,
        },
      });
      if ((next === 'DELIVERED' || next === 'READ') && !channel.firstDeliveredAt) {
        await this.system.messagingChannel.update({ where: { id: channel.id }, data: { firstDeliveredAt: now } });
      }
    }
    for (const m of parseWhatsAppInbound(payload)) {
      const channel = await this.system.messagingChannel.findUnique({ where: { externalPhoneId: m.phoneNumberId } });
      if (!channel) continue;
      await this.system.messagingChannel.update({ where: { id: channel.id }, data: { webhookLastReceivedAt: now } });
      if (!OPT_OUT_KEYWORDS.includes(m.text.trim().toUpperCase())) continue;
      const customers = await this.system.customer.findMany({ where: { tenantId: channel.tenantId, OR: [{ whatsappE164: m.from }, { phoneE164: m.from }] }, select: { id: true } });
      for (const c of customers) {
        await this.system.customerConsent.updateMany({
          where: { tenantId: channel.tenantId, customerId: c.id, channel: 'WHATSAPP', revokedAt: null },
          data: { revokedAt: now },
        });
        await this.system.auditLog.create({
          data: { tenantId: channel.tenantId, actorType: 'CUSTOMER', action: 'whatsapp_opt_out', entity: 'customer', entityId: c.id },
        });
      }
    }
  }
}
