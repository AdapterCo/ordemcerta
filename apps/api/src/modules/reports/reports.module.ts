import { Controller, Get, Injectable, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { FINANCIAL_REPORTS, REPORTS } from '@ordemcerta/server';
import { reportExportSchema, reportQuerySchema, type ReportType } from '@ordemcerta/shared';
import type { z } from 'zod';
import { assertBranch, assertCan, auth, currentTenantId } from '../../core/context';
import { TenantDb } from '../../core/database';
import { Perm } from '../../core/decorators';
import { Errors } from '../../core/errors';
import { AuditService, QueueService, StorageService } from '../../core/services';
import { Doc, ZBody, ZQuery } from '../../core/zod';

@Injectable()
export class ReportsService {
  constructor(
    private readonly db: TenantDb,
    private readonly queues: QueueService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  filters(q: z.infer<typeof reportQuerySchema>) {
    if (q.to <= q.from) throw Errors.validation('Período inválido');
    if (q.to.getTime() - q.from.getTime() > 400 * 86_400_000) throw Errors.validation('Período máximo de 400 dias');
    if (q.branchId) assertBranch(q.branchId);
    const a = auth();
    return {
      tenantId: currentTenantId(),
      branchIds: q.branchId ? [q.branchId] : a.allBranches ? null : a.branchIds,
      from: q.from,
      to: q.to,
      technicianId: q.technicianId,
      attendantId: q.attendantId,
    };
  }

  run(type: ReportType, q: z.infer<typeof reportQuerySchema>) {
    if (FINANCIAL_REPORTS.includes(type)) assertCan('reports:financial');
    const f = this.filters(q);
    return this.db.run((tx) => REPORTS[type](tx, f), { timeout: 60_000 });
  }

  createExport(input: z.infer<typeof reportExportSchema>) {
    if (FINANCIAL_REPORTS.includes(input.reportType)) assertCan('reports:financial');
    this.storage.require();
    const f = this.filters(input.params);
    return this.db.run(async (tx, hooks) => {
      const e = await tx.reportExport.create({
        data: {
          tenantId: f.tenantId,
          requestedBy: auth().userId,
          reportType: input.reportType,
          format: input.format,
          paramsJson: { ...f, from: f.from.toISOString(), to: f.to.toISOString() } as Prisma.InputJsonValue,
        },
      });
      await this.audit.log(tx, { action: 'report_export_requested', entity: 'report_export', entityId: e.id, metadata: { type: input.reportType, format: input.format } });
      hooks.afterCommit(() => this.queues.add('exports', 'build', { exportId: e.id, tenantId: f.tenantId }));
      return e;
    });
  }

  getExport(id: string) {
    return this.db.run(async (tx) => {
      const e = await tx.reportExport.findFirst({ where: { id, tenantId: currentTenantId(), requestedBy: auth().userId } });
      if (!e) throw Errors.notFound('Exportação');
      const url = e.status === 'DONE' && e.storageKey && (!e.expiresAt || e.expiresAt > new Date()) ? await this.storage.signedUrl(e.storageKey, `relatorio-${e.reportType}.${e.format.toLowerCase()}`) : null;
      return { ...e, url };
    });
  }

  listExports() {
    return this.db.run((tx) => tx.reportExport.findMany({ where: { tenantId: currentTenantId(), requestedBy: auth().userId }, orderBy: { createdAt: 'desc' }, take: 30 }));
  }
}

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('overview')
  @Perm('reports:view')
  @Doc('KPIs: OS, faturamento (competência), recebimentos, CMV, margem estimada', { query: reportQuerySchema })
  overview(@ZQuery(reportQuerySchema) q: z.infer<typeof reportQuerySchema>) {
    return this.reports.run('overview', q);
  }

  @Get('service-orders')
  @Perm('reports:view')
  @Doc('OS por status, tempo de execução, SLA, retornos', { query: reportQuerySchema })
  serviceOrders(@ZQuery(reportQuerySchema) q: z.infer<typeof reportQuerySchema>) {
    return this.reports.run('service-orders', q);
  }

  @Get('technicians')
  @Perm('reports:view')
  @Doc('Produtividade por técnico', { query: reportQuerySchema })
  technicians(@ZQuery(reportQuerySchema) q: z.infer<typeof reportQuerySchema>) {
    return this.reports.run('technicians', q);
  }

  @Get('sales')
  @Perm('reports:view')
  @Doc('Vendas, descontos, recebimentos por meio, CMV e margem', { query: reportQuerySchema })
  sales(@ZQuery(reportQuerySchema) q: z.infer<typeof reportQuerySchema>) {
    return this.reports.run('sales', q);
  }

  @Get('stock')
  @Perm('reports:view')
  @Doc('Estoque, valor a custo e peças usadas', { query: reportQuerySchema })
  stock(@ZQuery(reportQuerySchema) q: z.infer<typeof reportQuerySchema>) {
    return this.reports.run('stock', q);
  }

  @Get('cash')
  @Perm('reports:view')
  @Doc('Caixa: sessões, sangrias, suprimentos, diferenças', { query: reportQuerySchema })
  cash(@ZQuery(reportQuerySchema) q: z.infer<typeof reportQuerySchema>) {
    return this.reports.run('cash', q);
  }

  @Get('warranties')
  @Perm('reports:view')
  @Doc('Garantias e taxa de retorno', { query: reportQuerySchema })
  warranties(@ZQuery(reportQuerySchema) q: z.infer<typeof reportQuerySchema>) {
    return this.reports.run('warranties', q);
  }

  @Get('exports')
  @Perm('reports:export')
  @Doc('Minhas exportações')
  exports() {
    return this.reports.listExports();
  }

  @Post('exports')
  @Perm('reports:export')
  @Doc('Solicita exportação CSV/PDF assíncrona', { body: reportExportSchema })
  createExport(@ZBody(reportExportSchema) body: z.infer<typeof reportExportSchema>) {
    return this.reports.createExport(body);
  }

  @Get('exports/:id')
  @Perm('reports:export')
  @Doc('Status da exportação e URL assinada quando pronta')
  getExport(@Param('id', ParseUUIDPipe) id: string) {
    return this.reports.getExport(id);
  }
}

@Module({ controllers: [ReportsController], providers: [ReportsService], exports: [ReportsService] })
export class ReportsModule {}
