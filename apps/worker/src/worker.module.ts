import { Module } from '@nestjs/common';
import { Deps } from './deps';
import { BillingProcessor } from './processors/billing.processor';
import { EmailProcessor } from './processors/email.processor';
import { ExportsProcessor } from './processors/exports.processor';
import { MaintenanceProcessor } from './processors/maintenance.processor';
import { MessagingProcessor } from './processors/messaging.processor';
import { OutboxProcessor } from './processors/outbox.processor';

@Module({
  providers: [Deps, OutboxProcessor, MessagingProcessor, EmailProcessor, ExportsProcessor, BillingProcessor, MaintenanceProcessor],
})
export class WorkerModule {}
