import { Module } from '@nestjs/common';
import { CashService } from './cash.service';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';

@Module({
  controllers: [FinanceController],
  providers: [FinanceService, CashService],
  exports: [FinanceService, CashService],
})
export class FinanceModule {}
