import { Queue, type ConnectionOptions } from 'bullmq';

/** Filas BullMQ. Workers em apps/worker; produtores na API e no próprio worker. */
export const QUEUES = {
  outbox: 'outbox',
  messaging: 'messaging',
  email: 'email',
  files: 'files',
  exports: 'exports',
  billing: 'billing',
  maintenance: 'maintenance',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface MessagingJob {
  deliveryId: string;
  tenantId: string;
}
export interface EmailJob {
  emailId: string;
}
export interface FileScanJob {
  fileId: string;
  tenantId: string;
}
export interface ExportJob {
  exportId: string;
  tenantId: string;
}
export type BillingJob =
  | { kind: 'webhook'; eventId: string }
  | { kind: 'sync-payment'; providerPaymentId: string }
  | { kind: 'reconcile' }
  | { kind: 'renewals' }
  | { kind: 'dunning' }
  | { kind: 'plan-sync'; planChangeId: string };

export function redisConnection(url: string): ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname && u.pathname !== '/' ? Number(u.pathname.slice(1)) : undefined,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

export const DEFAULT_JOB_OPTIONS = {
  attempts: 8,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 7 * 86400, count: 10_000 },
  // Falhas definitivas ficam retidas (DLQ) para inspeção e reprocessamento no painel.
  removeOnFail: false,
};

export function createQueue(name: QueueName, connection: ConnectionOptions) {
  return new Queue(name, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
}

/** Sala Socket.IO por filial (rooms `tenant:<id>:branch:<id>`). */
export function branchRoom(tenantId: string, branchId: string) {
  return `tenant:${tenantId}:branch:${branchId}`;
}
export function tenantRoom(tenantId: string) {
  return `tenant:${tenantId}`;
}
