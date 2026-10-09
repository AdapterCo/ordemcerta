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
  const loc = useLocation();
  useRealtime();
  const current = me!.current!;
  const visible = (i: NavItem) => (!i.perm || can(i.perm)) && (!i.anyPerm || i.anyPerm.some((p) => can(p)));

  const initials = me!.user.name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

  const sidebar = (
    <nav className="blueprint flex h-full flex-col overflow-y-auto bg-ink-900 text-white/80" aria-label="Navegação principal">
      <Link to="/app/dashboard" className="flex items-center gap-2.5 px-5 pb-5 pt-6" onClick={() => setOpen(false)}>
        <BrandMark className="h-8 w-8" />
        <span className="font-display text-[19px] font-bold tracking-tight text-white">OrdemCerta</span>
      </Link>
      <div className="flex-1 space-y-6 px-3 pb-6">
        {NAV.map((g, i) => {
          const items = g.items.filter(visible);
          if (!items.length) return null;
          return (
            <div key={i}>
              {g.group && <p className="mb-1.5 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-white/35">{g.group}</p>}
              <ul className="space-y-0.5">
                {items.map((it) => (
                  <li key={it.to}>
                    <NavLink
                      to={it.to}
                      end={it.to === '/app/service-orders' || it.to === '/app/sales' || it.to === '/app/stock'}
                      onClick={() => setOpen(false)}
                      className={({ isActive }) =>
                        cn(
                          'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors',
                          isActive ? 'bg-white/[0.09] text-white' : 'text-white/65 hover:bg-white/[0.05] hover:text-white',
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && <span aria-hidden className="absolute -left-3 top-1.5 bottom-1.5 w-1 rounded-r-full bg-brand-400 shadow-[0_0_12px_var(--color-teal-400)]" />}
                          <span className={cn('transition-colors', isActive ? 'text-brand-300' : 'text-white/45 group-hover:text-white/80')}>{it.icon}</span>
                          {it.label}
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="border-t border-white/[0.08] px-4 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-500/20 font-mono text-xs font-semibold text-brand-200">{initials}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">{me!.user.name}</p>
            <p className="truncate text-xs text-white/45">{current.tenant.name}</p>
          </div>
          <button type="button" onClick={() => void logout()} aria-label="Sair" title="Sair" className="rounded-lg p-2 text-white/50 transition-colors hover:bg-white/10 hover:text-white">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="no-print sticky top-0 hidden h-screen w-64 shrink-0 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 animate-fade bg-ink-950/50 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 animate-enter shadow-2xl">{sidebar}</aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex flex-wrap items-center gap-2 border-b border-line/80 bg-paper/80 px-4 py-2.5 backdrop-blur-md">
          <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menu">
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
          {me!.tenants.length > 1 ? (
            <Select aria-label="Empresa" className="h-9 w-auto max-w-48 font-semibold" value={current.tenant.id} onChange={(e) => void switchTenant(e.target.value)}>
              {me!.tenants.map((t) => (
                <option key={t.tenantId} value={t.tenantId}>
                  {t.name}
                </option>
              ))}
            </Select>
          ) : (
            <span className="hidden font-display text-[15px] font-semibold text-ink-900 sm:inline">{current.tenant.name}</span>
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
              className="relative min-w-40 flex-1 sm:max-w-md"
              onSubmit={(e) => {
                e.preventDefault();
                if (q.trim()) navigate(`/app/service-orders?q=${encodeURIComponent(q.trim())}`);
              }}
            >
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-600/50" aria-hidden />
              <input
                aria-label="Busca global"
                className="h-9 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm shadow-[inset_0_1px_1px_rgb(16_48_47/0.04)] placeholder:text-ink-600/45 focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-500/15"
                placeholder="Buscar OS, cliente, telefone ou IMEI…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </form>
          )}
          <div className="ml-auto flex items-center gap-2">
            {can('messaging:view') && <WhatsAppBadge />}
            {current.supportAccess && <Badge tone="purple">Acesso de suporte (somente leitura)</Badge>}
            {can('os:create') && (
              <Link to="/app/service-orders/new" className="hidden sm:block">
                <Button size="sm">
                  <Plus className="h-4 w-4" /> Nova OS
                </Button>
              </Link>
            )}
          </div>
        </header>
        <SubscriptionBanner />
        <main key={loc.pathname} className="mx-auto w-full max-w-[1400px] flex-1 animate-enter px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** Marca: círculo verde-água com o "certo" (mesma do vídeo e do favicon). */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <circle cx="24" cy="24" r="22" fill="#14b8a6" />
      <path d="M14 25l7 7 14-15" stroke="#fff" strokeWidth="4.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
  const loc = useLocation();
  return (
    <div className="min-h-screen">
      <header className="blueprint sticky top-0 z-30 bg-ink-900 text-white">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <Link to="/platform/dashboard" className="flex items-center gap-2.5">
            <BrandMark className="h-7 w-7" />
            <span className="font-display text-[17px] font-bold">OrdemCerta</span>
            <span className="rounded-md bg-signal-500/20 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-signal-400">Plataforma</span>
          </Link>
          <span className="ml-auto hidden text-sm text-white/55 sm:inline">{me?.user.email}</span>
          <button type="button" onClick={() => void logout()} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white">
            <LogOut className="h-4 w-4" /> Sair
          </button>
        </div>
        <nav className="mx-auto flex max-w-[1400px] gap-1 overflow-x-auto px-4 pb-2 sm:px-6 lg:px-8" aria-label="Plataforma">
          {PLATFORM_NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                cn('whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors', isActive ? 'bg-white/[0.12] text-white' : 'text-white/60 hover:bg-white/[0.06] hover:text-white')
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main key={loc.pathname} className="mx-auto w-full max-w-[1400px] animate-enter px-4 py-6 sm:px-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}

export function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line/80 bg-white/70 px-4 py-3 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center">
          <Link to="/" className="flex items-center gap-2">
            <BrandMark className="h-7 w-7" />
            <span className="font-display text-lg font-bold text-ink-950">OrdemCerta</span>
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 animate-enter p-4 sm:py-8">{children}</main>
      <footer className="border-t border-line/80 px-4 py-4 text-center text-xs text-ink-600/60">OrdemCerta · gestão de assistências técnicas</footer>
    </div>
  );
}

/** Tela de entrada (login, senha): painel da marca à esquerda, formulário à direita. */
export function AuthLayout({ children, title, subtitle }: { children: ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <aside className="blueprint relative hidden overflow-hidden bg-ink-900 p-12 text-white lg:flex lg:flex-col">
        <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-brand-500/25 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 right-0 h-[28rem] w-[28rem] rounded-full bg-sky-500/15 blur-3xl" />
        <Link to="/" className="relative flex items-center gap-3">
          <BrandMark className="h-10 w-10" />
          <span className="font-display text-2xl font-bold">OrdemCerta</span>
        </Link>
        <div className="relative mt-auto max-w-lg">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-brand-300">Gestão de assistência técnica</p>
          <p className="mt-4 font-display text-[44px] font-bold leading-[1.05]">Do balcão à entrega, tudo no lugar certo.</p>
          <ul className="mt-8 space-y-3 text-[15px] text-white/75">
            {['OS digital com assinatura no celular do cliente', 'Acompanhamento online e orçamento pelo link', 'PDV, caixa, estoque e margem real por serviço'].map((t) => (
              <li key={t} className="flex items-center gap-3">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-500/25 text-brand-300">✓</span>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative mt-12 text-xs text-white/35">© OrdemCerta</p>
      </aside>
      <main className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-[400px] animate-enter">
          <Link to="/" className="mb-8 flex items-center gap-2.5 lg:hidden">
            <BrandMark className="h-9 w-9" />
            <span className="font-display text-xl font-bold text-ink-950">OrdemCerta</span>
          </Link>
          <h1 className="font-display text-[30px] font-bold leading-tight text-ink-950">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-ink-600/80">{subtitle}</p>}
          <div className="mt-7">{children}</div>
        </div>
      </main>
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
