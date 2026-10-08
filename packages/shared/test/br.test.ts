import { describe, expect, it } from 'vitest';
import { isValidCNPJ, isValidCPF, isValidIMEI, maskIdentifier, maskPhone, normalizeDocument, normalizePhoneE164 } from '../src/br';

describe('br utils', () => {
  it('normalizes Brazilian phones to E.164', () => {
    expect(normalizePhoneE164('(11) 98765-4321')).toBe('+5511987654321');
    expect(normalizePhoneE164('+55 21 3456-7890')).toBe('+552134567890');
    expect(normalizePhoneE164('123')).toBeNull();
  });

  it('validates CPF', () => {
    expect(isValidCPF('529.982.247-25')).toBe(true);
    expect(isValidCPF('111.111.111-11')).toBe(false);
    expect(isValidCPF('529.982.247-24')).toBe(false);
  });

  it('validates numeric and alphanumeric CNPJ', () => {
    expect(isValidCNPJ('11.222.333/0001-81')).toBe(true);
    expect(isValidCNPJ('11.222.333/0001-80')).toBe(false);
    // Exemplo oficial da Receita Federal para o CNPJ alfanumérico
    expect(isValidCNPJ('12.ABC.345/01DE-35')).toBe(true);
  });

  it('normalizes documents', () => {
    expect(normalizeDocument('529.982.247-25')).toEqual({ kind: 'CPF', value: '52998224725' });
    expect(normalizeDocument('invalid')).toBeNull();
  });

  it('validates IMEI with Luhn', () => {
    expect(isValidIMEI('490154203237518')).toBe(true);
    expect(isValidIMEI('490154203237519')).toBe(false);
  });

  it('masks sensitive identifiers', () => {
    expect(maskIdentifier('490154203237518')).toMatch(/7518$/);
    expect(maskIdentifier('490154203237518')).not.toContain('4901');
    expect(maskPhone('+5511987654321')).toBe('+5511****4321');
  });
});
