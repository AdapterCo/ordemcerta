import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingController } from './billing.controller';
import { BillingEngineProvider, BillingService } from './billing.service';

@Module({
  imports: [AuthModule],
  controllers: [BillingController],
  providers: [BillingService, BillingEngineProvider],
  exports: [BillingService, BillingEngineProvider],
})
export class BillingModule {}
