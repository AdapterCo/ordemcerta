import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  paginationSchema,
  stockAdjustSchema,
  stockConsumeSchema,
  stockQuerySchema,
  stockReceiveSchema,
  stockReleaseSchema,
  stockReserveSchema,
  stockTransferReceiveSchema,
  stockTransferSchema,
} from '@ordemcerta/shared';
import { z } from 'zod';
import { Idempotent, Operational, Perm } from '../../core/decorators';
import { Doc, ZBody, ZQuery } from '../../core/zod';
import { inventorySchema, StockService } from './stock.service';

const movementQuery = paginationSchema.extend({ branchId: z.string().uuid().optional(), productId: z.string().uuid().optional() });
const transferQuery = paginationSchema.extend({ status: z.enum(['IN_TRANSIT', 'RECEIVED', 'RECEIVED_WITH_DIFF', 'CANCELED']).optional() });

@ApiTags('stock')
@ApiBearerAuth()
@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get('balances')
  @Perm('stock:view')
  @Doc('Saldos por filial/local (disponível = físico - reservado)', { query: stockQuerySchema })
  balances(@ZQuery(stockQuerySchema) q: z.infer<typeof stockQuerySchema>) {
    return this.stock.balances(q);
  }

  @Get('movements')
  @Perm('stock:view')
  @Doc('Movimentações imutáveis', { query: movementQuery })
  movements(@ZQuery(movementQuery) q: z.infer<typeof movementQuery>) {
    return this.stock.movements(q);
  }

  @Get('alerts')
  @Perm('stock:view')
  @Doc('Itens abaixo do estoque mínimo')
  alerts(@Query('branchId') branchId?: string) {
    return this.stock.alerts(branchId && /^[0-9a-f-]{36}$/i.test(branchId) ? branchId : undefined);
  }

  @Post('receive')
  @Perm('stock:receive')
  @Operational()
  @Idempotent()
  @Doc('Entrada de mercadoria (custo médio)', { body: stockReceiveSchema })
  receive(@ZBody(stockReceiveSchema) body: z.infer<typeof stockReceiveSchema>) {
    return this.stock.receive(body);
  }

  @Post('adjust')
  @Perm('stock:adjust')
  @Operational()
  @Idempotent()
  @Doc('Ajuste/perda/devolução (negativo exige override auditado)', { body: stockAdjustSchema })
  adjust(@ZBody(stockAdjustSchema) body: z.infer<typeof stockAdjustSchema>) {
    return this.stock.adjust(body);
  }

  @Post('inventory')
  @Perm('stock:adjust')
  @Operational()
  @Idempotent()
  @Doc('Inventário com reconciliação', { body: inventorySchema })
  inventory(@ZBody(inventorySchema) body: z.infer<typeof inventorySchema>) {
    return this.stock.inventory(body);
  }

  @Post('reserve')
  @Perm('stock:reserve')
  @Operational()
  @Idempotent()
  @Doc('Reserva peça para OS', { body: stockReserveSchema })
  reserve(@ZBody(stockReserveSchema) body: z.infer<typeof stockReserveSchema>) {
    return this.stock.reserve(body);
  }

  @Post('consume')
  @Perm('stock:reserve')
  @Operational()
  @Idempotent()
  @HttpCode(200)
  @Doc('Baixa (consumo efetivo) de peça reservada', { body: stockConsumeSchema })
  consume(@ZBody(stockConsumeSchema) body: z.infer<typeof stockConsumeSchema>) {
    return this.stock.consume(body);
  }

  @Post('release')
  @Perm('stock:reserve')
  @Operational()
  @Idempotent()
  @HttpCode(200)
  @Doc('Libera reserva', { body: stockReleaseSchema })
  release(@ZBody(stockReleaseSchema) body: z.infer<typeof stockReleaseSchema>) {
    return this.stock.release(body);
  }

  @Get('transfers')
  @Perm('stock:view')
  @Doc('Transferências entre filiais', { query: transferQuery })
  transfers(@ZQuery(transferQuery) q: z.infer<typeof transferQuery>) {
    return this.stock.listTransfers(q);
  }

  @Post('transfers')
  @Perm('stock:transfer')
  @Operational()
  @Idempotent()
  @Doc('Envia transferência (sai da origem, fica em trânsito)', { body: stockTransferSchema })
  createTransfer(@ZBody(stockTransferSchema) body: z.infer<typeof stockTransferSchema>) {
    return this.stock.createTransfer(body);
  }

  @Post('transfers/:id/receive')
  @Perm('stock:transfer')
  @Operational()
  @Idempotent()
  @HttpCode(200)
  @Doc('Confirma recebimento com diferenças', { body: stockTransferReceiveSchema })
  receiveTransfer(@Param('id', ParseUUIDPipe) id: string, @ZBody(stockTransferReceiveSchema) body: z.infer<typeof stockTransferReceiveSchema>) {
    return this.stock.receiveTransfer(id, body);
  }
}
