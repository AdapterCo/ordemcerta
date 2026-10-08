import { describe, expect, it } from 'vitest';
import { computeChange, computeTotals, formatBRL, parseBRLToCents } from '../src/money';

describe('money', () => {
  it('parses BR formatted values into integer cents', () => {
    expect(parseBRLToCents('1.234,56')).toBe(123456);
    expect(parseBRLToCents('R$ 10')).toBe(1000);
    expect(parseBRLToCents('0,1')).toBe(10);
    expect(parseBRLToCents('29.99')).toBe(2999);
    expect(parseBRLToCents('abc')).toBeNull();
    expect(parseBRLToCents('1,999')).toBeNull();
  });

  it('formats cents as BRL', () => {
    expect(formatBRL(2999).replace(/\s/g, ' ')).toBe('R$ 29,99');
  });

  it('computes coherent totals with line and header discounts', () => {
    const t = computeTotals(
      [
        { qty: 2, unitPriceCents: 5000, discountCents: 500 },
        { qty: 1, unitPriceCents: 12000 },
      ],
      1000,
    );
    expect(t).toEqual({ subtotalCents: 22000, discountCents: 1500, totalCents: 20500 });
  });

  it('rejects negative totals, fractional quantities and line discounts above line value', () => {
    expect(() => computeTotals([{ qty: 1, unitPriceCents: 100 }], 200)).toThrow();
    expect(() => computeTotals([{ qty: 1.5, unitPriceCents: 100 }])).toThrow();
    expect(() => computeTotals([{ qty: 1, unitPriceCents: 100, discountCents: 101 }])).toThrow();
  });

  it('computes cash change', () => {
    expect(computeChange(4550, 5000)).toBe(450);
    expect(() => computeChange(5000, 4000)).toThrow();
  });
});
