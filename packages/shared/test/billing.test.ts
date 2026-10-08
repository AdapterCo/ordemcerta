import { describe, expect, it } from 'vitest';
import {
  addBillingMonths,
  anchoredDate,
  computeProrationCents,
  downgradeViolations,
  initialPeriod,
  isMonotonicPaymentTransition,
  isOperational,
} from '../src/billing';
import { zonedParts } from '../src/dates';
import { PLAN_SEED } from '../src/plans';

const sp = (d: Date) => zonedParts(d, 'America/Sao_Paulo');

describe('billing anchor dates', () => {
  it('uses midnight in São Paulo (UTC-3)', () => {
    const d = anchoredDate(2026, 10, 8);
    expect(d.toISOString()).toBe('2026-10-08T03:00:00.000Z');
  });

  it('clamps day 31 to the last day of short months without drifting the anchor', () => {
    const jan = anchoredDate(2026, 1, 31);
    const feb = addBillingMonths(jan, 31);
    const mar = addBillingMonths(feb, 31);
    const apr = addBillingMonths(mar, 31);
    expect(sp(feb).day).toBe(28);
    expect(sp(mar).day).toBe(31);
    expect(sp(apr).day).toBe(30);
  });

  it('handles leap years and year rollover', () => {
    const feb2028 = anchoredDate(2028, 2, 30);
    expect(sp(feb2028).day).toBe(29);
    const dec = anchoredDate(2026, 12, 15);
    const jan = addBillingMonths(dec, 15);
    expect(sp(jan)).toMatchObject({ year: 2027, month: 1, day: 15 });
  });

  it('builds the initial period from activation date', () => {
    const p = initialPeriod(new Date('2026-10-08T15:30:00Z'));
    expect(p.anchorDay).toBe(8);
    expect(p.periodStart.toISOString()).toBe('2026-10-08T03:00:00.000Z');
    expect(p.periodEnd.toISOString()).toBe('2026-11-08T03:00:00.000Z');
  });
});

describe('proration', () => {
  const periodStart = new Date('2026-10-01T03:00:00Z');
  const periodEnd = new Date('2026-11-01T03:00:00Z');

  it('charges the proportional difference for the remaining time', () => {
    const at = new Date(periodStart.getTime() + (periodEnd.getTime() - periodStart.getTime()) / 2);
    expect(computeProrationCents({ fromPriceCents: 2999, toPriceCents: 5999, periodStart, periodEnd, at })).toBe(1500);
  });

  it('is zero for downgrades and at period end, full at period start', () => {
    expect(computeProrationCents({ fromPriceCents: 5999, toPriceCents: 2999, periodStart, periodEnd, at: periodStart })).toBe(0);
    expect(computeProrationCents({ fromPriceCents: 2999, toPriceCents: 5999, periodStart, periodEnd, at: periodEnd })).toBe(0);
    expect(computeProrationCents({ fromPriceCents: 2999, toPriceCents: 5999, periodStart, periodEnd, at: periodStart })).toBe(3000);
  });
});

describe('subscription operational state', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  it('allows ACTIVE and PAST_DUE within grace only', () => {
    expect(isOperational({ status: 'ACTIVE', currentPeriodEnd: null, graceUntil: null }, now)).toBe(true);
    expect(isOperational({ status: 'PAST_DUE', currentPeriodEnd: null, graceUntil: new Date('2026-10-11T00:00:00Z') }, now)).toBe(true);
    expect(isOperational({ status: 'PAST_DUE', currentPeriodEnd: null, graceUntil: new Date('2026-10-09T00:00:00Z') }, now)).toBe(false);
    expect(isOperational({ status: 'SUSPENDED', currentPeriodEnd: null, graceUntil: null }, now)).toBe(false);
    expect(isOperational({ status: 'PENDING_PAYMENT', currentPeriodEnd: null, graceUntil: null }, now)).toBe(false);
    expect(isOperational(null, now)).toBe(false);
  });
});

describe('plans seed (17.1)', () => {
  it('has exactly the four official plans with exact prices and limits', () => {
    expect(PLAN_SEED.map((p) => [p.code, p.priceCents, p.maxBranches, p.maxTechniciansPerBranch, p.maxCashRegistersPerBranch])).toEqual([
      ['ESSENCIAL', 2999, 1, 3, 1],
      ['PROFISSIONAL', 5999, 3, 3, 1],
      ['AVANCADO', 8999, 5, 3, 1],
      ['REDE', 12999, 10, 3, 1],
    ]);
  });
});

describe('downgrade validation', () => {
  it('lists exactly what must be deactivated', () => {
    const v = downgradeViolations(
      {
        activeBranches: 3,
        techniciansByBranch: [{ branchId: 'b1', branchName: 'Centro', count: 3 }],
        cashRegistersByBranch: [{ branchId: 'b1', branchName: 'Centro', count: 1 }],
      },
      { maxBranches: 1, maxTechniciansPerBranch: 3, maxCashRegistersPerBranch: 1 },
    );
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ kind: 'branches', current: 3, limit: 1 });
  });
});

describe('monotonic provider status', () => {
  it('never lets an old event undo an approved payment', () => {
    expect(isMonotonicPaymentTransition('PENDING', 'APPROVED')).toBe(true);
    expect(isMonotonicPaymentTransition('APPROVED', 'PENDING')).toBe(false);
    expect(isMonotonicPaymentTransition('APPROVED', 'REJECTED')).toBe(false);
    expect(isMonotonicPaymentTransition('APPROVED', 'REFUNDED')).toBe(true);
    expect(isMonotonicPaymentTransition('APPROVED', 'APPROVED')).toBe(true);
  });
});
