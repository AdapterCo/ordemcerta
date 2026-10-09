/**
 * Sem armazenamento de objetos (MinIO/S3): o sistema não guarda fotos nem anexos.
 * A única imagem persistida é a assinatura do cliente (PNG pequeno), gravada no banco.
 */

/** Tamanho máximo da assinatura (PNG) gravada no banco. */
export const MAX_SIGNATURE_BYTES = 400_000;

/** Verifica pelos magic bytes (não confia no Content-Type do cliente) se o conteúdo é PNG. */
export function isPng(buf: Buffer): boolean {
  return buf.length >= 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}
