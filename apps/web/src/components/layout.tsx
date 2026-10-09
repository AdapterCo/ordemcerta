import type { Permission } from '@ordemcerta/shared';
import {
  BarChart3,
  Boxes,
  Building2,
  CreditCard,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  Package,
  Plus,
  Receipt,
  Search,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Users,
  Wallet,
  Wrench,
  X,
  ArrowLeftRight,
  ClipboardList,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '@/lib/auth';
import { useRealtime } from '@/lib/realtime';
import { cn, formatDateTimeBR, MESSAGING_STATUS_LABELS, SUBSCRIPTION_STATUS_LABELS } from '@/lib/utils';
import { useApi } from './data';
import { Alert, Badge, Button, Select, Spinner } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  perm?: Permission;
  anyPerm?: Permission[];
}

const NAV: Array<{ group?: string; items: NavItem[] }> = [
  {
    items: [
      { to: '/app/dashboard', label: 'Painel', icon: <LayoutDashboard className="h-4 w-4" /> },
      { to: '/app/service-orders/new', label: 'Nova OS', icon: <Plus className="h-4 w-4" />, perm: 'os:create' },
      { to: '/app/service-orders', label: 'Ordens de serviço', icon: <ClipboardList className="h-4 w-4" />, perm: 'os:view' },
      { to: '/app/technician/queue', label: 'Fila técnica', icon: <Wrench className="h-4 w-4" />, anyPerm: ['os:diagnose', 'os:repair'] },
      { to: '/app/customers', label: 'Clientes', icon: <Users className="h-4 w-4" />, perm: 'customer:view' },
      { to: '/app/warranties', label: 'Garantias', icon: <ShieldCheck className="h-4 w-4" />, perm: 'warranty:view' },
    ],
  },
  {
    group: 'Loja',
    items: [
      { to: '/app/sales/pos', label: 'PDV', icon: <ShoppingCart className="h-4 w-4" />, perm: 'sales:create' },
      { to: '/app/sales', label: 'Vendas', icon: <Receipt className="h-4 w-4" />, perm: 'sales:view' },
      { to: '/app/cash', label: 'Caixa', icon: <Wallet className="h-4 w-4" />, perm: 'cash:operate' },
      { to: '/app/products', label: 'Produtos', icon: <Package className="h-4 w-4" />, perm: 'product:view' },
      { to: '/app/stock', label: 'Estoque', icon: <Boxes className="h-4 w-4" />, perm: 'stock:view' },
      { to: '/app/stock/transfers', label: 'Transferências', icon: <ArrowLeftRight className="h-4 w-4" />, perm: 'stock:view' },
    ],
  },
  {
    group: 'Gestão',
    items: [
      { to: '/app/reports', label: 'Relatórios', icon: <BarChart3 className="h-4 w-4" />, perm: 'reports:view' },
      { to: '/app/messaging', label: 'WhatsApp', icon: <MessageCircle className="h-4 w-4" />, perm: 'messaging:view' },
      { to: '/app/settings/company', label: 'Empresa', icon: <Settings className="h-4 w-4" />, perm: 'settings:edit' },
      { to: '/app/settings/branches', label: 'Filiais', icon: <Building2 className="h-4 w-4" />, perm: 'branches:manage' },
      { to: '/app/settings/users', label: 'Usuários', icon: <Users className="h-4 w-4" />, perm: 'users:manage' },
      { to: '/app/settings/documents', label: 'Documentos', icon: <FileText className="h-4 w-4" />, perm: 'documents:manage' },
      { to: '/app/billing', label: 'Assinatura', icon: <CreditCard className="h-4 w-4" />, perm: 'billing:view' },
    ],
  },
];

function WhatsAppBadge() {
  const { data } = useApi<Array<{ id: string; status: keyof typeof MESSAGING_STATUS_LABELS }>>(['messaging-channels'], '/messaging/channels');
  if (!data?.length) return null;
  const active = data.some((c) => c.status === 'ACTIVE');
  return (
    <Link to="/app/messaging" title="Conexão WhatsApp">
      <Badge tone={active ? 'green' : 'yellow'}>
        <MessageCircle className="mr-1 h-3 w-3" /> {active ? 'WhatsApp ativo' : MESSAGING_STATUS_LABELS[data[0]!.status]}
      </Badge>
    </Link>
  );
}

function SubscriptionBanner() {
  const { me } = useAuth();
  const s = me?.current?.subscription;
  if (!s) return null;
  if (!s.operational) {
    return (
      <div className="no-print px-4 pt-3">
        <Alert tone="red" title={`Assinatura: ${SUBSCRIPTION_STATUS_LABELS[s.status as keyof typeof SUBSCRIPTION_STATUS_LABELS] ?? s.status}`}>
          Novas OS, vendas e movimentações estão bloqueadas. Seus dados estão preservados e disponíveis para consulta.{' '}
          {me?.current?.permissions.includes('billing:view') && (
            <Link className="font-semibold underline" to="/app/billing">
              Regularizar
            </Link>
          )}
        </Alert>
      </div>
    );
  }
  if (s.status === 'PAST_DUE') {
    return (
      <div className="no-print px-4 pt-3">
        <Alert tone="yellow" title="Pagamento em atraso">
          A operação continua até {formatDateTimeBR(s.graceUntil)}.{' '}
          <Link className="font-semibold underline" to="/app/billing">
            Pagar agora
          </Link>
        </Alert>
      </div>
    );
  }
  return null;
}

export function AppLayout() {
  const { me, can, logout, branchId, setBranchId, switchTenant } = useAuth();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  useRealtime();
  const current = me!.current!;
  const visible = (i: NavItem) => (!i.perm || can(i.perm)) && (!i.anyPerm || i.anyPerm.some((p) => can(p)));

  const sidebar = (
    <nav className="flex h-full flex-col gap-4 overflow-y-auto p-3" aria-label="Navegação principal">
      <Link to="/app/dashboard" className="px-2 text-lg font-bold text-brand-800">
        OrdemCerta
      </Link>
      {NAV.map((g, i) => {
        const items = g.items.filter(visible);
        if (!items.length) return null;
        return (
          <div key={i}>
            {g.group && <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{g.group}</p>}
            <ul className="space-y-0.5">
              {items.map((it) => (
                <li key={it.to}>
                  <NavLink
                    to={it.to}
                    end={it.to === '/app/service-orders' || it.to === '/app/sales' || it.to === '/app/stock'}
                    onClick={() => setOpen(false)}
                    className={({ isActive }) =>
                      cn('flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100', isActive && 'bg-brand-50 font-semibold text-brand-800')
                    }
                  >
                    {it.icon}
                    {it.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="no-print hidden w-60 shrink-0 border-r border-slate-200 bg-white lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-white shadow-xl">{sidebar}</aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
          <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menu">
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
          {me!.tenants.length > 1 ? (
            <Select aria-label="Empresa" className="h-9 w-auto max-w-48" value={current.tenant.id} onChange={(e) => void switchTenant(e.target.value)}>
              {me!.tenants.map((t) => (
                <option key={t.tenantId} value={t.tenantId}>
                  {t.name}
                </option>
              ))}
            </Select>
          ) : (
            <span className="text-sm font-semibold text-slate-800">{current.tenant.name}</span>
          )}
          {current.branches.length > 0 && (
            <Select aria-label="Filial" className="h-9 w-auto max-w-44" value={branchId ?? ''} onChange={(e) => setBranchId(e.target.value)}>
              {current.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          )}
          {can('os:view') && (
            <form
              role="search"
              className="relative min-w-40 flex-1 sm:max-w-sm"
              onSubmit={(e) => {
                e.preventDefault();
                if (q.trim()) navigate(`/app/service-orders?q=${encodeURIComponent(q.trim())}`);
              }}
            >
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                aria-label="Busca global"
                className="h-9 w-full rounded-md border border-slate-300 pl-8 pr-3 text-sm"
                placeholder="OS, cliente, telefone, IMEI (4 últimos)…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </form>
          )}
          <div className="ml-auto flex items-center gap-2">
            {can('messaging:view') && <WhatsAppBadge />}
            {current.supportAccess && <Badge tone="purple">Acesso de suporte (somente leitura)</Badge>}
            <span className="hidden text-sm text-slate-600 sm:inline">{me!.user.name}</span>
            <Button variant="ghost" size="sm" onClick={() => void logout()} aria-label="Sair">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>
        <SubscriptionBanner />
        <main className="flex-1 p-4">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

const PLATFORM_NAV = [
  { to: '/platform/dashboard', label: 'Métricas' },
  { to: '/platform/tenants', label: 'Empresas' },
  { to: '/platform/plans', label: 'Planos' },
  { to: '/platform/subscriptions', label: 'Assinaturas' },
  { to: '/platform/invoices', label: 'Faturas' },
  { to: '/platform/billing-events', label: 'Notificações MP' },
  { to: '/platform/reconciliation', label: 'Reconciliação' },
  { to: '/platform/messaging', label: 'WhatsApp (faturamento)' },
  { to: '/platform/jobs', label: 'Filas de processamento' },
  { to: '/platform/audit', label: 'Auditoria' },
];

export function PlatformLayout() {
  const { logout, me } = useAuth();
  return (
    <div className="min-h-screen">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-900 px-4 py-2 text-white">
        <span className="font-bold">OrdemCerta · Plataforma</span>
        <nav className="flex flex-wrap gap-1" aria-label="Plataforma">
          {PLATFORM_NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => cn('rounded px-2 py-1 text-sm hover:bg-slate-700', isActive && 'bg-slate-700')}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <span className="ml-auto text-sm text-slate-300">{me?.user.email}</span>
        <Button size="sm" variant="secondary" onClick={() => void logout()}>
          Sair
        </Button>
      </header>
      <main className="p-4">
        <Outlet />
      </main>
    </div>
  );
}

export function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <Link to="/" className="text-lg font-bold text-brand-800">
          OrdemCerta
        </Link>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 p-4">{children}</main>
      <footer className="border-t border-slate-200 bg-white px-4 py-3 text-center text-xs text-slate-500">OrdemCerta — gestão de assistências técnicas</footer>
    </div>
  );
}

/* ----------------------------------------------------------------- guards */

export function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner />;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

export function RequireTenant({ children }: { children: ReactNode }) {
  const { me, switchTenant } = useAuth();
  const loc = useLocation();
  if (me!.user.platformRole && !me!.current) return <Navigate to="/platform/dashboard" replace />;
  if (!me!.current) {
    return (
      <PublicLayout>
        <h1 className="mb-3 text-lg font-semibold">Selecione a empresa</h1>
        {me!.tenants.length ? (
          <ul className="space-y-2">
            {me!.tenants.map((t) => (
              <li key={t.tenantId}>
                <Button variant="secondary" onClick={() => void switchTenant(t.tenantId)}>
                  {t.name}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-600">
            Seu usuário não está vinculado a nenhuma empresa. <Link className="underline" to="/pricing">Conheça os planos</Link>.
          </p>
        )}
      </PublicLayout>
    );
  }
  const sub = me!.current.subscription;
  const path = loc.pathname;
  const billingPath = path.startsWith('/app/billing');
  if (sub?.status === 'PENDING_PAYMENT' && !billingPath) return <Navigate to="/app/billing" replace />;
  if (
    sub?.operational &&
    !me!.current.tenant.onboardingCompletedAt &&
    me!.current.role === 'TENANT_OWNER' &&
    !billingPath &&
    !path.startsWith('/app/onboarding') &&
    !path.startsWith('/app/settings')
  ) {
    return <Navigate to="/app/onboarding" replace />;
  }
  return <>{children}</>;
}

export function RequirePerm({ perm, children }: { perm: Permission; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(perm)) return <Alert tone="red" title="Acesso negado">Seu perfil não tem permissão para esta tela.</Alert>;
  return <>{children}</>;
}

export function RequirePlatform({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  if (me?.user.platformRole !== 'PLATFORM_SUPERADMIN') return <Navigate to="/app/dashboard" replace />;
  return <>{children}</>;
}
