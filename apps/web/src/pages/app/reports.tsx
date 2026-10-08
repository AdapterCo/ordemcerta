import { REPORT_TYPES, type ReportType } from '@ordemcerta/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { QueryState, useAction, useApi } from '@/components/data';
import { Badge, Button, Card, Field, Input, PageHeader, Select, Stat, Table, Td, Th } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatBRL, formatDateTimeBR, toDateInput } from '@/lib/utils';

const LABELS: Record<ReportType, string> = {
  overview: 'Visão geral',
  'service-orders': 'Ordens de serviço',
  technicians: 'Técnicos',
  sales: 'Vendas',
  stock: 'Estoque e peças',
  cash: 'Caixa',
  warranties: 'Garantias',
};
const MONEY = /cents|revenue|receipts|refunds|cogs|margin|total|discount|value|received_|supplies|withdrawals|difference|receivables/i;
const SUMMARY_LABELS: Record<string, string> = {
  revenue: 'Faturamento (competência)',
  serviceRevenue: 'Faturamento de serviços',
  salesRevenue: 'Faturamento de vendas',
  netReceipts: 'Recebimentos líquidos',
  receipts: 'Recebimentos',
  refunds: 'Estornos',
  cogs: 'CMV',
  grossMargin: 'Margem bruta estimada',
  discounts: 'Descontos',
  cashDifference: 'Diferenças de caixa',
};

interface Result {
  title: string;
  summary: Record<string, number | string>;
  columns: string[];
  rows: Array<Array<string | number>>;
}

export function ReportsPage() {
  const { branchId, me, can } = useAuth();
  const [type, setType] = useState<ReportType>('overview');
  const [from, setFrom] = useState(toDateInput(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(toDateInput(new Date()));
  const [branch, setBranch] = useState<string>(branchId ?? '');
  const params = { branchId: branch || undefined, from: new Date(`${from}T00:00:00`).toISOString(), to: new Date(`${to}T23:59:59`).toISOString() };
  const q = useApi<Result>(['report', type], `/reports/${type}`, params);
  const exportsList = useApi<Array<{ id: string; reportType: string; format: string; status: string; createdAt: string }>>(['exports'], can('reports:export') ? '/reports/exports' : null, undefined, { refetchInterval: 10_000 });
  const exp = useAction((format: 'CSV' | 'PDF') => api('/reports/exports', { method: 'POST', body: { reportType: type, format, params } }), { success: 'Exportação solicitada', invalidate: [['exports']] });
  const download = async (id: string) => {
    try {
      const r = await api<{ url: string | null; status: string }>(`/reports/exports/${id}`);
      if (r.url) window.open(r.url, '_blank', 'noopener');
      else toast.info(`Exportação ${r.status === 'FAILED' ? 'falhou' : 'em processamento'}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <div className="space-y-4">
      <PageHeader title="Relatórios" description="Faturamento, recebimento e lucro são apresentados separadamente; saldo de caixa não é receita." />
      <Card>
        <div className="grid gap-3 sm:grid-cols-5">
          <Field label="Relatório" htmlFor="rt">
            <Select id="rt" value={type} onChange={(e) => setType(e.target.value as ReportType)}>
              {REPORT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Filial" htmlFor="rb">
            <Select id="rb" value={branch} onChange={(e) => setBranch(e.target.value)}>
              {me?.current?.allBranches && <option value="">Todas</option>}
              {me?.current?.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="De" htmlFor="rf">
            <Input id="rf" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Até" htmlFor="rto">
            <Input id="rto" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          {can('reports:export') && (
            <div className="flex items-end gap-2">
              <Button variant="secondary" loading={exp.isPending} onClick={() => exp.mutate('CSV')}>
                CSV
              </Button>
              <Button variant="secondary" loading={exp.isPending} onClick={() => exp.mutate('PDF')}>
                PDF
              </Button>
            </div>
          )}
        </div>
      </Card>
      <QueryState loading={q.isLoading} error={q.error}>
        {q.data && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {Object.entries(q.data.summary).map(([k, v]) => (
                <Stat key={k} label={SUMMARY_LABELS[k] ?? k} value={typeof v === 'number' && MONEY.test(k) ? formatBRL(v) : v} />
              ))}
            </div>
            <Table>
              <thead>
                <tr>
                  {q.data.columns.map((c) => (
                    <Th key={c}>{c}</Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {q.data.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((c, j) => (
                      <Td key={j}>{typeof c === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(c) ? formatDateTimeBR(c) : c}</Td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </Table>
          </>
        )}
      </QueryState>
      {can('reports:export') && exportsList.data && exportsList.data.length > 0 && (
        <Card title="Minhas exportações">
          <ul className="space-y-1 text-sm">
            {exportsList.data.map((e) => (
              <li key={e.id} className="flex items-center justify-between">
                <span>
                  {LABELS[e.reportType as ReportType]} · {e.format} · {formatDateTimeBR(e.createdAt)} <Badge tone={e.status === 'DONE' ? 'green' : e.status === 'FAILED' ? 'red' : 'yellow'}>{e.status}</Badge>
                </span>
                {e.status === 'DONE' && (
                  <Button size="sm" variant="secondary" onClick={() => void download(e.id)}>
                    Baixar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
