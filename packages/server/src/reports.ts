import { Prisma } from '@prisma/client';
import {
  PAYMENT_METHOD_LABELS,
  TECHNICAL_STATUS_LABELS,
  WARRANTY_STATUS_LABELS,
  formatBRL,
  type PaymentMethod,
  type ReportType,
  type TechnicalStatus,
  type WarrantyClaimStatus,
} from '@ordemcerta/shared';
import type { Tx } from './prisma';

/**
 * Relatórios com escopo de tenant EXPLÍCITO (tenant_id = $1) em todas as
 * consultas — seguros tanto com RLS (API) quanto com o papel de sistema (worker).
 *
 * Distinções obrigatórias: faturamento (competência, ledger REVENUE_*) ≠
 * recebimento (PAYMENT_RECEIVED/REFUND) ≠ lucro (receita - CMV) ≠ saldo de caixa.
 */
export interface ReportFilters {
  tenantId: string;
  branchIds: string[] | null;
  from: Date;
  to: Date;
  technicianId?: string;
  attendantId?: string;
}

export interface ReportResult {
  title: string;
  summary: Record<string, number | string>;
  columns: string[];
  rows: Array<Array<string | number>>;
}

const n = (v: unknown) => Number(v ?? 0);
const br = (f: ReportFilters, col = 'branch_id') =>
  f.branchIds ? Prisma.sql`AND ${Prisma.raw(col)} = ANY(${f.branchIds}::uuid[])` : Prisma.empty;

async function ledgerTotals(tx: Tx, f: ReportFilters) {
  const rows = await tx.$queryRaw<Array<{ entry_type: string; total: bigint }>>`
    SELECT entry_type::text, COALESCE(SUM(amount_cents), 0)::bigint AS total
    FROM financial_ledger
    WHERE tenant_id = ${f.tenantId}::uuid AND competence_at >= ${f.from} AND competence_at < ${f.to} ${br(f)}
    GROUP BY entry_type`;
  const m = Object.fromEntries(rows.map((r) => [r.entry_type, n(r.total)]));
  const revenue = (m.REVENUE_SERVICE ?? 0) + (m.REVENUE_SALE ?? 0) + (m.DISCOUNT ?? 0) + (m.REVENUE_REVERSAL ?? 0);
  const cogs = m.COGS ?? 0;
  return {
    serviceRevenue: m.REVENUE_SERVICE ?? 0,
    salesRevenue: (m.REVENUE_SALE ?? 0) + (m.DISCOUNT ?? 0) + (m.REVENUE_REVERSAL ?? 0),
    discounts: -(m.DISCOUNT ?? 0),
    revenue,
    receipts: m.PAYMENT_RECEIVED ?? 0,
    refunds: -(m.REFUND ?? 0),
    netReceipts: (m.PAYMENT_RECEIVED ?? 0) + (m.REFUND ?? 0),
    cogs,
    grossMargin: revenue - cogs,
    cashDifference: m.CASH_DIFFERENCE ?? 0,
  };
}

export async function reportOverview(tx: Tx, f: ReportFilters): Promise<ReportResult> {
  const statuses = await tx.$queryRaw<Array<{ s: string; c: bigint }>>`
    SELECT technical_status::text AS s, COUNT(*)::bigint AS c FROM service_orders
    WHERE tenant_id = ${f.tenantId}::uuid ${br(f)} AND delivery_status IN ('IN_CUSTODY','READY_FOR_PICKUP')
    GROUP BY technical_status`;
  const byStatus = Object.fromEntries(statuses.map((r) => [r.s, n(r.c)]));
  const [extra] = await tx.$queryRaw<Array<{ overdue: bigint; not_picked: bigint; created: bigint; delivered: bigint }>>`
    SELECT
      COUNT(*) FILTER (WHERE estimated_delivery_at < now() AND technical_status NOT IN ('READY','CANCELED','RETURNED_UNREPAIRED') AND delivery_status = 'IN_CUSTODY')::bigint AS overdue,
      COUNT(*) FILTER (WHERE delivery_status = 'READY_FOR_PICKUP' AND completed_at < now() - interval '3 days')::bigint AS not_picked,
      COUNT(*) FILTER (WHERE received_at >= ${f.from} AND received_at < ${f.to})::bigint AS created,
      COUNT(*) FILTER (WHERE delivered_at >= ${f.from} AND delivered_at < ${f.to})::bigint AS delivered
    FROM service_orders WHERE tenant_id = ${f.tenantId}::uuid ${br(f)}`;
  const [sales] = await tx.$queryRaw<Array<{ c: bigint; total: bigint }>>`
    SELECT COUNT(*)::bigint AS c, COALESCE(SUM(total_cents - refunded_cents),0)::bigint AS total FROM sales
    WHERE tenant_id = ${f.tenantId}::uuid ${br(f)} AND status IN ('CONFIRMED','PARTIALLY_REFUNDED','REFUNDED')
      AND confirmed_at >= ${f.from} AND confirmed_at < ${f.to}`;
  const [alerts] = await tx.$queryRaw<Array<{ c: bigint }>>`
    SELECT COUNT(*)::bigint AS c FROM stock_balances b
    JOIN products p ON p.id = b.product_id AND p.tenant_id = b.tenant_id
    JOIN stock_locations l ON l.id = b.location_id AND l.tenant_id = b.tenant_id
    WHERE b.tenant_id = ${f.tenantId}::uuid ${br(f, 'l.branch_id')} AND p.active AND p.min_stock > 0 AND (b.on_hand - b.reserved) < p.min_stock`;
  const [cash] = await tx.$queryRaw<Array<{ c: bigint }>>`
    SELECT COUNT(*)::bigint AS c FROM cash_sessions WHERE tenant_id = ${f.tenantId}::uuid ${br(f)} AND status = 'OPEN'`;
  const [receivable] = await tx.$queryRaw<Array<{ total: bigint }>>`
    SELECT COALESCE(SUM(amount_cents - (paid_cents - refunded_cents)),0)::bigint AS total FROM receivables
    WHERE tenant_id = ${f.tenantId}::uuid ${br(f)} AND status IN ('OPEN','PARTIALLY_PAID')`;
  const fin = await ledgerTotals(tx, f);
  const open = Object.entries(byStatus).filter(([s]) => !['READY', 'CANCELED', 'RETURNED_UNREPAIRED'].includes(s)).reduce((a, [, c]) => a + c, 0);
  return {
    title: 'Visão geral',
    summary: {
      osOpen: open,
      osWaitingApproval: byStatus.WAITING_QUOTE_APPROVAL ?? 0,
      osWaitingParts: byStatus.WAITING_PARTS ?? 0,
      osInRepair: (byStatus.IN_REPAIR ?? 0) + (byStatus.TESTING ?? 0),
      osReady: byStatus.READY ?? 0,
      osNotPickedUp: n(extra?.not_picked),
      osOverdue: n(extra?.overdue),
      osCreated: n(extra?.created),
      osDelivered: n(extra?.delivered),
      salesCount: n(sales?.c),
      salesTotal: n(sales?.total),
      stockAlerts: n(alerts?.c),
      openCashSessions: n(cash?.c),
      receivablesOpen: n(receivable?.total),
      ...fin,
    },
    columns: ['Status', 'Quantidade em custódia'],
    rows: Object.entries(byStatus).map(([s, c]) => [TECHNICAL_STATUS_LABELS[s as TechnicalStatus] ?? s, c]),
  };
}

export async function reportServiceOrders(tx: Tx, f: ReportFilters): Promise<ReportResult> {
  const tech = f.technicianId ? Prisma.sql`AND o.assigned_technician_id = ${f.technicianId}::uuid` : Prisma.empty;
  const att = f.attendantId ? Prisma.sql`AND o.created_by = ${f.attendantId}::uuid` : Prisma.empty;
  const rows = await tx.$queryRaw<
    Array<{ number: number; received_at: Date; status: string; technician: string | null; total_cents: number; completed_at: Date | null; hours: number | null; sla: boolean | null; warranty: boolean }>
  >`
    SELECT o.number, o.received_at, o.technical_status::text AS status, u.name AS technician, o.total_cents, o.completed_at,
      EXTRACT(EPOCH FROM (o.completed_at - o.received_at)) / 3600 AS hours,
      (o.completed_at IS NOT NULL AND o.sla_due_at IS NOT NULL AND o.completed_at > o.sla_due_at) AS sla,
      (o.warranty_of_order_id IS NOT NULL) AS warranty
    FROM service_orders o LEFT JOIN users u ON u.id = o.assigned_technician_id
    WHERE o.tenant_id = ${f.tenantId}::uuid ${br(f, 'o.branch_id')} ${tech} ${att}
      AND o.received_at >= ${f.from} AND o.received_at < ${f.to}
    ORDER BY o.number`;
  const done = rows.filter((r) => r.hours !== null);
  const avg = done.length ? done.reduce((s, r) => s + n(r.hours), 0) / done.length : 0;
  const [mix] = await tx.$queryRaw<Array<{ labor: bigint; parts: bigint }>>`
    SELECT COALESCE(SUM(CASE WHEN l.kind IN ('LABOR','SERVICE','FEE') THEN l.qty * l.unit_price_cents - l.discount_cents END),0)::bigint AS labor,
           COALESCE(SUM(CASE WHEN l.kind = 'PART' THEN l.qty * l.unit_price_cents - l.discount_cents END),0)::bigint AS parts
    FROM service_orders o JOIN quote_lines l ON l.quote_id = o.approved_quote_id AND l.tenant_id = o.tenant_id
    WHERE o.tenant_id = ${f.tenantId}::uuid ${br(f, 'o.branch_id')} AND o.delivered_at >= ${f.from} AND o.delivered_at < ${f.to}`;
  return {
    title: 'Ordens de serviço',
    summary: {
      total: rows.length,
      completed: done.length,
      avgExecutionHours: Math.round(avg * 10) / 10,
      slaBreached: rows.filter((r) => r.sla).length,
      warrantyReturns: rows.filter((r) => r.warranty).length,
      deliveredLaborRevenue: n(mix?.labor),
      deliveredPartsRevenue: n(mix?.parts),
    },
    columns: ['OS', 'Entrada', 'Status', 'Técnico', 'Total', 'Concluída', 'Horas', 'SLA estourado', 'Garantia'],
    rows: rows.map((r) => [
      r.number,
      r.received_at.toISOString(),
      TECHNICAL_STATUS_LABELS[r.status as TechnicalStatus] ?? r.status,
      r.technician ?? '—',
      formatBRL(r.total_cents),
      r.completed_at ? r.completed_at.toISOString() : '—',
      r.hours !== null ? Math.round(n(r.hours) * 10) / 10 : '—',
      r.sla ? 'sim' : 'não',
      r.warranty ? 'sim' : 'não',
    ]),
  };
}

export async function reportTechnicians(tx: Tx, f: ReportFilters): Promise<ReportResult> {
  const rows = await tx.$queryRaw<Array<{ name: string; completed: bigint; in_progress: bigint; avg_hours: number | null; returns: bigint }>>`
    SELECT u.name,
      COUNT(*) FILTER (WHERE o.completed_at >= ${f.from} AND o.completed_at < ${f.to} AND o.technical_status = 'READY')::bigint AS completed,
      COUNT(*) FILTER (WHERE o.technical_status IN ('DIAGNOSING','IN_REPAIR','TESTING','WAITING_PARTS','APPROVED'))::bigint AS in_progress,
      AVG(EXTRACT(EPOCH FROM (o.completed_at - o.repair_started_at)) / 3600) FILTER (WHERE o.completed_at >= ${f.from} AND o.completed_at < ${f.to}) AS avg_hours,
      COUNT(w.id)::bigint AS returns
    FROM service_orders o
    JOIN users u ON u.id = o.assigned_technician_id
    LEFT JOIN service_orders w ON w.warranty_of_order_id = o.id AND w.tenant_id = o.tenant_id
    WHERE o.tenant_id = ${f.tenantId}::uuid ${br(f, 'o.branch_id')}
    GROUP BY u.name ORDER BY completed DESC`;
  return {
    title: 'Técnicos',
    summary: { technicians: rows.length },
    columns: ['Técnico', 'Concluídas no período', 'Em andamento', 'Horas médias de reparo', 'Retornos em garantia'],
    rows: rows.map((r) => [r.name, n(r.completed), n(r.in_progress), r.avg_hours !== null ? Math.round(n(r.avg_hours) * 10) / 10 : '—', n(r.returns)]),
  };
}

export async function reportSales(tx: Tx, f: ReportFilters): Promise<ReportResult> {
  const att = f.attendantId ? Prisma.sql`AND s.created_by = ${f.attendantId}::uuid` : Prisma.empty;
  const days = await tx.$queryRaw<Array<{ day: Date; c: bigint; subtotal: bigint; discount: bigint; total: bigint; refunded: bigint; cogs: bigint }>>`
    SELECT date_trunc('day', s.confirmed_at AT TIME ZONE 'America/Sao_Paulo') AS day, COUNT(*)::bigint AS c,
      SUM(s.subtotal_cents)::bigint AS subtotal, SUM(s.discount_cents)::bigint AS discount, SUM(s.total_cents)::bigint AS total,
      SUM(s.refunded_cents)::bigint AS refunded,
      COALESCE(SUM((SELECT SUM((i.qty - i.refunded_qty) * i.unit_cost_cents) FROM sale_items i WHERE i.sale_id = s.id AND i.tenant_id = s.tenant_id)),0)::bigint AS cogs
    FROM sales s
    WHERE s.tenant_id = ${f.tenantId}::uuid ${br(f, 's.branch_id')} ${att} AND s.status IN ('CONFIRMED','PARTIALLY_REFUNDED','REFUNDED')
      AND s.confirmed_at >= ${f.from} AND s.confirmed_at < ${f.to}
    GROUP BY 1 ORDER BY 1`;
  const methods = await tx.$queryRaw<Array<{ method: string; total: bigint }>>`
    SELECT p.method::text, SUM(p.amount_cents - p.refunded_cents)::bigint AS total FROM payments p
    WHERE p.tenant_id = ${f.tenantId}::uuid ${br(f, 'p.branch_id')} AND p.received_at >= ${f.from} AND p.received_at < ${f.to}
    GROUP BY 1`;
  const accessories = await tx.$queryRaw<Array<{ total: bigint }>>`
    SELECT COALESCE(SUM(s.total_cents - s.refunded_cents),0)::bigint AS total FROM sales s
    WHERE s.tenant_id = ${f.tenantId}::uuid ${br(f, 's.branch_id')} AND s.order_id IS NOT NULL AND s.status <> 'DRAFT' AND s.status <> 'CANCELED'
      AND s.confirmed_at >= ${f.from} AND s.confirmed_at < ${f.to}`;
  const totals = days.reduce(
    (a, d) => ({ c: a.c + n(d.c), total: a.total + n(d.total), discount: a.discount + n(d.discount), refunded: a.refunded + n(d.refunded), cogs: a.cogs + n(d.cogs) }),
    { c: 0, total: 0, discount: 0, refunded: 0, cogs: 0 },
  );
  const summary: Record<string, number | string> = {
    sales: totals.c,
    grossTotal: totals.total,
    discounts: totals.discount,
    refunds: totals.refunded,
    netTotal: totals.total - totals.refunded,
    cogs: totals.cogs,
    estimatedMargin: totals.total - totals.refunded - totals.cogs,
    accessoriesAtPickup: n(accessories[0]?.total),
  };
  for (const m of methods) summary[`receipts_${m.method}`] = n(m.total);
  return {
    title: 'Vendas',
    summary,
    columns: ['Dia', 'Vendas', 'Subtotal', 'Descontos', 'Total', 'Estornos', 'CMV', 'Margem estimada'],
    rows: days.map((d) => [
      d.day.toISOString().slice(0, 10),
      n(d.c),
      formatBRL(n(d.subtotal)),
      formatBRL(n(d.discount)),
      formatBRL(n(d.total)),
      formatBRL(n(d.refunded)),
      formatBRL(n(d.cogs)),
      formatBRL(n(d.total) - n(d.refunded) - n(d.cogs)),
    ]),
  };
}

export async function reportStock(tx: Tx, f: ReportFilters): Promise<ReportResult> {
  const rows = await tx.$queryRaw<Array<{ sku: string; name: string; branch: string; on_hand: number; reserved: number; min_stock: number; cost: number; consumed: bigint; sold: bigint }>>`
    SELECT p.sku, p.name, br.name AS branch, b.on_hand, b.reserved, p.min_stock, p.cost_cents AS cost,
      COALESCE((SELECT -SUM(m.quantity) FROM stock_movements m WHERE m.tenant_id = b.tenant_id AND m.location_id = b.location_id AND m.product_id = b.product_id
        AND m.type = 'OS_CONSUMPTION' AND m.created_at >= ${f.from} AND m.created_at < ${f.to}), 0)::bigint AS consumed,
      COALESCE((SELECT -SUM(m.quantity) FROM stock_movements m WHERE m.tenant_id = b.tenant_id AND m.location_id = b.location_id AND m.product_id = b.product_id
        AND m.type = 'SALE' AND m.created_at >= ${f.from} AND m.created_at < ${f.to}), 0)::bigint AS sold
    FROM stock_balances b
    JOIN products p ON p.id = b.product_id AND p.tenant_id = b.tenant_id
    JOIN stock_locations l ON l.id = b.location_id AND l.tenant_id = b.tenant_id
    JOIN branches br ON br.id = l.branch_id AND br.tenant_id = l.tenant_id
    WHERE b.tenant_id = ${f.tenantId}::uuid ${br(f, 'l.branch_id')}
    ORDER BY p.name`;
  const value = rows.reduce((s, r) => s + r.on_hand * r.cost, 0);
  return {
    title: 'Estoque e peças usadas',
    summary: {
      items: rows.length,
      inventoryValueAtCost: value,
      belowMinimum: rows.filter((r) => r.on_hand - r.reserved < r.min_stock).length,
      partsConsumed: rows.reduce((s, r) => s + n(r.consumed), 0),
    },
    columns: ['SKU', 'Produto', 'Filial', 'Físico', 'Reservado', 'Disponível', 'Mínimo', 'Custo unit.', 'Valor', 'Usado em OS', 'Vendido'],
    rows: rows.map((r) => [
      r.sku, r.name, r.branch, r.on_hand, r.reserved, r.on_hand - r.reserved, r.min_stock,
      formatBRL(r.cost), formatBRL(r.on_hand * r.cost), n(r.consumed), n(r.sold),
    ]),
  };
}

export async function reportCash(tx: Tx, f: ReportFilters): Promise<ReportResult> {
  const sessions = await tx.$queryRaw<
    Array<{ id: string; register: string; opened_at: Date; closed_at: Date | null; status: string; difference: number | null; supplies: bigint; withdrawals: bigint; received: bigint }>
  >`
    SELECT s.id, r.name AS register, s.opened_at, s.closed_at, s.status::text, s.difference_cents AS difference,
      COALESCE(SUM(m.amount_cents) FILTER (WHERE m.type = 'SUPPLY'),0)::bigint AS supplies,
      COALESCE(SUM(m.amount_cents) FILTER (WHERE m.type = 'WITHDRAWAL'),0)::bigint AS withdrawals,
      COALESCE(SUM(m.amount_cents) FILTER (WHERE m.type = 'PAYMENT_IN'),0)::bigint - COALESCE(SUM(m.amount_cents) FILTER (WHERE m.type = 'REFUND_OUT'),0)::bigint AS received
    FROM cash_sessions s
    JOIN cash_registers r ON r.id = s.register_id AND r.tenant_id = s.tenant_id
    LEFT JOIN cash_movements m ON m.cash_session_id = s.id AND m.tenant_id = s.tenant_id
    WHERE s.tenant_id = ${f.tenantId}::uuid ${br(f, 's.branch_id')} AND s.opened_at >= ${f.from} AND s.opened_at < ${f.to}
    GROUP BY s.id, r.name ORDER BY s.opened_at`;
  const byMethod = await tx.$queryRaw<Array<{ method: string; total: bigint }>>`
    SELECT m.method::text, (COALESCE(SUM(m.amount_cents) FILTER (WHERE m.type = 'PAYMENT_IN'),0) - COALESCE(SUM(m.amount_cents) FILTER (WHERE m.type = 'REFUND_OUT'),0))::bigint AS total
    FROM cash_movements m JOIN cash_sessions s ON s.id = m.cash_session_id AND s.tenant_id = m.tenant_id
    WHERE m.tenant_id = ${f.tenantId}::uuid ${br(f, 's.branch_id')} AND m.created_at >= ${f.from} AND m.created_at < ${f.to}
    GROUP BY 1`;
  const summary: Record<string, number | string> = {
    sessions: sessions.length,
    supplies: sessions.reduce((s, r) => s + n(r.supplies), 0),
    withdrawals: sessions.reduce((s, r) => s + n(r.withdrawals), 0),
    closingDifferences: sessions.reduce((s, r) => s + n(r.difference), 0),
  };
  for (const m of byMethod) summary[`received_${m.method}`] = n(m.total);
  return {
    title: 'Caixa',
    summary,
    columns: ['Caixa', 'Abertura', 'Fechamento', 'Status', 'Recebido (líquido)', 'Suprimentos', 'Sangrias', 'Diferença'],
    rows: sessions.map((r) => [
      r.register,
      r.opened_at.toISOString(),
      r.closed_at ? r.closed_at.toISOString() : '—',
      r.status === 'OPEN' ? 'Aberto' : 'Fechado',
      formatBRL(n(r.received)),
      formatBRL(n(r.supplies)),
      formatBRL(n(r.withdrawals)),
      r.difference === null ? '—' : formatBRL(n(r.difference)),
    ]),
  };
}

export async function reportWarranties(tx: Tx, f: ReportFilters): Promise<ReportResult> {
  const rows = await tx.$queryRaw<Array<{ number: number; status: string; reason: string; created_at: Date; resolved_at: Date | null }>>`
    SELECT o.number, w.status::text, w.reason, w.created_at, w.resolved_at
    FROM warranty_claims w JOIN service_orders o ON o.id = w.order_id AND o.tenant_id = w.tenant_id
    WHERE w.tenant_id = ${f.tenantId}::uuid ${br(f, 'o.branch_id')} AND w.created_at >= ${f.from} AND w.created_at < ${f.to}
    ORDER BY w.created_at`;
  const [delivered] = await tx.$queryRaw<Array<{ c: bigint }>>`
    SELECT COUNT(*)::bigint AS c FROM service_orders WHERE tenant_id = ${f.tenantId}::uuid ${br(f)} AND delivered_at >= ${f.from} AND delivered_at < ${f.to}`;
  const d = n(delivered?.c);
  return {
    title: 'Garantias e retornos',
    summary: { claims: rows.length, delivered: d, returnRatePercent: d ? Math.round((rows.length / d) * 1000) / 10 : 0 },
    columns: ['OS', 'Status', 'Motivo', 'Aberta em', 'Resolvida em'],
    rows: rows.map((r) => [r.number, WARRANTY_STATUS_LABELS[r.status as WarrantyClaimStatus] ?? r.status, r.reason, r.created_at.toISOString(), r.resolved_at?.toISOString() ?? '—']),
  };
}

export const REPORTS: Record<ReportType, (tx: Tx, f: ReportFilters) => Promise<ReportResult>> = {
  overview: reportOverview,
  'service-orders': reportServiceOrders,
  technicians: reportTechnicians,
  sales: reportSales,
  stock: reportStock,
  cash: reportCash,
  warranties: reportWarranties,
};

/** Relatórios com valores financeiros exigem permissão reports:financial. */
export const FINANCIAL_REPORTS: ReportType[] = ['overview', 'sales', 'cash'];

export function toCsv(result: ReportResult): string {
  const esc = (v: string | number) => {
    const s = String(v);
    // proteção contra injeção de fórmulas em planilhas
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[";\n,]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [result.columns.map(esc).join(';'), ...result.rows.map((r) => r.map(esc).join(';'))];
  return '﻿' + lines.join('\n');
}

export function methodLabel(m: string) {
  return PAYMENT_METHOD_LABELS[m as PaymentMethod] ?? m;
}
