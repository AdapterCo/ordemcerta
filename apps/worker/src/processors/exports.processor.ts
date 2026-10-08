import { Injectable, OnModuleInit } from '@nestjs/common';
import { buildTablePdf, methodLabel, REPORTS, toCsv, type ExportJob, type ReportFilters } from '@ordemcerta/server';
import { formatBRL, type ReportType } from '@ordemcerta/shared';
import type { Job } from 'bullmq';
import { Deps, isLastAttempt } from '../deps';

const MONEY_KEYS = /cents|revenue|receipts|refunds|cogs|margin|total|discount|value|received_|supplies|withdrawals|difference/i;

/** Exportações CSV/PDF assíncronas, escopadas ao tenant e às filiais do solicitante. */
@Injectable()
export class ExportsProcessor implements OnModuleInit {
  constructor(private readonly deps: Deps) {}

  onModuleInit() {
    this.deps.startWorker<ExportJob>('exports', (job) => this.build(job), { concurrency: 2 });
  }

  async build(job: Job<ExportJob>) {
    const { db, storage } = this.deps;
    const e = await db.reportExport.findFirst({ where: { id: job.data.exportId, tenantId: job.data.tenantId } });
    if (!e || e.status === 'DONE') return;
    if (!storage) {
      await db.reportExport.update({ where: { id: e.id }, data: { status: 'FAILED', error: 'Armazenamento: integração não configurada' } });
      return;
    }
    await db.reportExport.update({ where: { id: e.id }, data: { status: 'PROCESSING' } });
    try {
      const p = e.paramsJson as unknown as Omit<ReportFilters, 'from' | 'to'> & { from: string; to: string };
      // Escopo SEMPRE do registro (tenant do solicitante), nunca de entrada externa.
      const filters: ReportFilters = { ...p, tenantId: e.tenantId, from: new Date(p.from), to: new Date(p.to) };
      const result = await db.$transaction((tx) => REPORTS[e.reportType as ReportType](tx, filters), { timeout: 120_000 });
      let body: Buffer;
      let contentType: string;
      if (e.format === 'CSV') {
        body = Buffer.from(toCsv(result), 'utf8');
        contentType = 'text/csv';
      } else {
        const summary = Object.entries(result.summary)
          .map(([k, v]) => `${k.startsWith('receipts_') || k.startsWith('received_') ? `${k.split('_')[0]} ${methodLabel(k.split('_')[1] ?? '')}` : k}: ${typeof v === 'number' && MONEY_KEYS.test(k) ? formatBRL(v) : v}`)
          .join(' · ');
        const pdf = await buildTablePdf(result.title, `${filters.from.toISOString().slice(0, 10)} a ${filters.to.toISOString().slice(0, 10)} — ${summary}`, result.columns, result.rows);
        body = pdf.buffer;
        contentType = 'application/pdf';
      }
      const key = `tenants/${e.tenantId}/exports/${e.id}.${e.format.toLowerCase()}`;
      await storage.put(key, body, contentType);
      await db.reportExport.update({
        where: { id: e.id },
        data: { status: 'DONE', storageKey: key, completedAt: new Date(), expiresAt: new Date(Date.now() + 7 * 86_400_000), error: null },
      });
    } catch (err) {
      if (isLastAttempt(job)) await db.reportExport.update({ where: { id: e.id }, data: { status: 'FAILED', error: (err as Error).message.slice(0, 480) } });
      throw err;
    }
  }
}
