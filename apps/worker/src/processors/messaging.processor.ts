import { Injectable, type OnModuleInit } from '@nestjs/common';
import { MessagingError, renderPlaceholders, templateBodyParams, type ChannelCredentials } from '@ordemcerta/server';
import { UnrecoverableError, type Job } from 'bullmq';
import { Deps, isLastAttempt } from '../deps';
import { messageVariables } from '../messaging-render';

interface SendJob {
  deliveryId: string;
  tenantId: string;
  test?: boolean;
}
interface SessionJob {
  channelId: string;
  tenantId?: string;
}
type MessagingJobData = SendJob | SessionJob;

/**
 * Envia notificações: canal WHATSAPP_CLOUD via Cloud API oficial (BYOK) e
 * canal WHATSAPP_UNOFFICIAL_QR via Baileys (sessão no worker). Também roteia
 * jobs de controle de sessão (session-start / session-stop). Só canal ACTIVE envia.
 */
@Injectable()
export class MessagingProcessor implements OnModuleInit {
  constructor(private readonly deps: Deps) {}

  onModuleInit() {
    void this.deps.sessions.init();
    this.deps.startWorker<MessagingJobData>('messaging', (job) => this.route(job), { concurrency: 10, limiter: { max: 40, duration: 1_000 } });
  }

  private async route(job: Job<MessagingJobData>) {
    if (job.name === 'session-start') {
      await this.deps.sessions.startSession((job.data as SessionJob).channelId);
      return;
    }
    if (job.name === 'session-restart') {
      await this.deps.sessions.restartSession((job.data as SessionJob).channelId, (job.data as { fresh?: boolean }).fresh === true);
      return;
    }
    if (job.name === 'session-stop') {
      const d = job.data as SessionJob;
      await this.deps.sessions.stopSession(d.channelId, (job.data as { logout?: boolean }).logout === true);
      return;
    }
    await this.send(job as unknown as Job<SendJob>);
  }

  private async blockDelivery(id: string, lastError: string) {
    await this.deps.db.messageDelivery.update({ where: { id }, data: { status: 'BLOCKED', lastError } });
  }

  private async skipDelivery(id: string, lastError: string) {
    await this.deps.db.messageDelivery.update({ where: { id }, data: { status: 'SKIPPED', lastError } });
  }

  async send(job: Job<SendJob>) {
    const { db, crypto, env } = this.deps;
    const d = await db.messageDelivery.findFirst({ where: { id: job.data.deliveryId, tenantId: job.data.tenantId } });
    if (!d || !['QUEUED', 'FAILED'].includes(d.status)) return;
    const channel = d.channelId ? await db.messagingChannel.findFirst({ where: { id: d.channelId, tenantId: d.tenantId } }) : null;
    if (!channel || channel.status !== 'ACTIVE' || !channel.encryptedCredentialsRef) {
      await this.blockDelivery(d.id, 'Canal não ativo no momento do envio');
      return;
    }
    const official = channel.provider === 'WHATSAPP_CLOUD';
    const consent = await db.customerConsent.findFirst({
      where: { tenantId: d.tenantId, customerId: d.customerId, channel: 'WHATSAPP', purpose: 'SERVICE_NOTIFICATIONS', revokedAt: null },
    });
    if (!consent) {
      await this.skipDelivery(d.id, 'Opt-out/sem consentimento no momento do envio');
      return;
    }
    const template = d.templateId ? await db.messageTemplate.findFirst({ where: { id: d.templateId, tenantId: d.tenantId } }) : null;
    const customer = await db.customer.findFirstOrThrow({ where: { id: d.customerId, tenantId: d.tenantId } });
    const to = customer.whatsappE164 ?? customer.phoneE164;
    // API oficial exige template aprovado na Meta; canal QR usa o texto local renderizado.
    if (!template || !template.enabled || !template.body || !to || (official && template.approvalStatus !== 'APPROVED')) {
      await this.skipDelivery(d.id, 'Template indisponível ou cliente sem telefone');
      return;
    }

    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: d.tenantId }, select: { name: true, timezone: true } });
    const order = d.orderId
      ? await db.serviceOrder.findFirst({
          where: { id: d.orderId, tenantId: d.tenantId },
          include: { device: { select: { brand: true, model: true } }, branch: { select: { name: true, timezone: true } } },
        })
      : null;
    const event = await db.notificationOutbox.findUnique({ where: { eventId: d.eventId } });
    const payload = (event?.payloadJson ?? {}) as { trackingTokenEnc?: string; quoteTokenEnc?: string; totalCents?: number };
    let link = `${env.APP_URL}/status`;
    try {
      if (payload.quoteTokenEnc) link = `${env.APP_URL}/quote#token=${crypto.decrypt(payload.quoteTokenEnc)}`;
      else if (payload.trackingTokenEnc && order) link = `${env.APP_URL}/status/${order.number}#token=${crypto.decrypt(payload.trackingTokenEnc)}`;
    } catch {
      /* chave rotacionada: usa link genérico */
    }
    const vars = messageVariables({
      customerName: customer.name,
      orderNumber: order?.number,
      device: order ? `${order.device.brand} ${order.device.model}` : null,
      companyName: tenant.name,
      branchName: order?.branch.name,
      technicalStatus: order?.technicalStatus,
      link,
      quoteTotalCents: payload.totalCents ?? (order?.approvedQuoteId ? order.totalCents : null),
      estimatedDeliveryAt: order?.estimatedDeliveryAt,
      timezone: order?.branch.timezone ?? tenant.timezone,
    });

    try {
      let providerMessageId: string;
      if (official) {
        const params = templateBodyParams((template.variablesJson as string[]) ?? [], vars);
        const creds = JSON.parse(crypto.decrypt(channel.encryptedCredentialsRef)) as ChannelCredentials;
        providerMessageId = (await this.deps.whatsapp.sendTemplate(creds, { to, templateName: template.name, language: template.language, bodyParams: params })).providerMessageId;
      } else {
        // QR/Baileys: sessão tem de estar online; reconecta com credenciais salvas se necessário
        await this.deps.sessions.ensureForSend(channel.id, channel.encryptedCredentialsRef);
        const text = renderPlaceholders(template.body, vars);
        providerMessageId = (await this.deps.sessions.sendText(channel.id, to, text)).providerMessageId;
      }
      await db.messageDelivery.update({
        where: { id: d.id },
        data: { status: 'SENT', providerMessageId, sentAt: new Date(), attempts: { increment: 1 }, lastError: null },
      });
    } catch (e) {
      const err = e instanceof MessagingError ? e : new MessagingError((e as Error).message, 'PROVIDER_ERROR', true);
      const final = !err.retryable || isLastAttempt(job);
      await db.messageDelivery.update({
        where: { id: d.id },
        data: { status: final ? 'FAILED' : 'QUEUED', attempts: { increment: 1 }, lastError: `${err.code}: ${err.message}`.slice(0, 480) },
      });
      if (err.code === 'TOKEN_INVALID') {
        await db.messagingChannel.update({ where: { id: channel.id }, data: { status: 'ERROR', lastError: 'Token expirado ou revogado — reconecte a conta oficial' } });
        await db.auditLog.create({ data: { tenantId: d.tenantId, actorType: 'SYSTEM', action: 'messaging_token_invalid', entity: 'messaging_channel', entityId: channel.id } });
      }
      if (!err.retryable) throw new UnrecoverableError(err.message);
      throw err;
    }
  }
}
