import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, type NotificationOutbox } from '@prisma/client';
import { isUniqueViolation, sha256Hex } from '@ordemcerta/server';
import { maskPhone } from '@ordemcerta/shared';
import { Deps } from '../deps';
import { OUTBOX_TO_MESSAGING, quietHoursDelay } from '../messaging-render';

/**
 * Despacho do outbox transacional. Claim com FOR UPDATE SKIP LOCKED (várias
 * réplicas não processam o mesmo evento). Falhas de provedor nunca afetam a
 * transação da OS; retries com backoff e DEAD após o limite.
 */
@Injectable()
export class OutboxProcessor implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly deps: Deps) {}

  onModuleInit() {
    this.deps.startWorker('outbox', async () => this.dispatch(), { concurrency: 1 });
    this.timer = setInterval(() => void this.dispatch(), 5_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async dispatch() {
    if (this.running) return;
    this.running = true;
    try {
      for (let i = 0; i < 20; i++) {
        const batch = await this.claim();
        if (!batch.length) break;
        for (const ev of batch) await this.handle(ev);
      }
    } catch (e) {
      this.deps.log.error({ err: (e as Error).message }, 'falha no despacho do outbox');
    } finally {
      this.running = false;
    }
  }

  private claim() {
    return this.deps.db.$queryRaw<NotificationOutbox[]>`
      UPDATE notification_outbox SET status = 'PROCESSING', attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM notification_outbox
        WHERE status IN ('PENDING','FAILED') AND available_at <= now()
        ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED
      )
      RETURNING id, tenant_id AS "tenantId", event_id AS "eventId", event_type AS "eventType", aggregate_type AS "aggregateType",
        aggregate_id AS "aggregateId", payload_json AS "payloadJson", status, attempts, available_at AS "availableAt",
        last_error AS "lastError", created_at AS "createdAt", processed_at AS "processedAt"`;
  }

  private async handle(ev: NotificationOutbox) {
    const db = this.deps.db;
    try {
      const messagingEvent = OUTBOX_TO_MESSAGING[ev.eventType];
      if (messagingEvent && ev.tenantId) await this.enqueueMessage(ev, messagingEvent);
      await db.notificationOutbox.update({ where: { id: ev.id }, data: { status: 'DONE', processedAt: new Date(), lastError: null } });
    } catch (e) {
      const dead = ev.attempts >= 10;
      const backoff = Math.min(2 ** ev.attempts * 5_000, 3_600_000);
      await db.notificationOutbox.update({
        where: { id: ev.id },
        data: { status: dead ? 'DEAD' : 'FAILED', lastError: (e as Error).message.slice(0, 900), availableAt: new Date(Date.now() + backoff) },
      });
      this.deps.log.warn({ eventId: ev.eventId, attempts: ev.attempts, dead }, 'evento do outbox falhou');
    }
  }

  /** Cria a entrega (deduplicada por event_id + template + destinatário) somente se canal/template/consentimento permitirem. */
  private async enqueueMessage(ev: NotificationOutbox, eventType: string) {
    const db = this.deps.db;
    const tenantId = ev.tenantId!;
    const p = ev.payloadJson as { orderId?: string; customerId?: string; branchId?: string };
    if (!p.customerId) return;
    const channels = await db.messagingChannel.findMany({ where: { tenantId } });
    if (!channels.length) return; // empresa não usa WhatsApp: nada a registrar
    const customer = await db.customer.findFirst({ where: { id: p.customerId, tenantId } });
    if (!customer) return;
    const recipient = customer.whatsappE164 ?? customer.phoneE164;
    const channel =
      channels.find((c) => c.status === 'ACTIVE' && c.branchId === p.branchId) ?? channels.find((c) => c.status === 'ACTIVE' && !c.branchId) ?? null;
    const template = await db.messageTemplate.findFirst({ where: { tenantId, eventType, enabled: true, approvalStatus: 'APPROVED' } });
    const consent = await db.customerConsent.findFirst({
      where: { tenantId, customerId: customer.id, channel: 'WHATSAPP', purpose: 'SERVICE_NOTIFICATIONS', revokedAt: null },
    });
    let skip: string | null = null;
    if (!recipient) skip = 'Cliente sem telefone';
    else if (!channel) skip = 'Canal WhatsApp oficial não ativo (faturamento próprio pendente ou desconectado)';
    else if (!template) skip = 'Template não aprovado/habilitado para este evento';
    else if (!consent) skip = 'Cliente sem opt-in para notificações por WhatsApp';

    const dedupeKey = sha256Hex(`${ev.eventId}:${template?.id ?? eventType}:${recipient ?? customer.id}`);
    try {
      const d = await db.messageDelivery.create({
        data: {
          tenantId,
          channelId: channel?.id ?? null,
          orderId: p.orderId ?? null,
          customerId: customer.id,
          templateId: template?.id ?? null,
          eventId: ev.eventId,
          eventType,
          dedupeKey,
          recipientMasked: maskPhone(recipient),
          status: skip ? 'SKIPPED' : 'QUEUED',
          lastError: skip,
        },
      });
      if (!skip) {
        const quietSetting = await db.setting.findFirst({ where: { tenantId, key: 'messaging.quiet_hours', scope: 'tenant' } });
        const quiet = (quietSetting?.valueJson as { start: string; end: string } | null | undefined) ?? { start: '21:00', end: '08:00' };
        const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } });
        const delay = quietHoursDelay(new Date(), quiet, tenant?.timezone ?? 'America/Sao_Paulo');
        await this.deps.queue('messaging').add('send', { deliveryId: d.id, tenantId }, { delay, jobId: `delivery:${d.id}` });
      }
    } catch (e) {
      if (isUniqueViolation(e)) return; // já registrado (reprocessamento sem duplicar mensagem)
      if (e instanceof Prisma.PrismaClientKnownRequestError) throw new Error(`erro ao registrar entrega: ${e.code}`);
      throw e;
    }
  }
}
