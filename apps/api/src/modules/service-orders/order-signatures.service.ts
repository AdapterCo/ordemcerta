import { Inject, Injectable } from '@nestjs/common';
import type { ServiceOrder, TermType } from '@prisma/client';
import { isPng, MAX_SIGNATURE_BYTES, randomToken, sha256Hex, type Tx } from '@ordemcerta/server';
import { ErrorCode } from '@ordemcerta/shared';
import { assertBranch, assertCan, auth, currentTenantId } from '../../core/context';
import { TenantDb } from '../../core/database';
import { ENV, type AppEnv } from '../../core/env.provider';
import { DomainError, Errors } from '../../core/errors';
import { signatureLink } from './order-helpers';

/** Validade do QR code/link de assinatura no celular do cliente. */
const CAPTURE_TTL_MS = 15 * 60_000;

/**
 * Assinatura do cliente (entrada/retirada). Sem storage de objetos: o PNG é validado
 * pelos magic bytes, limitado em tamanho e gravado no próprio banco (append-only).
 * Pode ser desenhada na tela da loja ou no celular do próprio cliente (QR code).
 */
@Injectable()
export class OrderSignaturesService {
  constructor(
    private readonly db: TenantDb,
    @Inject(ENV) private readonly env: AppEnv,
  ) {}

  async store(tx: Tx, order: Pick<ServiceOrder, 'id' | 'tenantId'>, dataUrl: string) {
    return this.storeBuffer(tx, order, Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'));
  }

  async storeBuffer(tx: Tx, order: Pick<ServiceOrder, 'id' | 'tenantId'>, buf: Buffer) {
    if (!isPng(buf) || buf.length > MAX_SIGNATURE_BYTES) throw new DomainError(ErrorCode.FILE_REJECTED, 'Assinatura inválida', 422);
    return tx.serviceOrderFile.create({
      data: {
        tenantId: order.tenantId,
        orderId: order.id,
        mime: 'image/png',
        sizeBytes: buf.length,
        checksum: sha256Hex(buf),
        content: new Uint8Array(buf),
        uploadedBy: auth().userId,
      },
      select: { id: true },
    });
  }

  async read(tx: Tx, tenantId: string, id: string): Promise<Buffer | null> {
    const f = await tx.serviceOrderFile.findFirst({ where: { id, tenantId }, select: { content: true } });
    return f ? Buffer.from(f.content) : null;
  }

  /* -------------------------------------------- assinatura no celular do cliente */

  /** Gera QR code/link de uso único (token só em hash, 15 min) para o cliente assinar no celular. */
  createCapture(orderId: string, purpose: Extract<TermType, 'INTAKE' | 'PICKUP'>) {
    assertCan(purpose === 'INTAKE' ? 'os:create' : 'os:deliver');
    return this.db.run(async (tx) => {
      const tenantId = currentTenantId();
      const o = await tx.serviceOrder.findFirst({ where: { id: orderId, tenantId }, select: { id: true, branchId: true, deliveryStatus: true } });
      if (!o) throw Errors.notFound('OS');
      assertBranch(o.branchId);
      if (purpose === 'PICKUP' && o.deliveryStatus !== 'READY_FOR_PICKUP') throw Errors.precondition('A OS não está disponível para retirada');
      const token = randomToken(32);
      const expiresAt = new Date(Date.now() + CAPTURE_TTL_MS);
      const c = await tx.signatureCapture.create({
        data: { tenantId, orderId: o.id, purpose, tokenHash: sha256Hex(token), expiresAt, createdBy: auth().userId },
      });
      return { captureId: c.id, url: signatureLink(this.env.APP_URL, token), expiresAt };
    });
  }

  /** Andamento da coleta (consultado pela tela da loja até o cliente assinar). */
  captureStatus(orderId: string, captureId: string) {
    return this.db.run(async (tx) => {
      const c = await tx.signatureCapture.findFirst({ where: { id: captureId, orderId, tenantId: currentTenantId() }, include: { order: { select: { branchId: true } } } });
      if (!c) throw Errors.notFound('Coleta de assinatura');
      assertBranch(c.order.branchId);
      const status = c.consumedAt ? 'USED' : c.capturedAt ? 'CAPTURED' : c.expiresAt < new Date() ? 'EXPIRED' : 'PENDING';
      return {
        status,
        signerName: c.signerName,
        expiresAt: c.expiresAt,
        previewPng: c.content && status === 'CAPTURED' ? `data:image/png;base64,${Buffer.from(c.content).toString('base64')}` : null,
      };
    });
  }

  /** Usa a assinatura coletada no celular (uma única vez) para o termo de entrada/retirada. */
  async consumeCapture(tx: Tx, order: Pick<ServiceOrder, 'id' | 'tenantId'>, captureId: string, purpose: Extract<TermType, 'INTAKE' | 'PICKUP'>) {
    const c = await tx.signatureCapture.findFirst({ where: { id: captureId, tenantId: order.tenantId, orderId: order.id, purpose } });
    if (!c || !c.capturedAt || !c.content || !c.signerName) throw Errors.precondition('A assinatura do celular ainda não foi recebida');
    const used = await tx.signatureCapture.updateMany({ where: { id: c.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (!used.count) throw Errors.conflict('Esta assinatura já foi utilizada');
    return { buf: Buffer.from(c.content), signerName: c.signerName };
  }
}
