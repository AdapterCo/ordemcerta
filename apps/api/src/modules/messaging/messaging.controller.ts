import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import {
  billingVerificationSchema,
  completeOnboardingSchema,
  createChannelSchema,
  testMessageSchema,
  upsertTemplatesSchema,
} from '@ordemcerta/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { Operational, Perm, Public } from '../../core/decorators';
import { Doc, ZBody, ZQuery } from '../../core/zod';
import { deliveriesQuery, MessagingService } from './messaging.service';

@ApiTags('messaging')
@ApiBearerAuth()
@Controller()
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Get('messaging/channels')
  @Perm('messaging:view')
  @Doc('Canais de WhatsApp (tokens nunca expostos)')
  channels() {
    return this.messaging.listChannels();
  }

  @Post('messaging/channels')
  @Perm('messaging:manage')
  @Operational()
  @Doc('Cria canal (oficial por padrão)', { body: createChannelSchema })
  create(@ZBody(createChannelSchema) body: z.infer<typeof createChannelSchema>) {
    return this.messaging.createChannel(body);
  }

  @Get('messaging/channels/:id/status')
  @Perm('messaging:view')
  @Doc('Status e checklist de prontidão')
  status(@Param('id', ParseUUIDPipe) id: string) {
    return this.messaging.status(id);
  }

  @Post('messaging/channels/:id/onboarding/start')
  @Perm('messaging:manage')
  @Operational()
  @HttpCode(200)
  @Doc('Inicia onboarding (Embedded Signup quando habilitado, senão conexão assistida)')
  start(@Param('id', ParseUUIDPipe) id: string) {
    return this.messaging.startOnboarding(id);
  }

  @Post('messaging/channels/:id/onboarding/complete')
  @Perm('messaging:manage')
  @Operational()
  @HttpCode(200)
  @Doc('Conclui conexão oficial (valida número↔WABA, inscreve webhooks)', { body: completeOnboardingSchema })
  complete(@Param('id', ParseUUIDPipe) id: string, @ZBody(completeOnboardingSchema) body: z.infer<typeof completeOnboardingSchema>) {
    return this.messaging.completeOnboarding(id, body);
  }

  @Post('messaging/channels/:id/connect')
  @Perm('messaging:manage')
  @Operational()
  @HttpCode(200)
  @Doc('Reconecta/revalida credenciais armazenadas')
  connect(@Param('id', ParseUUIDPipe) id: string) {
    return this.messaging.connect(id);
  }

  @Post('messaging/channels/:id/disconnect')
  @Perm('messaging:manage')
  @HttpCode(200)
  @Doc('Desconecta (bloqueia envios imediatamente)')
  disconnect(@Param('id', ParseUUIDPipe) id: string) {
    return this.messaging.disconnect(id);
  }

  @Get('messaging/channels/:id/billing-status')
  @Perm('messaging:view')
  @Doc('Status do faturamento próprio e histórico de verificações')
  billing(@Param('id', ParseUUIDPipe) id: string) {
    return this.messaging.billingStatus(id);
  }

  @Post('messaging/channels/:id/billing-verification')
  @Perm('messaging:manage')
  @HttpCode(200)
  @Doc('Envia evidência de faturamento próprio da WABA (revisão auditada)', { body: billingVerificationSchema })
  billingVerification(@Param('id', ParseUUIDPipe) id: string, @ZBody(billingVerificationSchema) body: z.infer<typeof billingVerificationSchema>) {
    return this.messaging.submitBillingVerification(id, body);
  }

  @Get('messaging/templates')
  @Perm('messaging:view')
  @Doc('Templates por evento')
  templates() {
    return this.messaging.listTemplates();
  }

  @Put('messaging/templates')
  @Perm('messaging:manage')
  @Doc('Cria/atualiza templates (variáveis permitidas; alteração exige nova aprovação Meta)', { body: upsertTemplatesSchema })
  upsertTemplates(@ZBody(upsertTemplatesSchema) body: z.infer<typeof upsertTemplatesSchema>) {
    return this.messaging.upsertTemplates(body);
  }

  @Post('messaging/channels/:id/templates/sync')
  @Perm('messaging:manage')
  @HttpCode(200)
  @Doc('Sincroniza status de aprovação dos templates com a WABA')
  sync(@Param('id', ParseUUIDPipe) id: string) {
    return this.messaging.syncTemplates(id);
  }

  @Get('messaging/deliveries')
  @Perm('messaging:view')
  @Doc('Logs de envio (destinatário mascarado)', { query: deliveriesQuery })
  deliveries(@ZQuery(deliveriesQuery) q: z.infer<typeof deliveriesQuery>) {
    return this.messaging.deliveries(q);
  }

  @Post('messaging/test')
  @Perm('messaging:manage')
  @Operational()
  @Doc('Envia mensagem de teste real', { body: testMessageSchema })
  test(@ZBody(testMessageSchema) body: z.infer<typeof testMessageSchema>) {
    return this.messaging.test(body);
  }

  @Public()
  @SkipThrottle()
  @ApiExcludeEndpoint()
  @Get('webhooks/whatsapp')
  verify(@Query('hub.mode') mode?: string, @Query('hub.verify_token') token?: string, @Query('hub.challenge') challenge?: string) {
    return this.messaging.verifyChallenge(mode, token, challenge);
  }

  @Public()
  @SkipThrottle()
  @ApiExcludeEndpoint()
  @Post('webhooks/whatsapp')
  @HttpCode(200)
  async webhook(@Req() req: Request & { rawBody?: Buffer }, @Headers('x-hub-signature-256') signature: string | undefined, @Body() body: unknown) {
    await this.messaging.handleWebhook(req.rawBody, signature, body);
    return { ok: true };
  }
}
