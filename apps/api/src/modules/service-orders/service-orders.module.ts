import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { FinanceModule } from '../finance/finance.module';
import { OperationsModule } from '../operations.module';
import { OrderDocumentsService } from './order-documents.service';
import { OrderPartsService } from './order-parts.service';
import { OrderSignaturesService } from './order-signatures.service';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';
import { ServiceOrdersController } from './service-orders.controller';
import { ServiceOrdersService } from './service-orders.service';

@Module({
  imports: [CustomersModule, FinanceModule, OperationsModule],
  controllers: [ServiceOrdersController, QuotesController],
  providers: [ServiceOrdersService, QuotesService, OrderSignaturesService, OrderDocumentsService, OrderPartsService],
  exports: [ServiceOrdersService, QuotesService, OrderSignaturesService, OrderDocumentsService],
})
export class ServiceOrdersModule {}
