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

    const expired = await db.quote.updateMany({ where: { status: 'SENT', expiresAt: { lt: now } }, data: { status: 'EXPIRED' } });
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
    log.info({ quotesExpired: expired.count, unlockSecretsPurged: purged.count, exportsExpired: oldExports.count }, 'manutenção concluída');
  }
}
