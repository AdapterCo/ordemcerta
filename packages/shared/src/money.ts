/**
 * Domínio financeiro trabalha sempre em centavos inteiros (BRL).
 */

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatBRL(cents: number | bigint | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return brl.format(Number(cents) / 100);
}

/**
 * Converte texto digitado ("1.234,56", "R$ 10", "10.5") em centavos.
 * Retorna null para entradas inválidas. Nunca usa ponto flutuante na
 * composição final: separa parte inteira e decimal como strings.
 */
export function parseBRLToCents(input: string | number): number | null {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return Math.round(input * 100);
  }
  let s = input.replace(/R\$\s?/i, '').replace(/\s/g, '').trim();
  if (!s) return null;
  const negative = s.startsWith('-');
  if (negative) s = s.slice(1);
  // Formato BR: vírgula decimal. Se houver vírgula, pontos são milhar.
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if ((s.match(/\./g) ?? []).length > 1) {
    s = s.replace(/\./g, '');
  }
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const [intPart, decPart = ''] = s.split('.');
  const cents = Number(intPart) * 100 + Number((decPart + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

export function sumCents(values: Array<number | null | undefined>): number {
  return values.reduce<number>((acc, v) => acc + (v ?? 0), 0);
}

export interface LineAmounts {
  qty: number;
  unitPriceCents: number;
  discountCents?: number;
}

/** Total de uma linha: qty * preço - desconto (nunca negativo). */
export function lineTotalCents(line: LineAmounts): number {
  const gross = line.qty * line.unitPriceCents;
  const discount = line.discountCents ?? 0;
  if (discount > gross) throw new RangeError('Desconto maior que o valor da linha');
  return gross - discount;
}

export interface DocumentTotals {
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
}

/**
 * Totais coerentes de documento (orçamento/venda): subtotal bruto,
 * descontos de linha + desconto geral, total. Lança se o total ficar negativo.
 */
export function computeTotals(lines: LineAmounts[], headerDiscountCents = 0): DocumentTotals {
  let subtotal = 0;
  let lineDiscounts = 0;
  for (const l of lines) {
    if (!Number.isInteger(l.qty) || l.qty <= 0) throw new RangeError('Quantidade deve ser inteira e positiva');
    if (!Number.isInteger(l.unitPriceCents) || l.unitPriceCents < 0) throw new RangeError('Preço inválido');
    const d = l.discountCents ?? 0;
    if (!Number.isInteger(d) || d < 0) throw new RangeError('Desconto inválido');
    subtotal += l.qty * l.unitPriceCents;
    lineDiscounts += d;
    lineTotalCents(l);
  }
  if (!Number.isInteger(headerDiscountCents) || headerDiscountCents < 0) throw new RangeError('Desconto inválido');
  const discount = lineDiscounts + headerDiscountCents;
  const total = subtotal - discount;
  if (total < 0) throw new RangeError('Total não pode ser negativo');
  return { subtotalCents: subtotal, discountCents: discount, totalCents: total };
}

/** Percentual de desconto (0–100, 2 casas) de um documento. */
export function discountPercent(subtotalCents: number, discountCents: number): number {
  if (subtotalCents <= 0) return 0;
  return Math.round((discountCents * 10000) / subtotalCents) / 100;
}

/**
 * Pagamento em dinheiro: calcula troco. `tenderedCents` é o valor entregue.
 */
export function computeChange(amountDueCents: number, tenderedCents: number): number {
  if (tenderedCents < amountDueCents) throw new RangeError('Valor entregue insuficiente');
  return tenderedCents - amountDueCents;
}
