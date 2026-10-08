import { describe, expect, it } from 'vitest';
import { messageVariables, OUTBOX_TO_MESSAGING, quietHoursDelay } from '../src/messaging-render';

describe('messaging render', () => {
  it('exposes only allowed variables and no sensitive data', () => {
    const v = messageVariables({
      customerName: 'Maria da Silva',
      orderNumber: 42,
      device: 'Samsung A54',
      companyName: 'Loja X',
      technicalStatus: 'READY',
      link: 'https://ordemcerta.adapterco.com.br/status/42#token=abc',
      timezone: 'America/Sao_Paulo',
    });
    expect(v.cliente_nome).toBe('Maria');
    expect(v.status_publico).toBe('Pronto para retirada');
    expect(Object.keys(v).sort()).toEqual(
      ['aparelho', 'cliente_nome', 'empresa_nome', 'filial_nome', 'link_acompanhamento', 'os_numero', 'previsao_entrega', 'status_publico', 'valor_orcamento'].sort(),
    );
    expect(JSON.stringify(v)).not.toMatch(/imei|senha/i);
  });

  it('maps start and end of service events (main requirement)', () => {
    expect(OUTBOX_TO_MESSAGING['os.created']).toBe('OS_RECEIVED');
    expect(OUTBOX_TO_MESSAGING['os.ready']).toBe('OS_READY');
    expect(OUTBOX_TO_MESSAGING['quote.rejected']).toBeUndefined();
  });

  it('delays messages inside quiet hours (overnight window)', () => {
    const q = { start: '21:00', end: '08:00' };
    // 23:00 em São Paulo = 02:00Z
    expect(quietHoursDelay(new Date('2026-10-09T02:00:00Z'), q, 'America/Sao_Paulo')).toBe(9 * 3600_000);
    // 12:00 em São Paulo = 15:00Z
    expect(quietHoursDelay(new Date('2026-10-09T15:00:00Z'), q, 'America/Sao_Paulo')).toBe(0);
    expect(quietHoursDelay(new Date('2026-10-09T15:00:00Z'), null, 'America/Sao_Paulo')).toBe(0);
  });
});
