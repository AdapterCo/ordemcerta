import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { FinanceModule } from '../finance/finance.module';
import { OperationsModule } from '../operations.module';
import { OrderDocumentsService } from './order-documents.service';
import { OrderFilesService } from './order-files.service';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';
import { ServiceOrdersController } from './service-orders.controller';
import { ServiceOrdersService } from './service-orders.service';

@Module({
  imports: [CustomersModule, FinanceModule, OperationsModule],
  controllers: [ServiceOrdersController, QuotesController],
  providers: [ServiceOrdersService, QuotesService, OrderFilesService, OrderDocumentsService],
  exports: [ServiceOrdersService, QuotesService, OrderFilesService, OrderDocumentsService],
})
export class ServiceOrdersModule {}
