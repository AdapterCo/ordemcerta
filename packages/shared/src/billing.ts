import { daysInMonth, zonedParts, zonedToUtc, startOfZonedDay } from './dates';
import type { SubscriptionStatus } from './enums';

/** Fuso de cobrança da plataforma (seção 17.3). */
export const BILLING_TZ = 'America/Sao_Paulo';
/** Política comercial inicial: 3 dias corridos de tolerância (17.6). Parametrizável. */
export const DEFAULT_GRACE_DAYS = 3;

/**
 * Data no dia-âncora de um mês, à meia-noite no fuso de cobrança.
 * Dias 29–31 em meses curtos usam o último dia do mês, sem deriva da âncora.
 */
export function anchoredDate(year: number, month: number, anchorDay: number, tz: string = BILLING_TZ): Date {
  if (!Number.isInteger(anchorDay) || anchorDay < 1 || anchorDay > 31) throw new RangeError('anchorDay inválido');
  const y = year + Math.floor((month - 1) / 12);
  const m = ((((month - 1) % 12) + 12) % 12) + 1;
  const day = Math.min(anchorDay, daysInMonth(y, m));
  return zonedToUtc(y, m, day, 0, 0, 0, tz);
}

/**
 * Avança `months` ciclos a partir de `from`, preservando o dia-âncora.
 * Ex.: âncora 31 → 31/jan, 28/fev (ou 29), 31/mar, 30/abr...
 */
export function addBillingMonths(from: Date, anchorDay: number, months = 1, tz: string = BILLING_TZ): Date {
  const p = zonedParts(from, tz);
  return anchoredDate(p.year, p.month + months, anchorDay, tz);
}

export interface BillingPeriod {
  anchorDay: number;
  periodStart: Date;
  periodEnd: Date;
}

/** Primeiro período: começa no dia da ativação (meia-noite local) e termina no mesmo dia do mês seguinte. */
export function initialPeriod(activatedAt: Date, tz: string = BILLING_TZ): BillingPeriod {
  const p = zonedParts(activatedAt, tz);
  const periodStart = startOfZonedDay(activatedAt, tz);
  return { anchorDay: p.day, periodStart, periodEnd: addBillingMonths(periodStart, p.day, 1, tz) };
}

/** Período seguinte a partir do fim do atual. */
export function nextPeriod(currentPeriodEnd: Date, anchorDay: number, tz: string = BILLING_TZ): { periodStart: Date; periodEnd: Date } {
  return { periodStart: currentPeriodEnd, periodEnd: addBillingMonths(currentPeriodEnd, anchorDay, 1, tz) };
}

export interface ProrationInput {
  fromPriceCents: number;
  toPriceCents: number;
  periodStart: Date;
  periodEnd: Date;
  at: Date;
}

/**
 * Diferença proporcional de upgrade pelo tempo restante do ciclo,
 * em centavos, com arredondamento determinístico (meio para cima) via BigInt.
 * Downgrade/igual retorna 0 (sem devolução proporcional por padrão).
 */
export function computeProrationCents(input: ProrationInput): number {
  const { fromPriceCents, toPriceCents, periodStart, periodEnd, at } = input;
  if (toPriceCents <= fromPriceCents) return 0;
  const total = periodEnd.getTime() - periodStart.getTime();
  if (total <= 0) throw new RangeError('Período inválido');
  const remaining = Math.min(Math.max(periodEnd.getTime() - at.getTime(), 0), total);
  const diff = BigInt(toPriceCents - fromPriceCents);
  const t = BigInt(total);
  return Number((diff * BigInt(remaining) + t / 2n) / t);
}

export function graceUntil(dueAt: Date, graceDays: number = DEFAULT_GRACE_DAYS): Date {
  return new Date(dueAt.getTime() + graceDays * 86_400_000);
}

export interface SubscriptionSnapshot {
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  graceUntil: Date | null;
}

/**
 * Se o tenant pode executar operações (criar OS, vender, movimentar estoque/caixa).
 * Suspensão mantém login, leitura e exportações autorizadas, mas bloqueia escrita operacional.
 */
export function isOperational(sub: SubscriptionSnapshot | null, now: Date = new Date()): boolean {
  if (!sub) return false;
  switch (sub.status) {
    case 'ACTIVE':
      return true;
    case 'PAST_DUE':
      return sub.graceUntil !== null && now.getTime() < sub.graceUntil.getTime();
    case 'CANCEL_AT_PERIOD_END':
      return sub.currentPeriodEnd !== null && now.getTime() < sub.currentPeriodEnd.getTime();
    default:
      return false;
  }
}

export type QuotaKind = 'branches' | 'technicians_per_branch' | 'cash_registers_per_branch';

export interface PlanLimits {
  maxBranches: number;
  maxTechniciansPerBranch: number;
  maxCashRegistersPerBranch: number;
}

export function limitFor(kind: QuotaKind, limits: PlanLimits): number {
  switch (kind) {
    case 'branches':
      return limits.maxBranches;
    case 'technicians_per_branch':
      return limits.maxTechniciansPerBranch;
    case 'cash_registers_per_branch':
      return limits.maxCashRegistersPerBranch;
  }
}

export interface DowngradeUsage {
  activeBranches: number;
  techniciansByBranch: Array<{ branchId: string; branchName: string; count: number }>;
  cashRegistersByBranch: Array<{ branchId: string; branchName: string; count: number }>;
}

export interface DowngradeViolation {
  kind: QuotaKind;
  branchId?: string;
  branchName?: string;
  current: number;
  limit: number;
  message: string;
}

/** Lista exatamente o que precisa ser desativado antes de agendar um downgrade (17.7). */
export function downgradeViolations(usage: DowngradeUsage, target: PlanLimits): DowngradeViolation[] {
  const out: DowngradeViolation[] = [];
  if (usage.activeBranches > target.maxBranches) {
    out.push({
      kind: 'branches',
      current: usage.activeBranches,
      limit: target.maxBranches,
      message: `Desative ${usage.activeBranches - target.maxBranches} filial(is): o novo plano permite ${target.maxBranches}.`,
    });
  }
  for (const b of usage.techniciansByBranch) {
    if (b.count > target.maxTechniciansPerBranch) {
      out.push({
        kind: 'technicians_per_branch',
        branchId: b.branchId,
        branchName: b.branchName,
        current: b.count,
        limit: target.maxTechniciansPerBranch,
        message: `Filial ${b.branchName}: remova ${b.count - target.maxTechniciansPerBranch} técnico(s).`,
      });
    }
  }
  for (const b of usage.cashRegistersByBranch) {
    if (b.count > target.maxCashRegistersPerBranch) {
      out.push({
        kind: 'cash_registers_per_branch',
        branchId: b.branchId,
        branchName: b.branchName,
        current: b.count,
        limit: target.maxCashRegistersPerBranch,
        message: `Filial ${b.branchName}: desative ${b.count - target.maxCashRegistersPerBranch} caixa(s).`,
      });
    }
  }
  return out;
}

/** Ordem de "força" de status de pagamento do provedor: eventos antigos não desfazem estados mais novos. */
const PAYMENT_STATUS_RANK: Record<string, number> = {
  CREATED: 0,
  PENDING: 1,
  REJECTED: 2,
  CANCELED: 2,
  APPROVED: 3,
  REFUNDED: 4,
  CHARGEBACK: 5,
};

/** Transição monotônica: só aceita status de rank maior (ou igual, idempotente). */
export function isMonotonicPaymentTransition(from: string, to: string): boolean {
  const a = PAYMENT_STATUS_RANK[from] ?? -1;
  const b = PAYMENT_STATUS_RANK[to] ?? -1;
  if (from === 'APPROVED' && (to === 'REJECTED' || to === 'CANCELED' || to === 'PENDING')) return false;
  return b >= a;
}
