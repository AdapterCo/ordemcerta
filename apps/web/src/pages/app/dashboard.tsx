import { Link } from 'react-router';
import type { TechnicalStatus } from '@ordemcerta/shared';
import { QueryState, StatusBadge, useApi } from '@/components/data';
import { Button, Card, PageHeader, Stat, Table, Td, Th } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { formatBRL, formatDateTimeBR } from '@/lib/utils';

interface DashboardDto {
  kpis: Record<string, number>;
  recent: Array<{ id: string; number: number; technicalStatus: TechnicalStatus; createdAt: string; customer: { name: string }; device: { brand: string; model: string } }>;
}

export function DashboardPage() {
  const { can, branchId } = useAuth();
  const q = useApi<DashboardDto>(['dashboard', branchId], '/dashboard', { branchId: branchId ?? undefined });
  const k = q.data?.kpis ?? {};
  const money = (key: string) => (k[key] !== undefined ? formatBRL(k[key]) : null);
  return (
    <div>
      <PageHeader
        title="Painel"
        description="Últimos 30 dias na filial selecionada"
        actions={
          <>
            {can('os:create') && (
              <Link to="/app/service-orders/new">
                <Button>Nova OS</Button>
              </Link>
            )}
            {can('sales:create') && (
              <Link to="/app/sales/pos">
                <Button variant="secondary">Nova venda</Button>
              </Link>
            )}
            {can('customer:edit') && (
              <Link to="/app/customers?new=1">
                <Button variant="secondary">Novo cliente</Button>
              </Link>
            )}
            {can('cash:operate') && (
              <Link to="/app/cash">
                <Button variant="secondary">Abrir caixa</Button>
              </Link>
            )}
          </>
        }
      />
      <QueryState loading={q.isLoading} error={q.error} retry={() => void q.refetch()}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="OS abertas" value={k.osOpen ?? 0} />
          <Stat label="Aguardando aprovação" value={k.osWaitingApproval ?? 0} tone={k.osWaitingApproval ? 'yellow' : undefined} />
          <Stat label="Aguardando peças" value={k.osWaitingParts ?? 0} />
          <Stat label="Em execução" value={k.osInRepair ?? 0} />
          <Stat label="Prontas" value={k.osReady ?? 0} tone="green" />
          <Stat label="Não retiradas (+3 dias)" value={k.osNotPickedUp ?? 0} tone={k.osNotPickedUp ? 'yellow' : undefined} />
          <Stat label="Atrasadas" value={k.osOverdue ?? 0} tone={k.osOverdue ? 'red' : undefined} />
          <Stat label="Alertas de estoque" value={k.stockAlerts ?? 0} tone={k.stockAlerts ? 'yellow' : undefined} />
          {money('netReceipts') && <Stat label="Recebido (líquido)" value={money('netReceipts')} hint="Recebimentos − estornos" />}
          {money('revenue') && <Stat label="Faturamento (competência)" value={money('revenue')} hint="Serviços entregues + vendas" />}
          {money('grossMargin') && <Stat label="Margem bruta estimada" value={money('grossMargin')} hint="Faturamento − CMV" />}
          {k.salesCount !== undefined && <Stat label="Vendas" value={k.salesCount} hint={money('salesTotal') ?? undefined} />}
          <Stat label="Caixas abertos" value={k.openCashSessions ?? 0} />
          {money('receivablesOpen') && <Stat label="A receber" value={money('receivablesOpen')} />}
        </div>
        <Card title="OS recentes" className="mt-4">
          <Table>
            <thead>
              <tr>
                <Th>OS</Th>
                <Th>Cliente</Th>
                <Th>Aparelho</Th>
                <Th>Status</Th>
                <Th>Entrada</Th>
              </tr>
            </thead>
            <tbody>
              {q.data?.recent.map((o) => (
                <tr key={o.id} className="hover:bg-slate-50">
                  <Td>
                    <Link className="font-medium text-brand-700 underline" to={`/app/service-orders/${o.id}`}>
                      {o.number}
                    </Link>
                  </Td>
                  <Td>{o.customer.name}</Td>
                  <Td>
                    {o.device.brand} {o.device.model}
                  </Td>
                  <Td>
                    <StatusBadge status={o.technicalStatus} />
                  </Td>
                  <Td>{formatDateTimeBR(o.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </QueryState>
    </div>
  );
}
