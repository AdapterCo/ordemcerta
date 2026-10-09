import type { TechnicalStatus } from '@ordemcerta/shared';
import {
  AlarmClock,
  ArrowRight,
  Boxes,
  CircleDollarSign,
  ClipboardList,
  Clock,
  HandCoins,
  PackageCheck,
  PackageOpen,
  Plus,
  Receipt,
  ShoppingCart,
  TrendingUp,
  UserPlus,
  Wallet,
  Wrench,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { QueryState, StatusBadge, useApi } from '@/components/data';
import { EmptyState, Stat } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { formatBRL, formatDateTimeBR } from '@/lib/utils';

interface DashboardDto {
  kpis: Record<string, number>;
  recent: Array<{ id: string; number: number; technicalStatus: TechnicalStatus; createdAt: string; customer: { name: string }; device: { brand: string; model: string } }>;
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

function QuickAction({ to, icon, title, hint, primary }: { to: string; icon: ReactNode; title: string; hint: string; primary?: boolean }) {
  return (
    <Link
      to={to}
      className={
        primary
          ? 'group relative flex items-center gap-4 overflow-hidden rounded-2xl bg-brand-700 p-4 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.15)] transition-all hover:-translate-y-0.5 hover:bg-brand-800 hover:shadow-lift'
          : 'group flex items-center gap-4 rounded-2xl border border-line bg-white p-4 shadow-card transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lift'
      }
    >
      <span className={primary ? 'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15' : 'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700'}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[15px] font-semibold">{title}</span>
        <span className={primary ? 'block truncate text-xs text-white/70' : 'block truncate text-xs text-ink-600/70'}>{hint}</span>
      </span>
      <ArrowRight className={primary ? 'h-4 w-4 text-white/60 transition-transform group-hover:translate-x-0.5' : 'h-4 w-4 text-ink-600/30 transition-all group-hover:translate-x-0.5 group-hover:text-brand-600'} />
    </Link>
  );
}

function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-2">
      <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-600/70">{children}</h2>
      {aside}
    </div>
  );
}

export function DashboardPage() {
  const { me, can, branchId } = useAuth();
  const q = useApi<DashboardDto>(['dashboard', branchId], '/dashboard', { branchId: branchId ?? undefined });
  const k = q.data?.kpis ?? {};
  const money = (key: string) => (k[key] !== undefined ? formatBRL(k[key]) : null);
  const firstName = me?.user.name.split(' ')[0] ?? '';
  const branchName = me?.current?.branches.find((b) => b.id === branchId)?.name;
  const today = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const icon = 'h-[18px] w-[18px]';

  return (
    <div className="stagger space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-700">{today}</p>
          <h1 className="mt-1 font-display text-[32px] font-bold leading-tight text-ink-950">
            {greeting()}, {firstName}
          </h1>
          <p className="mt-1 text-sm text-ink-600/80">Resumo dos últimos 30 dias{branchName ? ` · ${branchName}` : ''}</p>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {can('os:create') && <QuickAction primary to="/app/service-orders/new" icon={<Plus className="h-5 w-5" />} title="Nova OS" hint="Receber um aparelho" />}
        {can('sales:create') && <QuickAction to="/app/sales/pos" icon={<ShoppingCart className="h-5 w-5" />} title="Nova venda" hint="Abrir o PDV" />}
        {can('customer:edit') && <QuickAction to="/app/customers?new=1" icon={<UserPlus className="h-5 w-5" />} title="Novo cliente" hint="Cadastrar cliente" />}
        {can('cash:operate') && <QuickAction to="/app/cash" icon={<Wallet className="h-5 w-5" />} title="Caixa" hint="Abrir, conferir e fechar" />}
      </section>

      <QueryState loading={q.isLoading} error={q.error} retry={() => void q.refetch()}>
        <section>
          <SectionTitle>Oficina</SectionTitle>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="OS abertas" value={k.osOpen ?? 0} icon={<ClipboardList className={icon} />} />
            <Stat label="Aguardando aprovação" value={k.osWaitingApproval ?? 0} tone={k.osWaitingApproval ? 'yellow' : undefined} icon={<Clock className={icon} />} />
            <Stat label="Aguardando peças" value={k.osWaitingParts ?? 0} icon={<PackageOpen className={icon} />} />
            <Stat label="Em execução" value={k.osInRepair ?? 0} icon={<Wrench className={icon} />} />
            <Stat label="Prontas" value={k.osReady ?? 0} tone="green" icon={<PackageCheck className={icon} />} />
            <Stat label="Não retiradas (+3 dias)" value={k.osNotPickedUp ?? 0} tone={k.osNotPickedUp ? 'yellow' : undefined} icon={<AlarmClock className={icon} />} />
            <Stat label="Atrasadas" value={k.osOverdue ?? 0} tone={k.osOverdue ? 'red' : undefined} icon={<AlarmClock className={icon} />} />
            <Stat label="Alertas de estoque" value={k.stockAlerts ?? 0} tone={k.stockAlerts ? 'yellow' : undefined} icon={<Boxes className={icon} />} />
          </div>
        </section>

        {(money('netReceipts') || money('revenue') || k.salesCount !== undefined) && (
          <section className="mt-8">
            <SectionTitle>Financeiro</SectionTitle>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {money('netReceipts') && <Stat label="Recebido (líquido)" value={money('netReceipts')} hint="Recebimentos − estornos" icon={<HandCoins className={icon} />} />}
              {money('revenue') && <Stat label="Faturamento" value={money('revenue')} hint="Serviços entregues + vendas" icon={<CircleDollarSign className={icon} />} />}
              {money('grossMargin') && <Stat label="Margem bruta" value={money('grossMargin')} hint="Faturamento − custos" tone="green" icon={<TrendingUp className={icon} />} />}
              {k.salesCount !== undefined && <Stat label="Vendas" value={k.salesCount} hint={money('salesTotal') ?? undefined} icon={<Receipt className={icon} />} />}
              {money('receivablesOpen') && <Stat label="A receber" value={money('receivablesOpen')} icon={<HandCoins className={icon} />} />}
              <Stat label="Caixas abertos" value={k.openCashSessions ?? 0} icon={<Wallet className={icon} />} />
            </div>
          </section>
        )}

        <section className="mt-8">
          <SectionTitle
            aside={
              can('os:view') && (
                <Link to="/app/service-orders" className="text-sm font-semibold text-brand-700 hover:text-brand-800">
                  Ver todas →
                </Link>
              )
            }
          >
            OS recentes
          </SectionTitle>
          {!q.data?.recent.length ? (
            <EmptyState title="Nenhuma OS ainda">Abra a primeira ordem de serviço pelo botão “Nova OS”.</EmptyState>
          ) : (
            <ul className="divide-y divide-line/70 overflow-hidden rounded-2xl border border-line bg-white shadow-card">
              {q.data.recent.map((o) => (
                <li key={o.id}>
                  <Link to={`/app/service-orders/${o.id}`} className="group flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 transition-colors hover:bg-brand-50/40">
                    <span className="num w-16 shrink-0 text-sm font-semibold text-brand-700">#{o.number}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-ink-900">{o.customer.name}</span>
                      <span className="block truncate text-xs text-ink-600/70">
                        {o.device.brand} {o.device.model}
                      </span>
                    </span>
                    <StatusBadge status={o.technicalStatus} />
                    <span className="num hidden w-36 text-right text-xs text-ink-600/60 sm:block">{formatDateTimeBR(o.createdAt)}</span>
                    <ArrowRight className="hidden h-4 w-4 text-ink-600/25 transition-all group-hover:translate-x-0.5 group-hover:text-brand-600 sm:block" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </QueryState>
    </div>
  );
}
