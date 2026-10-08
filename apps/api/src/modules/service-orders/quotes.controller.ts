import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createQuoteSchema, manualApproveQuoteSchema, rejectQuoteSchema } from '@ordemcerta/shared';
import type { Response } from 'express';
import type { z } from 'zod';
import { Operational, Perm } from '../../core/decorators';
import { Doc, ZBody } from '../../core/zod';
import { OrderDocumentsService } from './order-documents.service';
import { QuotesService } from './quotes.service';

@ApiTags('quotes')
@ApiBearerAuth()
@Controller()
export class QuotesController {
  constructor(
    private readonly quotes: QuotesService,
    private readonly docs: OrderDocumentsService,
  ) {}

  @Get('service-orders/:id/quotes')
  @Perm('os:view')
  @Doc('Versões de orçamento da OS')
  list(@Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.list(id);
  }

  @Post('service-orders/:id/quotes')
  @Perm('quote:create')
  @Operational()
  @Doc('Cria nova versão de orçamento', { body: createQuoteSchema })
  create(@Param('id', ParseUUIDPipe) id: string, @ZBody(createQuoteSchema) body: z.infer<typeof createQuoteSchema>) {
    return this.quotes.create(id, body);
  }

  @Get('quotes/:id')
  @Perm('os:view')
  @Doc('Detalhe do orçamento')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.get(id);
  }

  @Post('quotes/:id/send')
  @Perm('quote:send')
  @Operational()
  @HttpCode(200)
  @Doc('Envia orçamento (gera link opaco de uso limitado; notificação via outbox)')
  send(@Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.send(id);
  }

  @Post('quotes/:id/approve')
  @Perm('quote:approve_manual')
  @Operational()
  @HttpCode(200)
  @Doc('Aprovação presencial/telefone com evidência', { body: manualApproveQuoteSchema })
  approve(@Param('id', ParseUUIDPipe) id: string, @ZBody(manualApproveQuoteSchema) body: z.infer<typeof manualApproveQuoteSchema>) {
    return this.quotes.approveManual(id, body);
  }

  @Post('quotes/:id/reject')
  @Perm('quote:approve_manual')
  @Operational()
  @HttpCode(200)
  @Doc('Registra recusa do cliente', { body: rejectQuoteSchema })
  reject(@Param('id', ParseUUIDPipe) id: string, @ZBody(rejectQuoteSchema) body: z.infer<typeof rejectQuoteSchema>) {
    return this.quotes.reject(id, body.reason);
  }

  @Get('quotes/:id/pdf')
  @Perm('os:view')
  @Doc('PDF do orçamento')
  async pdf(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const doc = await this.docs.quotePdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${doc.filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(doc.buffer);
  }
}
