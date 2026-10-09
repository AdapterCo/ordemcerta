import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { emailTemplate } from '@ordemcerta/server';
import type { EmailOutbox } from '@prisma/client';
import { Deps } from '../deps';

/** Envio de e-mails do sistema (recuperação de senha, cobrança). Independe do WhatsApp do tenant. */
@Injectable()
export class EmailProcessor implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly deps: Deps) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), 15_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const rows = await this.deps.db.$queryRaw<EmailOutbox[]>`
        UPDATE email_outbox SET attempts = attempts + 1
        WHERE id IN (
          SELECT id FROM email_outbox WHERE status = 'PENDING' AND attempts < 6
          ORDER BY created_at LIMIT 25 FOR UPDATE SKIP LOCKED
        )
        RETURNING id, to_email AS "toEmail", subject, template, payload_json AS "payloadJson", attempts`;
      for (const r of rows) await this.send(r);
    } catch (e) {
      this.deps.log.error({ err: (e as Error).message }, 'falha no envio de e-mails');
    } finally {
      this.running = false;
    }
  }

  private async send(r: Pick<EmailOutbox, 'id' | 'toEmail' | 'subject' | 'template' | 'payloadJson' | 'attempts'>) {
    const db = this.deps.db;
    if (!this.deps.mailer.configured) {
      await db.emailOutbox.update({ where: { id: r.id }, data: { lastError: 'E-mail: integração não configurada', status: r.attempts >= 6 ? 'FAILED' : 'PENDING' } });
      return;
    }
    try {
      const payload = (r.payloadJson ?? {}) as Record<string, string>;
      const content = r.template === 'custom' ? { subject: r.subject, text: payload.text ?? '' } : emailTemplate(r.template, payload);
      await this.deps.mailer.send({ to: r.toEmail, subject: content.subject, text: content.text });
      await db.emailOutbox.update({ where: { id: r.id }, data: { status: 'SENT', sentAt: new Date(), lastError: null } });
    } catch (e) {
      await db.emailOutbox.update({
        where: { id: r.id },
        data: { status: r.attempts >= 6 ? 'FAILED' : 'PENDING', lastError: (e as Error).message.slice(0, 480) },
      });
    }
  }
}
