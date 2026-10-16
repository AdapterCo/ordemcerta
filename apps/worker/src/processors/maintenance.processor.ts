import { Injectable, OnModuleInit } from '@nestjs/common';
import { Deps } from '../deps';

/**
 * Rotinas de manutenção: expiração de orçamentos, purga de senhas de
 * desbloqueio expiradas, limpeza de idempotência/outbox e expiração de exportações.
 */
@Injectable()
export class MaintenanceProcessor implements OnModuleInit {
  constructor(private readonly deps: Deps) {}

  async onModuleInit() {
    this.deps.startWorker('maintenance', () => this.run(), { concurrency: 1 });
    try {
      await this.deps.queue('maintenance').upsertJobScheduler('maintenance', { every: 15 * 60_000 }, { name: 'run', data: {} });
    } catch (e) {
      this.deps.log.error({ err: (e as Error).message }, 'falha ao agendar manutenção');
    }
  }

  async run() {
    const { db, log } = this.deps;
    const now = new Date();

    // Orçamento vencido sem resposta: registra no histórico da OS para a loja ver e refazer o orçamento
    const expiring = await db.quote.findMany({ where: { status: 'SENT', expiresAt: { lt: now } }, select: { id: true, tenantId: true, orderId: true, version: true } });
    const expired = await db.quote.updateMany({ where: { id: { in: expiring.map((q) => q.id) }, status: 'SENT' }, data: { status: 'EXPIRED' } });
    for (const q of expiring) {
      await db.serviceOrderEvent.create({
        data: { tenantId: q.tenantId, orderId: q.orderId, actorId: null, actorType: 'SYSTEM', eventType: 'quote_expired', payloadJson: { quoteId: q.id, version: q.version } },
      });
    }
    await db.quoteAccessToken.updateMany({ where: { revokedAt: null, expiresAt: { lt: now } }, data: { revokedAt: now } });

    const purged = await db.deviceUnlockSecret.updateMany({ where: { purgedAt: null, expiresAt: { lt: now } }, data: { secretEncrypted: null, purgedAt: now } });

    await db.idempotencyRecord.deleteMany({ where: { expiresAt: { lt: now } } });
    await db.notificationOutbox.deleteMany({ where: { status: 'DONE', processedAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } } });
    await db.publicOtp.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 86_400_000) } } });

    // Exportações expiradas: conteúdo apagado do banco
    const oldExports = await db.reportExport.updateMany({
      where: { status: 'DONE', expiresAt: { lt: now } },
      data: { status: 'FAILED', error: 'expirada', content: null, contentType: null },
    });
    // Credenciais e tokens vencidos (sem valor de auditoria: os eventos ficam em audit_logs)
    const day = 86_400_000;
    const sessions = await db.session.deleteMany({
      where: { OR: [{ expiresAt: { lt: new Date(now.getTime() - 7 * day) } }, { revokedAt: { lt: new Date(now.getTime() - 30 * day) } }] },
    });
    await db.passwordResetToken.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - day) } } });
    await db.emailVerificationToken.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - day) } } });

    // LGPD (minimização): a imagem da assinatura já foi copiada para o termo, ou o link expirou sem uso
    const signatures = await db.$executeRaw`
      UPDATE signature_captures SET content = NULL
      WHERE content IS NOT NULL AND (consumed_at IS NOT NULL OR expires_at < ${new Date(now.getTime() - day)})`;

    // Webhooks recusados gravados por versões anteriores (hoje não são mais persistidos)
    await db.billingWebhookEvent.deleteMany({ where: { status: 'IGNORED', receivedAt: { lt: new Date(now.getTime() - 30 * day) } } });

    log.info(
      { quotesExpired: expired.count, unlockSecretsPurged: purged.count, exportsExpired: oldExports.count, sessionsPurged: sessions.count, signaturesCleared: signatures },
      'manutenção concluída',
    );
  }
}
