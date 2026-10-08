import { Controller, Get, Injectable, Module, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DEFAULT_DOCUMENT_TEMPLATES, reportOverview } from '@ordemcerta/server';
import { DOCUMENT_TEMPLATE_TYPES, documentTemplateSchema, startOfZonedDay } from '@ordemcerta/shared';
import { z } from 'zod';
import { assertBranch, auth, branchScope, can, currentTenantId } from '../../core/context';
import { TenantDb } from '../../core/database';
import { Operational, Perm } from '../../core/decorators';
import { AuditService } from '../../core/services';
import { Doc, ZBody, ZQuery } from '../../core/zod';

const dashQuery = z.object({
  branchId: z.string().uuid().optional(),
  technicianId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

@Injectable()
export class DashboardService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
  ) {}

  dashboard(q: z.infer<typeof dashQuery>) {
    if (q.branchId) assertBranch(q.branchId);
    const a = auth();
    const to = q.to ?? new Date();
    const from = q.from ?? startOfZonedDay(new Date(to.getTime() - 29 * 86_400_000));
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      const overview = await reportOverview(tx, {
        tenantId,
        branchIds: q.branchId ? [q.branchId] : a.allBranches ? null : a.branchIds,
        from,
        to,
        technicianId: q.technicianId,
      });
      // Valores financeiros somente para quem pode vê-los.
      const summary = { ...overview.summary };
      if (!can('reports:financial')) {
        for (const k of ['serviceRevenue', 'salesRevenue', 'discounts', 'revenue', 'receipts', 'refunds', 'netReceipts', 'cogs', 'grossMargin', 'cashDifference', 'salesTotal', 'receivablesOpen']) delete summary[k];
      }
      const recent = await tx.serviceOrder.findMany({
        where: { tenantId, branchId: q.branchId ?? branchScope(), ...(q.technicianId ? { assignedTechnicianId: q.technicianId } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, number: true, technicalStatus: true, priority: true, createdAt: true, customer: { select: { name: true } }, device: { select: { brand: true, model: true } } },
      });
      return { period: { from, to }, kpis: summary, statusBreakdown: overview.rows, recent };
    });
  }

  templates() {
    return this.db.run(async (tx) => {
      const rows = await tx.documentTemplate.findMany({ where: { tenantId: currentTenantId() }, orderBy: [{ type: 'asc' }, { version: 'desc' }] });
      return DOCUMENT_TEMPLATE_TYPES.map((type) => {
        const versions = rows.filter((r) => r.type === type);
        const active = versions.find((v) => v.active);
        return { type, active: active ?? { version: 0, content: DEFAULT_DOCUMENT_TEMPLATES[type], isDefault: true }, versions };
      });
    });
  }

  /** Nova versão do modelo (anteriores preservadas para documentos já emitidos). */
  saveTemplate(input: z.infer<typeof documentTemplateSchema>) {
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      const last = await tx.documentTemplate.aggregate({ where: { tenantId, type: input.type }, _max: { version: true } });
      await tx.documentTemplate.updateMany({ where: { tenantId, type: input.type, active: true }, data: { active: false } });
      const t = await tx.documentTemplate.create({
        data: { tenantId, type: input.type, version: (last._max.version ?? 0) + 1, content: input.content, active: true, createdBy: auth().userId },
      });
      await this.audit.log(tx, { action: 'document_template_versioned', entity: 'document_template', entityId: t.id, metadata: { type: t.type, version: t.version } });
      return t;
    });
  }
}

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller()
export class DashboardController {
  constructor(private readonly dash: DashboardService) {}

  @Get('dashboard')
  @Doc('KPIs e OS recentes por filial/período/técnico', { query: dashQuery })
  dashboard(@ZQuery(dashQuery) q: z.infer<typeof dashQuery>) {
    return this.dash.dashboard(q);
  }

  @Get('document-templates')
  @Perm('documents:manage')
  @Doc('Modelos de documentos versionados (termos devem ser revisados juridicamente)')
  templates() {
    return this.dash.templates();
  }

  @Post('document-templates')
  @Perm('documents:manage')
  @Operational()
  @Doc('Publica nova versão de modelo', { body: documentTemplateSchema })
  save(@ZBody(documentTemplateSchema) body: z.infer<typeof documentTemplateSchema>) {
    return this.dash.saveTemplate(body);
  }
}

@Module({ controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
