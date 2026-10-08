import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function hmacSha256Hex(key: string | Buffer, data: string | Buffer): string {
  return createHmac('sha256', key).update(data).digest('hex');
}

/** Token opaco aleatório (base64url). 32 bytes = 256 bits. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Código numérico (OTP) com distribuição uniforme. */
export function randomNumericCode(digits = 6): string {
  const max = 10 ** digits;
  let n: number;
  do {
    n = randomBytes(4).readUInt32BE(0);
  } while (n >= Math.floor(0xffffffff / max) * max);
  return String(n % max).padStart(digits, '0');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Criptografia de dados sensíveis em repouso (IMEI, serial, tokens de
 * integração, segredo de desbloqueio, payload Pix). AES-256-GCM com
 * identificador de chave para rotação: "<keyId>.<iv>.<tag>.<ciphertext>".
 */
export class EncryptionService {
  private readonly keys = new Map<string, Buffer>();
  private readonly hmacKey: Buffer;

  constructor(
    currentKeyBase64: string,
    private readonly currentKeyId = 'k1',
    previous?: string,
  ) {
    const key = Buffer.from(currentKeyBase64, 'base64');
    if (key.length !== 32) throw new Error('ENCRYPTION_KEY deve ter 32 bytes');
    this.keys.set(currentKeyId, key);
    for (const pair of (previous ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
      const [id, b64] = pair.split(':');
      if (id && b64) this.keys.set(id, Buffer.from(b64, 'base64'));
    }
    this.hmacKey = Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), Buffer.from('ordemcerta-hmac-v1'), 32));
  }

  encrypt(plain: string): string {
    const key = this.keys.get(this.currentKeyId)!;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [this.currentKeyId, iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
  }

  decrypt(payload: string): string {
    const [keyId, ivB64, tagB64, ctB64] = payload.split('.');
    const key = keyId ? this.keys.get(keyId) : undefined;
    if (!key || !ivB64 || !tagB64 || ctB64 === undefined) throw new Error('Payload criptografado inválido ou chave desconhecida');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64url')), decipher.final()]).toString('utf8');
  }

  encryptNullable(plain: string | null | undefined): string | null {
    return plain ? this.encrypt(plain) : null;
  }

  /** HMAC determinístico (busca exata de dados criptografados, ex.: IMEI). */
  blindIndex(value: string): string {
    return hmacSha256Hex(this.hmacKey, value.trim().toUpperCase());
  }

  /** Reconhece payloads de chave antiga (para job de recriptografia). */
  needsRotation(payload: string): boolean {
    return !payload.startsWith(`${this.currentKeyId}.`);
  }
}

/** Hash de IP para auditoria (minimizado; não reversível). */
export function hashIp(ip: string | undefined | null, salt: string): string | null {
  if (!ip) return null;
  return hmacSha256Hex(salt, ip).slice(0, 32);
}
