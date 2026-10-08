import { Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { cancelSaleSchema, confirmSaleSchema, createSaleSchema, refundSaleSchema } from '@ordemcerta/shared';
import type { Response } from 'express';
import type { z } from 'zod';
import { Idempotent, Operational, Perm } from '../../core/decorators';
import { Doc, ZBody, ZQuery } from '../../core/zod';
import { saleQuerySchema, SalesService } from './sales.service';

@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get()
  @Perm('sales:view')
  @Doc('Vendas', { query: saleQuerySchema })
  list(@ZQuery(saleQuerySchema) q: z.infer<typeof saleQuerySchema>) {
    return this.sales.list(q);
  }

  @Post()
  @Perm('sales:create')
  @Operational()
  @Idempotent()
  @Doc('Cria venda (rascunho) com itens e descontos autorizados', { body: createSaleSchema })
  create(@ZBody(createSaleSchema) body: z.infer<typeof createSaleSchema>) {
    return this.sales.create(body);
  }

  @Get(':id')
  @Perm('sales:view')
  @Doc('Detalhe da venda com pagamentos')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.sales.get(id);
  }

  @Post(':id/confirm')
  @Perm('sales:create')
  @Operational()
  @Idempotent()
  @HttpCode(200)
  @Doc('Confirma venda: baixa estoque, registra pagamentos (único/misto) e caixa', { body: confirmSaleSchema })
  confirm(@Param('id', ParseUUIDPipe) id: string, @ZBody(confirmSaleSchema) body: z.infer<typeof confirmSaleSchema>, @Headers('idempotency-key') key: string) {
    return this.sales.confirm(id, body, key);
  }

  @Post(':id/cancel')
  @Perm('sales:cancel')
  @HttpCode(200)
  @Doc('Cancela venda em rascunho', { body: cancelSaleSchema })
  cancel(@Param('id', ParseUUIDPipe) id: string, @ZBody(cancelSaleSchema) body: z.infer<typeof cancelSaleSchema>) {
    return this.sales.cancel(id, body.reason);
  }

  @Post(':id/refund')
  @Perm('sales:refund')
  @Operational()
  @Idempotent()
  @HttpCode(200)
  @Doc('Estorno/devolução de itens', { body: refundSaleSchema })
  refund(@Param('id', ParseUUIDPipe) id: string, @ZBody(refundSaleSchema) body: z.infer<typeof refundSaleSchema>) {
    return this.sales.refund(id, body);
  }

  @Get(':id/receipt')
  @Perm('sales:view')
  @Doc('Comprovante NÃO FISCAL (PDF térmico ou A4)')
  async receipt(@Param('id', ParseUUIDPipe) id: string, @Query('format') format: string | undefined, @Res() res: Response) {
    const buf = await this.sales.receipt(id, format === 'A4' ? 'A4' : 'THERMAL');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="comprovante-${id}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buf);
  }
}
