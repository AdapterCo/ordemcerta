import { Controller, Get, Headers, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { publicLookupSchema, publicOtpRequestSchema, publicQuoteDecisionSchema, publicSignatureSubmitSchema, publicTokenSchema } from '@ordemcerta/shared';
import type { z } from 'zod';
import { Public } from '../../core/decorators';
import { Doc, ZBody } from '../../core/zod';
import { PublicService } from './public.service';

/** Portal público OrdemCerta. Token sempre no corpo/cabeçalho, nunca na URL. */
@ApiTags('public')
@Public()
@Throttle({ default: { limit: 30, ttl: 60_000 } })
@Controller('public')
export class PublicController {
  constructor(private readonly portal: PublicService) {}

  @Post('status/lookup')
  @HttpCode(200)
  @Doc('Consulta por número da OS + código do comprovante', { body: publicLookupSchema })
  lookup(@ZBody(publicLookupSchema) body: z.infer<typeof publicLookupSchema>) {
    return this.portal.view(body.token, body.orderNumber);
  }

  @Get('status/orders/:numero')
  @Doc('Consulta com token no cabeçalho X-Tracking-Token')
  byNumber(@Param('numero', ParseIntPipe) numero: number, @Headers('x-tracking-token') token: string) {
    return this.portal.view(token, numero);
  }

  @Get('status/timeline')
  @Doc('Linha do tempo pública (token no cabeçalho X-Tracking-Token)')
  timeline(@Headers('x-tracking-token') token: string) {
    return this.portal.timeline(token);
  }

  @Post('quote/view')
  @HttpCode(200)
  @Doc('Abre orçamento pelo link de uso limitado', { body: publicTokenSchema })
  quoteView(@ZBody(publicTokenSchema) body: z.infer<typeof publicTokenSchema>) {
    return this.portal.view(body.token);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('status/otp/request')
  @HttpCode(200)
  @Doc('Solicita OTP para decidir o orçamento', { body: publicOtpRequestSchema })
  otp(@ZBody(publicOtpRequestSchema) body: z.infer<typeof publicOtpRequestSchema>) {
    return this.portal.requestOtp(body.token, body.quoteId);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('status/quotes/:id/approve')
  @HttpCode(200)
  @Doc('Aprova orçamento (versão exata, texto de aceite, OTP quando exigido)', { body: publicQuoteDecisionSchema })
  approve(@Param('id', ParseUUIDPipe) id: string, @ZBody(publicQuoteDecisionSchema) body: z.infer<typeof publicQuoteDecisionSchema>) {
    return this.portal.decide(body.token, id, 'approve', body);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('status/quotes/:id/reject')
  @HttpCode(200)
  @Doc('Recusa orçamento', { body: publicQuoteDecisionSchema })
  reject(@Param('id', ParseUUIDPipe) id: string, @ZBody(publicQuoteDecisionSchema) body: z.infer<typeof publicQuoteDecisionSchema>) {
    return this.portal.decide(body.token, id, 'reject', body);
  }

  @Post('signature/view')
  @HttpCode(200)
  @Doc('Termo a assinar no celular do cliente (link de uso único do QR code)', { body: publicTokenSchema })
  signatureView(@ZBody(publicTokenSchema) body: z.infer<typeof publicTokenSchema>) {
    return this.portal.signatureView(body.token);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('signature/submit')
  @HttpCode(200)
  @Doc('Envia a assinatura desenhada no celular do cliente', { body: publicSignatureSubmitSchema })
  signatureSubmit(@ZBody(publicSignatureSubmitSchema) body: z.infer<typeof publicSignatureSubmitSchema>) {
    return this.portal.signatureSubmit(body);
  }
}
