import { describe, expect, it } from 'vitest';
import { EncryptionService, randomNumericCode, safeEqual } from '../src/crypto';
import { mapMpStatus } from '../src/mercadopago';
import { toCsv } from '../src/reports';
import { sniffMime } from '../src/storage';
import { renderPlaceholders, templateBodyParams } from '../src/templates';
import { parseWhatsAppInbound, parseWhatsAppStatuses, WhatsAppCloudProvider } from '../src/whatsapp';
import { createHmac } from 'node:crypto';

const key = Buffer.alloc(32, 1).toString('base64');

describe('criptografia', () => {
  it('cifra/decifra e suporta rotação de chave', () => {
    const old = new EncryptionService(key, 'k1');
    const payload = old.encrypt('490154203237518');
    expect(payload.startsWith('k1.')).toBe(true);
    expect(payload).not.toContain('490154203237518');
    const rotated = new EncryptionService(Buffer.alloc(32, 2).toString('base64'), 'k2', `k1:${key}`);
    expect(rotated.decrypt(payload)).toBe('490154203237518');
    expect(rotated.needsRotation(payload)).toBe(true);
  });

  it('índice cego determinístico e OTP numérico', () => {
    const e = new EncryptionService(key);
    expect(e.blindIndex(' abc ')).toBe(e.blindIndex('ABC'));
    expect(randomNumericCode(6)).toMatch(/^\d{6}$/);
    expect(safeEqual('a', 'b')).toBe(false);
  });
});

describe('integrações', () => {
  it('mapeia status do Mercado Pago', () => {
    expect(mapMpStatus('approved')).toBe('APPROVED');
    expect(mapMpStatus('in_process')).toBe('PENDING');
    expect(mapMpStatus('charged_back')).toBe('CHARGEBACK');
    expect(mapMpStatus('refunded')).toBe('REFUNDED');
  });

  it('valida assinatura do webhook da Meta (X-Hub-Signature-256)', () => {
    const p = new WhatsAppCloudProvider('v23.0', 'app', 'segredo');
    const body = Buffer.from('{"object":"whatsapp_business_account"}');
    const sig = `sha256=${createHmac('sha256', 'segredo').update(body).digest('hex')}`;
    expect(p.verifyWebhookSignature(body, sig)).toBe(true);
    expect(p.verifyWebhookSignature(body, 'sha256=00')).toBe(false);
    expect(p.verifyWebhookSignature(body, undefined)).toBe(false);
  });

  it('extrai status e mensagens do webhook oficial', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA1',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'PN1' },
                statuses: [{ id: 'wamid.1', status: 'delivered', timestamp: '1' }],
                messages: [{ from: '5511999990000', text: { body: 'SAIR' } }],
              },
            },
          ],
        },
      ],
    };
    expect(parseWhatsAppStatuses(payload)).toEqual([{ phoneNumberId: 'PN1', wabaId: 'WABA1', providerMessageId: 'wamid.1', status: 'delivered', timestamp: 1, errorCode: undefined }]);
    expect(parseWhatsAppInbound(payload)).toEqual([{ phoneNumberId: 'PN1', from: '+5511999990000', text: 'SAIR' }]);
  });
});

describe('documentos e exportações', () => {
  it('substitui somente placeholders conhecidos, como texto', () => {
    expect(renderPlaceholders('Olá {{cliente_nome}} <b>{{x}}</b>', { cliente_nome: 'Ana\u0007' })).toBe('Olá Ana <b></b>');
  });

  it('parâmetros de template só com variáveis permitidas', () => {
    expect(templateBodyParams(['cliente_nome', 'imei', 'os_numero'], { cliente_nome: 'Ana', os_numero: '42', imei: '123' })).toEqual(['Ana', '42']);
  });

  it('CSV com BOM, separador ; e proteção contra injeção de fórmula', () => {
    const csv = toCsv({ title: 't', summary: {}, columns: ['a', 'b'], rows: [['=1+1', 'x;y']] });
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain(`'=1+1`);
    expect(csv).toContain('"x;y"');
  });

  it('detecta MIME real pelos magic bytes', () => {
    expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('image/jpeg');
    expect(sniffMime(Buffer.from('%PDF-1.7 aaaaaaa'))).toBe('application/pdf');
    expect(sniffMime(Buffer.from('<html><script>alert(1)</script>'))).toBeNull();
  });
});
