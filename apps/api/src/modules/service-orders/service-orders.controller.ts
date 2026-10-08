import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import {
  assignSchema,
  cancelSchema,
  checklistSchema,
  completeRepairSchema,
  createServiceOrderSchema,
  deliverSchema,
  fileUploadMetaSchema,
  intakeSignatureSchema,
  noteSchema,
  reopenSchema,
  serviceOrderQuerySchema,
  submitDiagnosisSchema,
  transitionSchema,
  updateServiceOrderSchema,
  versionSchema,
} from '@ordemcerta/shared';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import { Idempotent, Operational, Perm } from '../../core/decorators';
import { Doc, ZBody, ZQuery } from '../../core/zod';
import { OrderDocumentsService } from './order-documents.service';
import { OrderFilesService, type UploadedFile as UploadedFileT } from './order-files.service';
import { ServiceOrdersService } from './service-orders.service';

const reasonSchema = z.object({ reason: z.string().trim().min(5).max(300) });
const queueQuery = z.object({ branchId: z.string().uuid().optional(), mine: z.coerce.boolean().optional() });

@ApiTags('service-orders')
@ApiBearerAuth()
@Controller('service-orders')
export class ServiceOrdersController {
  constructor(
    private readonly orders: ServiceOrdersService,
    private readonly files: OrderFilesService,
    private readonly docs: OrderDocumentsService,
  ) {}

  @Get()
  @Perm('os:view')
  @Doc('Consulta de OS (número, cliente, telefone, IMEI parcial, modelo, técnico, período, status)', { query: serviceOrderQuerySchema })
  list(@ZQuery(serviceOrderQuerySchema) q: z.infer<typeof serviceOrderQuerySchema>) {
    return this.orders.list(q);
  }

  @Get('queue')
  @Perm('os:view')
  @Doc('Fila técnica por prioridade e SLA', { query: queueQuery })
  queue(@ZQuery(queueQuery) q: z.infer<typeof queueQuery>) {
    return this.orders.queue(q.branchId, q.mine);
  }

  @Post()
  @Perm('os:create')
  @Operational()
  @Idempotent()
  @Doc('Abre OS (recepção). Retorna token de acompanhamento uma única vez.', { body: createServiceOrderSchema })
  create(@ZBody(createServiceOrderSchema) body: z.infer<typeof createServiceOrderSchema>) {
    return this.orders.create(body);
  }

  @Get(':id')
  @Perm('os:view')
  @Doc('Detalhe completo da OS')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(id);
  }

  @Patch(':id')
  @Perm('os:update')
  @Operational()
  @Doc('Atualiza prioridade/previsão/defeito (controle de versão)', { body: updateServiceOrderSchema })
  update(@Param('id', ParseUUIDPipe) id: string, @ZBody(updateServiceOrderSchema) body: z.infer<typeof updateServiceOrderSchema>) {
    return this.orders.update(id, body);
  }

  @Get(':id/history')
  @Perm('os:view')
  @Doc('Histórico cronológico de transições e autores')
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.history(id);
  }

  @Post(':id/assign')
  @Perm('os:assign')
  @Operational()
  @HttpCode(200)
  @Doc('Atribui técnico', { body: assignSchema })
  assign(@Param('id', ParseUUIDPipe) id: string, @ZBody(assignSchema) body: z.infer<typeof assignSchema>) {
    return this.orders.assign(id, body);
  }

  @Post(':id/accept')
  @Perm('os:accept')
  @Operational()
  @HttpCode(200)
  @Doc('Técnico aceita a OS', { body: versionSchema })
  accept(@Param('id', ParseUUIDPipe) id: string, @ZBody(versionSchema) body: z.infer<typeof versionSchema>) {
    return this.orders.accept(id, body.version);
  }

  @Post(':id/start-diagnosis')
  @Perm('os:diagnose')
  @Operational()
  @HttpCode(200)
  @Doc('Inicia diagnóstico', { body: transitionSchema })
  startDiagnosis(@Param('id', ParseUUIDPipe) id: string, @ZBody(transitionSchema) body: z.infer<typeof transitionSchema>) {
    return this.orders.startDiagnosis(id, body);
  }

  @Post(':id/submit-diagnosis')
  @Perm('os:diagnose')
  @Operational()
  @HttpCode(200)
  @Doc('Registra laudo e envia para aprovação (ou pré-aprovado conforme política)', { body: submitDiagnosisSchema })
  submitDiagnosis(@Param('id', ParseUUIDPipe) id: string, @ZBody(submitDiagnosisSchema) body: z.infer<typeof submitDiagnosisSchema>) {
    return this.orders.submitDiagnosis(id, body);
  }

  @Post(':id/request-parts')
  @Perm('os:repair')
  @Operational()
  @HttpCode(200)
  @Doc('Aguardando peças', { body: transitionSchema })
  requestParts(@Param('id', ParseUUIDPipe) id: string, @ZBody(transitionSchema) body: z.infer<typeof transitionSchema>) {
    return this.orders.requestParts(id, body);
  }

  @Post(':id/parts-arrived')
  @Perm('os:repair')
  @Operational()
  @HttpCode(200)
  @Doc('Peças disponíveis (volta para aprovada)', { body: transitionSchema })
  partsArrived(@Param('id', ParseUUIDPipe) id: string, @ZBody(transitionSchema) body: z.infer<typeof transitionSchema>) {
    return this.orders.partsArrived(id, body);
  }

  @Post(':id/start-repair')
  @Perm('os:repair')
  @Operational()
  @HttpCode(200)
  @Doc('Inicia reparo (exige aprovação quando requerida)', { body: transitionSchema })
  startRepair(@Param('id', ParseUUIDPipe) id: string, @ZBody(transitionSchema) body: z.infer<typeof transitionSchema>) {
    return this.orders.startRepair(id, body);
  }

  @Post(':id/start-testing')
  @Perm('os:repair')
  @Operational()
  @HttpCode(200)
  @Doc('Inicia testes pós-reparo', { body: transitionSchema })
  startTesting(@Param('id', ParseUUIDPipe) id: string, @ZBody(transitionSchema) body: z.infer<typeof transitionSchema>) {
    return this.orders.startTesting(id, body);
  }

  @Post(':id/complete-repair')
  @Perm('os:repair')
  @Operational()
  @HttpCode(200)
  @Doc('Conclui reparo com checklist final obrigatório', { body: completeRepairSchema })
  complete(@Param('id', ParseUUIDPipe) id: string, @ZBody(completeRepairSchema) body: z.infer<typeof completeRepairSchema>) {
    return this.orders.completeRepair(id, body);
  }

  @Post(':id/return-unrepaired')
  @Perm('os:view')
  @Operational()
  @HttpCode(200)
  @Doc('Devolução sem reparo (com motivo)', { body: cancelSchema })
  returnUnrepaired(@Param('id', ParseUUIDPipe) id: string, @ZBody(cancelSchema) body: z.infer<typeof cancelSchema>) {
    return this.orders.returnUnrepaired(id, body);
  }

  @Post(':id/deliver')
  @Perm('os:deliver')
  @Operational()
  @Idempotent()
  @HttpCode(200)
  @Doc('Entrega/retirada com recibo e assinatura', { body: deliverSchema })
  deliver(@Param('id', ParseUUIDPipe) id: string, @ZBody(deliverSchema) body: z.infer<typeof deliverSchema>) {
    return this.orders.deliver(id, body);
  }

  @Post(':id/cancel')
  @Perm('os:cancel')
  @Operational()
  @HttpCode(200)
  @Doc('Cancela (OS nunca é apagada)', { body: cancelSchema })
  cancel(@Param('id', ParseUUIDPipe) id: string, @ZBody(cancelSchema) body: z.infer<typeof cancelSchema>) {
    return this.orders.cancel(id, body);
  }

  @Post(':id/reopen')
  @Perm('os:reopen')
  @Operational()
  @HttpCode(200)
  @Doc('Reabertura auditada', { body: reopenSchema })
  reopen(@Param('id', ParseUUIDPipe) id: string, @ZBody(reopenSchema) body: z.infer<typeof reopenSchema>) {
    return this.orders.reopen(id, body);
  }

  @Post(':id/intake-signature')
  @Perm('os:create')
  @Operational()
  @Doc('Assinatura de aceite da ficha de entrada (hash do termo + evidências)', { body: intakeSignatureSchema })
  signIntake(@Param('id', ParseUUIDPipe) id: string, @ZBody(intakeSignatureSchema) body: z.infer<typeof intakeSignatureSchema>) {
    return this.orders.signIntake(id, body);
  }

  @Post(':id/tracking-token')
  @Perm('os:update')
  @HttpCode(200)
  @Doc('Reemite link de acompanhamento (revoga o anterior)')
  reissueToken(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.reissueTrackingToken(id);
  }

  @Post(':id/unlock-secret')
  @Perm('os:unlock_secret')
  @HttpCode(200)
  @Doc('Exibe senha de desbloqueio com justificativa (auditado)', { body: reasonSchema })
  unlockSecret(@Param('id', ParseUUIDPipe) id: string, @ZBody(reasonSchema) body: z.infer<typeof reasonSchema>) {
    return this.orders.revealUnlockSecret(id, body.reason);
  }

  @Post(':id/notes')
  @Perm('os:view')
  @Doc('Adiciona nota (interna ou visível ao cliente)', { body: noteSchema })
  note(@Param('id', ParseUUIDPipe) id: string, @ZBody(noteSchema) body: z.infer<typeof noteSchema>) {
    return this.orders.addNote(id, body);
  }

  @Post(':id/checklists')
  @Perm('os:diagnose')
  @Doc('Registra checklist (entrada/pós-reparo)', { body: checklistSchema })
  checklist(@Param('id', ParseUUIDPipe) id: string, @ZBody(checklistSchema) body: z.infer<typeof checklistSchema>) {
    return this.orders.addChecklist(id, body);
  }

  @Get(':id/files')
  @Perm('os:view')
  @Doc('Lista anexos')
  listFiles(@Param('id', ParseUUIDPipe) id: string) {
    return this.files.list(id);
  }

  @Post(':id/files')
  @Perm('os:files')
  @Operational()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 1 } }))
  @Doc('Envia foto/documento (validação MIME real, tamanho, antivírus)')
  upload(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: UploadedFileT | undefined, @Body() body: unknown) {
    return this.files.upload(id, fileUploadMetaSchema.parse(body).type, file);
  }

  @Get(':id/files/:fileId/url')
  @Perm('os:view')
  @Doc('URL assinada de curta duração')
  fileUrl(@Param('id', ParseUUIDPipe) id: string, @Param('fileId', ParseUUIDPipe) fileId: string) {
    return this.files.signedUrl(id, fileId);
  }

  @Delete(':id/files/:fileId')
  @Perm('os:files')
  @HttpCode(204)
  @Doc('Remove anexo (exclusão lógica)')
  async removeFile(@Param('id', ParseUUIDPipe) id: string, @Param('fileId', ParseUUIDPipe) fileId: string) {
    await this.files.remove(id, fileId);
  }

  /** Token de acompanhamento opcional via header (nunca em URL). */
  @Get(':id/pdf')
  @Perm('os:view')
  @Doc('Ficha (intake) ou recibo de retirada (pickup) em A4 ou térmico')
  async pdf(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('type') type: string | undefined,
    @Query('format') format: string | undefined,
    @Headers('x-tracking-token') trackingToken: string | undefined,
    @Res() res: Response,
  ) {
    const doc = await this.docs.orderPdf(id, type === 'pickup' ? 'pickup' : 'intake', format === 'THERMAL' ? 'THERMAL' : 'A4', trackingToken);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${doc.filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(doc.buffer);
  }
}
