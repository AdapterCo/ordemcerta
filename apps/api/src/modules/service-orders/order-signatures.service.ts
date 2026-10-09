import { Injectable } from '@nestjs/common';
import type { ServiceOrder } from '@prisma/client';
import { isPng, MAX_SIGNATURE_BYTES, sha256Hex, type Tx } from '@ordemcerta/server';
import { ErrorCode } from '@ordemcerta/shared';
import { auth } from '../../core/context';
import { DomainError } from '../../core/errors';

/**
 * Assinatura do cliente (entrada/retirada). Sem storage de objetos: o PNG é validado
 * pelos magic bytes, limitado em tamanho e gravado no próprio banco (append-only).
 */
@Injectable()
export class OrderSignaturesService {
  async store(tx: Tx, order: ServiceOrder, dataUrl: string) {
    const buf = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
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
}
