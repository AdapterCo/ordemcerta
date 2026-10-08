import { Injectable, OnModuleInit } from '@nestjs/common';
import type { BillingJob } from '@ordemcerta/server';
import type { Job } from 'bullmq';
import { Deps } from '../deps';

/**
 * Billing da plataforma: processamento de webhooks (consulta à API oficial),
 * reconciliação periódica (cobre webhook ausente/fora de ordem), geração de
 * faturas de renovação e política de inadimplência (tolerância → suspensão).
 */
@Injectable()
export class BillingProcessor implements OnModuleInit {
  constructor(private readonly deps: Deps) {}

  async onModuleInit() {
    this.deps.startWorker<BillingJob>('billing', (job) => this.handle(job), { concurrency: 1 });
    const q = this.deps.queue('billing');
    try {
      await q.upsertJobScheduler('billing-reconcile', { every: 10 * 60_000 }, { name: 'reconcile', data: { kind: 'reconcile' } });
      await q.upsertJobScheduler('billing-renewals', { every: 60 * 60_000 }, { name: 'renewals', data: { kind: 'renewals' } });
      await q.upsertJobScheduler('billing-dunning', { every: 30 * 60_000 }, { name: 'dunning', data: { kind: 'dunning' } });
    } catch (e) {
      this.deps.log.error({ err: (e as Error).message }, 'falha ao registrar agendamentos de billing');
    }
  }

  async handle(job: Job<BillingJob>) {
    const { engine, log } = this.deps;
    const data = job.data;
    switch (data.kind) {
      case 'webhook':
        await engine.processWebhookEvent(data.eventId);
        return;
      case 'sync-payment':
        await engine.applyProviderPayment(await this.deps.mp.getPayment(data.providerPaymentId));
        return;
      case 'reconcile':
        log.info({ stats: await engine.reconcile() }, 'reconciliação de billing');
        return;
      case 'renewals':
        log.info({ created: await engine.generateRenewals() }, 'faturas de renovação');
        return;
      case 'dunning':
        log.info({ result: await engine.runDunning() }, 'política de inadimplência');
        return;
      case 'plan-sync':
        await engine.syncPlanChange(data.planChangeId);
        return;
    }
  }
}
