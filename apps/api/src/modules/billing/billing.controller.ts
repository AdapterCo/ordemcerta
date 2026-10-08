import { Body, Controller, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { changePlanSchema, checkoutPixSchema, signupSchema } from '@ordemcerta/shared';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { Perm, Public } from '../../core/decorators';
import { ENV, type AppEnv } from '../../core/env.provider';
import { Doc, ZBody } from '../../core/zod';
import { setAuthCookies } from '../auth/cookies';
import { BillingService } from './billing.service';

/** Rotas de billing não usam @Operational: precisam funcionar justamente quando a conta está suspensa. */
@ApiTags('billing')
@Controller()
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    @Inject(ENV) private readonly env: AppEnv,
  ) {}

  @Public()
  @Get('billing/plans')
  @Doc('Planos oficiais (preços e limites vindos do banco)')
  plans() {
    return this.billing.plans();
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('billing/signup')
  @Doc('Cadastro da empresa + responsável + aceite (empresa nasce PENDING_PAYMENT)', { body: signupSchema })
  async signup(@ZBody(signupSchema) body: z.infer<typeof signupSchema>, @Res({ passthrough: true }) res: Response) {
    const r = await this.billing.signup(body);
    const csrfToken = setAuthCookies(res, this.env, r.session.refreshToken);
    return { resumed: r.resumed, tenantId: r.tenantId, paymentMode: r.paymentMode, accessToken: r.session.accessToken, expiresIn: r.session.expiresIn, csrfToken };
  }

  @ApiBearerAuth()
  @Get('billing/subscription')
  @Perm('billing:view')
  @Doc('Plano, situação, período, uso por filial e mudanças pendentes')
  subscription() {
    return this.billing.subscription();
  }

  @ApiBearerAuth()
  @Get('billing/invoices')
  @Perm('billing:view')
  @Doc('Faturas da assinatura')
  invoices() {
    return this.billing.invoices();
  }

  @ApiBearerAuth()
  @Get('billing/invoices/:id')
  @Perm('billing:view')
  @Doc('Fatura com cobrança Pix ativa (QR/copia-e-cola)')
  invoice(@Param('id', ParseUUIDPipe) id: string) {
    return this.billing.invoice(id);
  }

  @ApiBearerAuth()
  @Get('billing/invoices/:id/receipt')
  @Perm('billing:view')
  @Doc('Recibo de assinatura (não fiscal)')
  async receipt(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const buf = await this.billing.receipt(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="recibo-assinatura-${id}.pdf"`);
    res.send(buf);
  }

  @ApiBearerAuth()
  @Get('billing/payment-methods')
  @Perm('billing:view')
  @Doc('Formas de pagamento disponíveis')
  methods() {
    return this.billing.paymentMethods();
  }

  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('billing/checkout/card')
  @Perm('billing:manage')
  @HttpCode(200)
  @Doc('Inicia assinatura de cartão recorrente (checkout oficial Mercado Pago)')
  card() {
    return this.billing.checkoutCard();
  }

  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('billing/checkout/pix')
  @Perm('billing:manage')
  @HttpCode(200)
  @Doc('Gera/reutiliza cobrança Pix da fatura em aberto (uma ativa por fatura)', { body: checkoutPixSchema })
  pix(@ZBody(checkoutPixSchema) body: z.infer<typeof checkoutPixSchema>) {
    return this.billing.checkoutPix(body.invoiceId);
  }

  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('billing/invoices/:id/pix')
  @Perm('billing:manage')
  @HttpCode(200)
  @Doc('Gera Pix para fatura específica')
  invoicePix(@Param('id', ParseUUIDPipe) id: string) {
    return this.billing.checkoutPix(id);
  }

  @ApiBearerAuth()
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post('billing/invoices/:id/check')
  @Perm('billing:view')
  @HttpCode(200)
  @Doc('Consultar pagamento na API oficial')
  check(@Param('id', ParseUUIDPipe) id: string) {
    return this.billing.checkInvoice(id);
  }

  @ApiBearerAuth()
  @Get('billing/subscription/change-plan/preview')
  @Perm('billing:manage')
  @Doc('Prévia de upgrade/downgrade com valor proporcional e bloqueios')
  preview(@Query('planCode') planCode: string) {
    return this.billing.previewChange(changePlanSchema.parse({ planCode }).planCode);
  }

  @ApiBearerAuth()
  @Post('billing/subscription/change-plan')
  @Perm('billing:manage')
  @HttpCode(200)
  @Doc('Upgrade (cobra diferença proporcional) ou downgrade (agenda na renovação)', { body: changePlanSchema })
  changePlan(@ZBody(changePlanSchema) body: z.infer<typeof changePlanSchema>) {
    return this.billing.changePlan(body.planCode);
  }

  @ApiBearerAuth()
  @Post('billing/plan-changes/:id/cancel')
  @Perm('billing:manage')
  @HttpCode(200)
  @Doc('Cancela upgrade pendente ou downgrade agendado')
  async cancelChange(@Param('id', ParseUUIDPipe) id: string) {
    await this.billing.cancelChange(id);
    return { ok: true };
  }

  @ApiBearerAuth()
  @Post('billing/subscription/cancel')
  @Perm('billing:manage')
  @HttpCode(200)
  @Doc('Cancela ao fim do período pago')
  cancel() {
    return this.billing.cancel();
  }

  @ApiBearerAuth()
  @Post('billing/subscription/reactivate')
  @Perm('billing:manage')
  @HttpCode(200)
  @Doc('Reativa antes do fim do período')
  reactivate() {
    return this.billing.reactivate();
  }

  @Public()
  @SkipThrottle()
  @ApiExcludeEndpoint()
  @Post('webhooks/mercadopago')
  @HttpCode(200)
  webhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-signature') xSignature: string | undefined,
    @Headers('x-request-id') xRequestId: string | undefined,
    @Query() query: Record<string, string>,
    @Body() body: Record<string, unknown>,
  ) {
    return this.billing.receiveWebhook({ xSignature, xRequestId, query, body, raw: req.rawBody });
  }
}
