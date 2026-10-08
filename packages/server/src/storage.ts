import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Env } from './env';
import { hmacSha256Hex, safeEqual } from './crypto';

export class StorageNotConfiguredError extends Error {
  constructor() {
    super('Armazenamento de arquivos: integração não configurada');
  }
}

export interface StorageProvider {
  readonly driver: 's3' | 'local';
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** URL assinada de curta duração para download. */
  signedUrl(key: string, ttlSeconds: number, downloadName?: string): Promise<string>;
  healthy(): Promise<boolean>;
}

export class S3Storage implements StorageProvider {
  readonly driver = 's3' as const;
  private readonly client: S3Client;

  constructor(private readonly env: Env) {
    this.client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY! },
    });
  }

  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: this.env.S3_ENDPOINT ? undefined : 'AES256' }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }));
    const bytes = await res.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }));
  }

  async signedUrl(key: string, ttlSeconds: number, downloadName?: string) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.env.S3_BUCKET,
        Key: key,
        ResponseContentDisposition: downloadName ? `attachment; filename="${downloadName.replace(/[^\w.-]/g, '_')}"` : undefined,
      }),
      { expiresIn: ttlSeconds },
    );
  }

  async healthy() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.env.S3_BUCKET }));
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Armazenamento local — SOMENTE desenvolvimento (bloqueado em produção pela
 * validação de env). URLs assinadas com HMAC servidas pela API em
 * /api/v1/files/local/:token.
 */
export class LocalStorage implements StorageProvider {
  readonly driver = 'local' as const;
  private readonly root: string;

  constructor(
    dir: string,
    private readonly signingKey: string,
    private readonly publicBaseUrl: string,
  ) {
    this.root = resolve(dir);
  }

  private path(key: string) {
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root)) throw new Error('Chave de armazenamento inválida');
    return p;
  }

  async put(key: string, body: Buffer) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
  }

  async get(key: string) {
    return readFile(this.path(key));
  }

  async delete(key: string) {
    await unlink(this.path(key)).catch(() => undefined);
  }

  async signedUrl(key: string, ttlSeconds: number) {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const payload = Buffer.from(JSON.stringify({ k: key, e: exp })).toString('base64url');
    const sig = hmacSha256Hex(this.signingKey, payload);
    return `${this.publicBaseUrl}/api/v1/files/local/${payload}.${sig}`;
  }

  verify(token: string): string | null {
    const [payload, sig] = token.split('.');
    if (!payload || !sig || !safeEqual(sig, hmacSha256Hex(this.signingKey, payload))) return null;
    const { k, e } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { k: string; e: number };
    if (e < Math.floor(Date.now() / 1000)) return null;
    return k;
  }

  async healthy() {
    return true;
  }
}

export function createStorage(env: Env): StorageProvider | null {
  if (env.STORAGE_DRIVER === 's3') return new S3Storage(env);
  if (env.STORAGE_DRIVER === 'local') return new LocalStorage(env.STORAGE_LOCAL_DIR, env.JWT_SECRET, env.APP_URL);
  return null;
}

/* ------------------------------------------------ validação de conteúdo */

export const ALLOWED_UPLOAD_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'] as const;
export type AllowedMime = (typeof ALLOWED_UPLOAD_MIME)[number];

/** Detecta o tipo real pelos magic bytes (não confia no Content-Type do cliente). */
export function sniffMime(buf: Buffer): AllowedMime | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buf.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('ascii');
    if (['heic', 'heix', 'mif1', 'msf1', 'heim', 'heis'].includes(brand)) return 'image/heic';
  }
  if (buf.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  return null;
}

export const MIME_EXT: Record<AllowedMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
};
