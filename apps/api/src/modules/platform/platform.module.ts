import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { paginationSchema, platformPlanSchema, platformSettingSchema, platformTenantStatusSchema } from '@ordemcerta/shared';
import { z } from 'zod';
import { PlatformOnly } from '../../core/decorators';
import { Doc, ZBody, ZQuery } from '../../core/zod';
import { PlatformService } from './platform.service';

const tenantQuery = paginationSchema.extend({ search: z.string().trim().max(100).optional(), status: z.enum(['PENDING_PAYMENT', 'ACTIVE', 'SUSPENDED', 'CANCELED']).optional() });
const statusQuery = paginationSchema.extend({ status: z.string().max(40).optional() });
const auditQuery = paginationSchema.extend({ tenantId: z.string().uuid().optional(), action: z.string().max(80).optional() });
const reviewSchema = z.object({ approve: z.boolean(), notes: z.string().trim().min(5).max(2000) });

@ApiTags('platform')
@ApiBearerAuth()
@PlatformOnly()
@Controller('platform')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('metrics')
  @Doc('MRR, empresas, inadimplência, churn, consumo, jobs e integrações')
  metrics() {
    return this.platform.metrics();
  }

  @Get('plans')
  @Doc('Planos com histórico de preços')
  plans() {
    return this.platform.plans();
  }

  @Post('plans')
  @Doc('Cria plano (decisão comercial explícita)', { body: platformPlanSchema })
  createPlan(@ZBody(platformPlanSchema) body: z.infer<typeof platformPlanSchema>) {
    return this.platform.createPlan(body);
  }

  @Patch('plans/:id')
  @Doc('Atualiza plano; mudança de preço gera nova versão sem afetar assinaturas existentes', { body: platformPlanSchema.partial() })
  updatePlan(@Param('id', ParseUUIDPipe) id: string, @ZBody(platformPlanSchema.partial()) body: Partial<z.infer<typeof platformPlanSchema>>) {
    return this.platform.updatePlan(id, body);
  }

  @Get('tenants')
  @Doc('Empresas', { query: tenantQuery })
  tenants(@ZQuery(tenantQuery) q: z.infer<typeof tenantQuery>) {
    return this.platform.tenants(q);
  }

  @Get('tenants/:id')
  @Doc('Resumo da empresa (sem dados operacionais de clientes)')
  tenant(@Param('id', ParseUUIDPipe) id: string) {
    return this.platform.tenant(id);
  }

  @Patch('tenants/:id/status')
  @Doc('Ativa/suspende manualmente (auditado)', { body: platformTenantStatusSchema })
  setStatus(@Param('id', ParseUUIDPipe) id: string, @ZBody(platformTenantStatusSchema) body: z.infer<typeof platformTenantStatusSchema>) {
    return this.platform.setTenantStatus(id, body);
  }

  @Get('subscriptions')
  @Doc('Assinaturas', { query: statusQuery })
  subscriptions(@ZQuery(statusQuery) q: z.infer<typeof statusQuery>) {
    return this.platform.subscriptionsList(q);
  }

  @Get('invoices')
  @Doc('Faturas da plataforma', { query: statusQuery })
  invoices(@ZQuery(statusQuery) q: z.infer<typeof statusQuery>) {
    return this.platform.invoicesList(q);
  }

  @Get('billing-events')
  @Doc('Eventos de webhook do Mercado Pago', { query: statusQuery })
  events(@ZQuery(statusQuery) q: z.infer<typeof statusQuery>) {
    return this.platform.billingEvents(q);
  }

  @Post('billing-events/:id/reprocess')
  @HttpCode(200)
  @Doc('Reprocessa evento (idempotente, auditado)')
  reprocess(@Param('id', ParseUUIDPipe) id: string) {
    return this.platform.reprocessEvent(id);
  }

  @Get('reconciliation')
  @Doc('Pendências de reconciliação (sem correspondência, divergência de valor, duplicidade, estornos)')
  reconciliation() {
    return this.platform.reconciliationIssues();
  }

  @Post('reconciliation/run')
  @HttpCode(200)
  @Doc('Executa reconciliação agora')
  runReconciliation() {
    return this.platform.runReconciliation();
  }

  @Get('audit')
  @Doc('Auditoria da plataforma e de acessos de suporte', { query: auditQuery })
  audit(@ZQuery(auditQuery) q: z.infer<typeof auditQuery>) {
    return this.platform.auditTrail(q);
  }

  @Get('jobs')
  @Doc('Filas, jobs com erro (DLQ)')
  jobs() {
    return this.platform.jobs();
  }

  @Post('jobs/:queue/:id/retry')
  @HttpCode(200)
  @Doc('Reprocessa job com erro')
  retry(@Param('queue') queue: string, @Param('id') id: string) {
    return this.platform.retryJob(queue, id);
  }

  @Get('settings')
  @Doc('Políticas da plataforma (tolerância de inadimplência)')
  settings() {
    return this.platform.getSettings();
  }

  @Put('settings')
  @Doc('Atualiza políticas', { body: platformSettingSchema })
  putSettings(@Body() raw: unknown) {
    return this.platform.putSettings(platformSettingSchema.parse(raw));
  }

  @Get('messaging/billing-reviews')
  @Doc('Canais WhatsApp aguardando validação de faturamento próprio')
  reviews() {
    return this.platform.billingReviews();
  }

  @Post('messaging/channels/:id/billing-review')
  @HttpCode(200)
  @Doc('Aprova/rejeita faturamento próprio da WABA (auditado)', { body: reviewSchema })
  decide(@Param('id', ParseUUIDPipe) id: string, @ZBody(reviewSchema) body: z.infer<typeof reviewSchema>) {
    return this.platform.decideBillingReview(id, body.approve, body.notes);
  }
}

@Module({ controllers: [PlatformController], providers: [PlatformService] })
export class PlatformModule {}
