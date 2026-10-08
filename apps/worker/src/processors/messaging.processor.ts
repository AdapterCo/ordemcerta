import { Injectable, OnModuleInit } from '@nestjs/common';
import { MessagingError, templateBodyParams, type ChannelCredentials } from '@ordemcerta/server';
import { UnrecoverableError, type Job } from 'bullmq';
import { Deps, isLastAttempt } from '../deps';
import { messageVariables } from '../messaging-render';

interface SendJob {
  deliveryId: string;
  tenantId: string;
  test?: boolean;
}

/** Envio real via WhatsApp Cloud API oficial (BYOK). Só canal ACTIVE envia. */
@Injectable()
export class MessagingProcessor implements OnModuleInit {
  constructor(private readonly deps: Deps) {}

  onModuleInit() {
    this.deps.startWorker<SendJob>('messaging', (job) => this.send(job), { concurrency: 10, limiter: { max: 40, duration: 1_000 } });
  }

  async send(job: Job<SendJob>) {
    const { db, crypto, whatsapp, env } = this.deps;
    const d = await db.messageDelivery.findFirst({ where: { id: job.data.deliveryId, tenantId: job.data.tenantId } });
    if (!d || !['QUEUED', 'FAILED'].includes(d.status)) return;
    const channel = d.channelId ? await db.messagingChannel.findFirst({ where: { id: d.channelId, tenantId: d.tenantId } }) : null;
    if (!channel || channel.status !== 'ACTIVE' || !channel.encryptedCredentialsRef) {
      await db.messageDelivery.update({ where: { id: d.id }, data: { status: 'BLOCKED', lastError: 'Canal não ativo no momento do envio' } });
      return;
    }
    if (channel.provider !== 'WHATSAPP_CLOUD') {
      await db.messageDelivery.update({ where: { id: d.id }, data: { status: 'FAILED', lastError: 'Adaptador não oficial não habilitado' } });
      return;
    }
    const consent = await db.customerConsent.findFirst({
      where: { tenantId: d.tenantId, customerId: d.customerId, channel: 'WHATSAPP', purpose: 'SERVICE_NOTIFICATIONS', revokedAt: null },
    });
    if (!consent) {
      await db.messageDelivery.update({ where: { id: d.id }, data: { status: 'SKIPPED', lastError: 'Opt-out/sem consentimento no momento do envio' } });
      return;
    }
    const template = d.templateId ? await db.messageTemplate.findFirst({ where: { id: d.templateId, tenantId: d.tenantId } }) : null;
    const customer = await db.customer.findFirstOrThrow({ where: { id: d.customerId, tenantId: d.tenantId } });
    const to = customer.whatsappE164 ?? customer.phoneE164;
    if (!template || template.approvalStatus !== 'APPROVED' || !template.enabled || !to) {
      await db.messageDelivery.update({ where: { id: d.id }, data: { status: 'SKIPPED', lastError: 'Template indisponível ou cliente sem telefone' } });
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
    const params = templateBodyParams((template.variablesJson as string[]) ?? [], vars);
    const creds = JSON.parse(crypto.decrypt(channel.encryptedCredentialsRef)) as ChannelCredentials;

    try {
      const { providerMessageId } = await whatsapp.sendTemplate(creds, { to, templateName: template.name, language: template.language, bodyParams: params });
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
