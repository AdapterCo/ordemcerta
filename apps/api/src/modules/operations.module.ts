import { Module } from '@nestjs/common';
import { CatalogController } from './catalog/catalog.controller';
import { CatalogService } from './catalog/catalog.service';
import { FinanceModule } from './finance/finance.module';
import { SalesController } from './sales/sales.controller';
import { SalesService } from './sales/sales.service';
import { StockController } from './stock/stock.controller';
import { StockService } from './stock/stock.service';

/** Catálogo, estoque e PDV. */
@Module({
  imports: [FinanceModule],
  controllers: [CatalogController, StockController, SalesController],
  providers: [CatalogService, StockService, SalesService],
  exports: [StockService, CatalogService],
})
export class OperationsModule {}
