import { Injectable, OnModuleInit } from '@nestjs/common';
import { Deps } from '../deps';

/**
 * Rotinas de manutenção: expiração de orçamentos, purga de senhas de
 * desbloqueio expiradas, limpeza de idempotência/outbox, retenção de fotos
 * conforme política da empresa e expiração de exportações.
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
    const { db, storage, log } = this.deps;
    const now = new Date();

    const expired = await db.quote.updateMany({ where: { status: 'SENT', expiresAt: { lt: now } }, data: { status: 'EXPIRED' } });
    await db.quoteAccessToken.updateMany({ where: { revokedAt: null, expiresAt: { lt: now } }, data: { revokedAt: now } });

    const purged = await db.deviceUnlockSecret.updateMany({ where: { purgedAt: null, expiresAt: { lt: now } }, data: { secretEncrypted: null, purgedAt: now } });

    await db.idempotencyRecord.deleteMany({ where: { expiresAt: { lt: now } } });
    await db.notificationOutbox.deleteMany({ where: { status: 'DONE', processedAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } } });
    await db.publicOtp.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 86_400_000) } } });

    // Exportações expiradas
    const oldExports = await db.reportExport.findMany({ where: { status: 'DONE', expiresAt: { lt: now } }, take: 200 });
    for (const e of oldExports) {
      if (e.storageKey && storage) await storage.delete(e.storageKey).catch(() => undefined);
      await db.reportExport.update({ where: { id: e.id }, data: { status: 'FAILED', error: 'expirada', storageKey: null } });
    }

    // Retenção de fotos (política por empresa): somente fotos de OS entregues; assinaturas e documentos preservados.
    let removedPhotos = 0;
    if (storage) {
      const settings = await db.setting.findMany({ where: { key: 'privacy.photo_retention_days', scope: 'tenant' } });
      const tenants = await db.tenant.findMany({ where: { status: { not: 'PENDING_PAYMENT' } }, select: { id: true } });
      for (const t of tenants) {
        const days = Number(settings.find((s) => s.tenantId === t.id)?.valueJson ?? 730);
        const cutoff = new Date(now.getTime() - days * 86_400_000);
        const files = await db.serviceOrderFile.findMany({
          where: { tenantId: t.id, deletedAt: null, type: { in: ['PHOTO_INTAKE', 'PHOTO_DIAGNOSIS', 'PHOTO_REPAIR'] }, createdAt: { lt: cutoff }, order: { deliveryStatus: 'DELIVERED' } },
          take: 200,
        });
        for (const f of files) {
          await storage.delete(f.storageKey).catch(() => undefined);
          await db.serviceOrderFile.update({ where: { id: f.id }, data: { deletedAt: now } });
          removedPhotos++;
        }
      }
    }
    log.info({ quotesExpired: expired.count, unlockSecretsPurged: purged.count, removedPhotos }, 'manutenção concluída');
  }
}
