import { Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  BillingEngine,
  createLogger,
  createMailer,
  createPrisma,
  createQueue,
  EncryptionService,
  loadEnv,
  MercadoPagoGateway,
  redisConnection,
  WhatsAppCloudProvider,
  type Env,
  type QueueName,
} from '@ordemcerta/server';
import type { PrismaClient } from '@prisma/client';
import { Queue, Worker, type Job, type Processor, type WorkerOptions } from 'bullmq';

/**
 * Dependências do worker. Usa o papel de SISTEMA (BYPASSRLS) com escopo de
 * tenant explícito em todas as consultas.
 */
@Injectable()
export class Deps implements OnModuleDestroy {
  readonly env: Env = loadEnv();
  readonly log = createLogger(this.env.LOG_LEVEL, 'worker');
  readonly db: PrismaClient = createPrisma(this.env.DATABASE_SYSTEM_URL);
  readonly crypto = new EncryptionService(this.env.ENCRYPTION_KEY, this.env.ENCRYPTION_KEY_ID, this.env.ENCRYPTION_KEYS_PREVIOUS);
  readonly mailer = createMailer(this.env, (m) => this.log.info(m));
  readonly mp = new MercadoPagoGateway(this.env.MP_ACCESS_TOKEN, this.env.MP_WEBHOOK_SECRET, this.env.MP_WEBHOOK_TOLERANCE_SECONDS);
  readonly engine = new BillingEngine(this.db, this.mp, this.crypto, { appUrl: this.env.APP_URL }, {
    info: (o: unknown, m?: string) => this.log.info(o as object, m),
    warn: (o: unknown, m?: string) => this.log.warn(o as object, m),
    error: (o: unknown, m?: string) => this.log.error(o as object, m),
  } as unknown as Console);
  readonly whatsapp = new WhatsAppCloudProvider(this.env.META_GRAPH_VERSION, this.env.META_APP_ID, this.env.META_APP_SECRET);
  readonly connection = redisConnection(this.env.REDIS_URL);

  private readonly queues = new Map<QueueName, Queue>();
  private readonly workers: Worker[] = [];

  queue(name: QueueName): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = createQueue(name, this.connection);
      this.queues.set(name, q);
    }
    return q;
  }

  /** Inicia um worker BullMQ com log de falhas (falhas definitivas ficam na DLQ). */
  startWorker<T>(name: QueueName, processor: Processor<T>, opts: Partial<WorkerOptions> = {}) {
    const w = new Worker<T>(name, processor, { connection: this.connection, concurrency: 5, ...opts });
    w.on('failed', (job: Job<T> | undefined, err: Error) => {
      this.log.warn({ queue: name, jobId: job?.id, attempts: job?.attemptsMade, err: err.message }, 'job falhou');
    });
    w.on('error', (err) => this.log.error({ queue: name, err: err.message }, 'erro no worker'));
    this.workers.push(w);
    return w;
  }

  async onModuleDestroy() {
    await Promise.all(this.workers.map((w) => w.close().catch(() => undefined)));
    await Promise.all([...this.queues.values()].map((q) => q.close().catch(() => undefined)));
    await this.db.$disconnect();
  }
}

/** Retorna true se o job atual é a última tentativa configurada. */
export function isLastAttempt(job: Job): boolean {
  return job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
}
