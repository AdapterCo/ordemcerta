import { Injectable, OnModuleInit } from '@nestjs/common';
import type { FileScanJob } from '@ordemcerta/server';
import type { Job } from 'bullmq';
import { Deps, isLastAttempt } from '../deps';

/** Varredura antivírus (clamd) dos anexos. Infectado: bloqueado para download e removido do storage. */
@Injectable()
export class FilesProcessor implements OnModuleInit {
  constructor(private readonly deps: Deps) {}

  onModuleInit() {
    this.deps.startWorker<FileScanJob>('files', (job) => this.scan(job), { concurrency: 3 });
  }

  async scan(job: Job<FileScanJob>) {
    const { db, storage, scanner } = this.deps;
    const f = await db.serviceOrderFile.findFirst({ where: { id: job.data.fileId, tenantId: job.data.tenantId } });
    if (!f || f.scanStatus !== 'PENDING') return;
    if (!scanner || !storage) {
      await db.serviceOrderFile.update({ where: { id: f.id }, data: { scanStatus: 'NOT_SCANNED' } });
      return;
    }
    try {
      const buf = await storage.get(f.storageKey);
      const result = await scanner.scan(buf);
      if (result.status === 'INFECTED') {
        await storage.delete(f.storageKey);
        await db.serviceOrderFile.update({ where: { id: f.id }, data: { scanStatus: 'INFECTED', deletedAt: new Date() } });
        await db.auditLog.create({
          data: { tenantId: f.tenantId, actorType: 'SYSTEM', action: 'file_infected_quarantined', entity: 'service_order_file', entityId: f.id, metadataJson: { signature: result.signature } },
        });
      } else {
        await db.serviceOrderFile.update({ where: { id: f.id }, data: { scanStatus: 'CLEAN' } });
      }
    } catch (e) {
      if (isLastAttempt(job)) await db.serviceOrderFile.update({ where: { id: f.id }, data: { scanStatus: 'ERROR' } });
      throw e;
    }
  }
}
