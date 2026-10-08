import { Inject, Injectable } from '@nestjs/common';
import type { FileType, ServiceOrder } from '@prisma/client';
import { MIME_EXT, sha256Hex, sniffMime, type Tx } from '@ordemcerta/server';
import { ErrorCode } from '@ordemcerta/shared';
import { randomUUID } from 'node:crypto';
import { assertBranch, auth, currentTenantId } from '../../core/context';
import { TenantDb } from '../../core/database';
import { ENV, type AppEnv } from '../../core/env.provider';
import { DomainError, Errors } from '../../core/errors';
import { AuditService, QueueService, StorageService } from '../../core/services';

export interface UploadedFile {
  buffer: Buffer;
  size: number;
  originalname: string;
}

/**
 * Anexos privados da OS: validação MIME por magic bytes, limite de tamanho,
 * varredura antivírus assíncrona e URLs assinadas de curta duração.
 */
@Injectable()
export class OrderFilesService {
  constructor(
    private readonly db: TenantDb,
    private readonly storage: StorageService,
    private readonly queues: QueueService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: AppEnv,
  ) {}

  private key(tenantId: string, orderId: string, ext: string) {
    return `tenants/${tenantId}/orders/${orderId}/${randomUUID()}.${ext}`;
  }

  async storeSignature(tx: Tx, order: ServiceOrder, dataUrl: string) {
    const buf = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
    if (sniffMime(buf) !== 'image/png' || buf.length > 400_000) throw new DomainError(ErrorCode.FILE_REJECTED, 'Assinatura inválida', 422);
    const storage = this.storage.require();
    const key = this.key(order.tenantId, order.id, 'png');
    await storage.put(key, buf, 'image/png');
    return tx.serviceOrderFile.create({
      data: {
        tenantId: order.tenantId,
        orderId: order.id,
        storageKey: key,
        type: 'SIGNATURE',
        mime: 'image/png',
        sizeBytes: buf.length,
        checksum: sha256Hex(buf),
        scanStatus: 'NOT_SCANNED',
        uploadedBy: auth().userId,
      },
    });
  }

  upload(orderId: string, type: FileType, file: UploadedFile | undefined) {
    if (!file) throw new DomainError(ErrorCode.FILE_REJECTED, 'Arquivo ausente', 422);
    if (file.size > this.env.MAX_UPLOAD_MB * 1024 * 1024) throw new DomainError(ErrorCode.FILE_REJECTED, `Arquivo maior que ${this.env.MAX_UPLOAD_MB} MB`, 413);
    const mime = sniffMime(file.buffer);
    if (!mime) throw new DomainError(ErrorCode.FILE_REJECTED, 'Tipo de arquivo não permitido (JPEG, PNG, WEBP, HEIC ou PDF)', 415);
    if (type === 'SIGNATURE') throw new DomainError(ErrorCode.FILE_REJECTED, 'Use o fluxo de assinatura', 422);
    const storage = this.storage.require();
    return this.db.run(async (tx, hooks) => {
      const tenantId = currentTenantId();
      const order = await tx.serviceOrder.findFirst({ where: { id: orderId, tenantId } });
      if (!order) throw Errors.notFound('OS');
      assertBranch(order.branchId);
      const key = this.key(tenantId, orderId, MIME_EXT[mime]);
      await storage.put(key, file.buffer, mime);
      const scanning = Boolean(this.env.CLAMAV_HOST);
      const rec = await tx.serviceOrderFile.create({
        data: {
          tenantId,
          orderId,
          storageKey: key,
          type,
          mime,
          sizeBytes: file.size,
          checksum: sha256Hex(file.buffer),
          scanStatus: scanning ? 'PENDING' : 'NOT_SCANNED',
          uploadedBy: auth().userId,
        },
      });
      await tx.serviceOrderEvent.create({ data: { tenantId, orderId, actorId: auth().userId, eventType: 'file_uploaded', payloadJson: { fileId: rec.id, type } } });
      if (scanning) hooks.afterCommit(() => this.queues.add('files', 'scan', { fileId: rec.id, tenantId }));
      return rec;
    });
  }

  list(orderId: string) {
    return this.db.run(async (tx) => {
      const order = await tx.serviceOrder.findFirst({ where: { id: orderId, tenantId: currentTenantId() }, select: { branchId: true } });
      if (!order) throw Errors.notFound('OS');
      assertBranch(order.branchId);
      return tx.serviceOrderFile.findMany({ where: { tenantId: currentTenantId(), orderId, deletedAt: null }, orderBy: { createdAt: 'desc' } });
    });
  }

  /** URL assinada curta. Arquivos infectados ou em varredura não são liberados. */
  signedUrl(orderId: string, fileId: string) {
    return this.db.run(async (tx) => {
      const f = await tx.serviceOrderFile.findFirst({ where: { id: fileId, orderId, tenantId: currentTenantId(), deletedAt: null }, include: { order: { select: { branchId: true } } } });
      if (!f) throw Errors.notFound('Arquivo');
      assertBranch(f.order.branchId);
      if (f.scanStatus === 'INFECTED') throw new DomainError(ErrorCode.FILE_REJECTED, 'Arquivo bloqueado pela varredura antivírus', 403);
      if (f.scanStatus === 'PENDING') throw Errors.conflict('Arquivo em verificação antivírus; tente em instantes');
      const url = await this.storage.signedUrl(f.storageKey);
      await this.audit.log(tx, { action: 'file_url_issued', entity: 'service_order_file', entityId: f.id });
      return { url, expiresInSeconds: this.env.SIGNED_URL_TTL_SECONDS, scanStatus: f.scanStatus, mime: f.mime };
    });
  }

  remove(orderId: string, fileId: string) {
    return this.db.run(async (tx) => {
      const f = await tx.serviceOrderFile.findFirst({ where: { id: fileId, orderId, tenantId: currentTenantId(), deletedAt: null }, include: { order: { select: { branchId: true } } } });
      if (!f) throw Errors.notFound('Arquivo');
      assertBranch(f.order.branchId);
      if (f.type === 'SIGNATURE') throw Errors.forbidden('Assinaturas são evidências e não podem ser removidas');
      await tx.serviceOrderFile.update({ where: { id: fileId }, data: { deletedAt: new Date() } });
      await tx.serviceOrderEvent.create({ data: { tenantId: f.tenantId, orderId, actorId: auth().userId, eventType: 'file_removed', payloadJson: { fileId } } });
    });
  }

  async readForPdf(storageKey: string): Promise<Buffer | null> {
    try {
      return await this.storage.require().get(storageKey);
    } catch {
      return null;
    }
  }
}
