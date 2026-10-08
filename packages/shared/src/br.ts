import { parsePhoneNumberFromString } from 'libphonenumber-js/min';

/** Normaliza telefone para E.164 (padrão Brasil). Retorna null se inválido. */
export function normalizePhoneE164(input: string | null | undefined, defaultCountry: 'BR' = 'BR'): string | null {
  if (!input) return null;
  const parsed = parsePhoneNumberFromString(input, defaultCountry);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

export function formatPhoneBR(e164: string | null | undefined): string {
  if (!e164) return '';
  const parsed = parsePhoneNumberFromString(e164);
  return parsed ? parsed.formatNational() : e164;
}

/** Mascara telefone para logs/telas públicas: +5511****1234 */
export function maskPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const digits = e164.replace(/\D/g, '');
  if (digits.length < 6) return '****';
  return `+${digits.slice(0, 4)}****${digits.slice(-4)}`;
}

export function onlyDigits(v: string): string {
  return v.replace(/\D/g, '');
}

export function isValidCPF(input: string): boolean {
  const cpf = onlyDigits(input);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}

/**
 * Valida CNPJ numérico e alfanumérico (formato vigente a partir de 07/2026):
 * 12 caracteres [0-9A-Z] + 2 dígitos verificadores numéricos.
 * Valor de cada caractere = código ASCII - 48.
 */
export function isValidCNPJ(input: string): boolean {
  const cnpj = input.toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj)) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;
  const val = (c: string) => c.charCodeAt(0) - 48;
  const dv = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < len; i++) sum += val(cnpj[i]!) * weights[i]!;
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(cnpj[12]) && dv(13) === Number(cnpj[13]);
}

export type DocumentKind = 'CPF' | 'CNPJ';

/** Normaliza CPF/CNPJ (somente caracteres significativos, maiúsculos). */
export function normalizeDocument(input: string | null | undefined): { kind: DocumentKind; value: string } | null {
  if (!input) return null;
  const cleaned = input.toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (cleaned.length === 11 && isValidCPF(cleaned)) return { kind: 'CPF', value: cleaned };
  if (cleaned.length === 14 && isValidCNPJ(cleaned)) return { kind: 'CNPJ', value: cleaned };
  return null;
}

export function formatDocument(value: string | null | undefined): string {
  if (!value) return '';
  if (value.length === 11) return value.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  if (value.length === 14) return value.replace(/^(.{2})(.{3})(.{3})(.{4})(.{2})$/, '$1.$2.$3/$4-$5');
  return value;
}

/** Mascara IMEI/serial: somente os 4 últimos caracteres. */
export function maskIdentifier(v: string | null | undefined): string {
  if (!v) return '';
  return v.length <= 4 ? '****' : `${'•'.repeat(Math.min(v.length - 4, 11))}${v.slice(-4)}`;
}

/** Valida IMEI de 15 dígitos pelo algoritmo de Luhn. */
export function isValidIMEI(input: string): boolean {
  const d = onlyDigits(input);
  if (d.length !== 15) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let n = Number(d[14 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}
