import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import { AppLayout, PlatformLayout, RequireAuth, RequirePerm, RequirePlatform, RequireTenant } from '@/components/layout';
import { Spinner } from '@/components/ui';
import type { Permission } from '@ordemcerta/shared';

function load<T>(factory: () => Promise<T>, name: keyof T) {
  const C = lazy(async () => ({ default: (await factory())[name] as unknown as ComponentType }));
  return (
    <Suspense fallback={<Spinner />}>
      <C />
    </Suspense>
  );
}

const auth = () => import('@/pages/public/auth');
const commercial = () => import('@/pages/public/commercial');
const portal = () => import('@/pages/public/portal');
const dashboard = () => import('@/pages/app/dashboard');
const orders = () => import('@/pages/app/service-orders');
const orderDetail = () => import('@/pages/app/service-order-detail');
const technician = () => import('@/pages/app/technician');
const customers = () => import('@/pages/app/customers');
const pos = () => import('@/pages/app/pos');
const inventory = () => import('@/pages/app/inventory');
const cash = () => import('@/pages/app/cash');
const reports = () => import('@/pages/app/reports');
const warranties = () => import('@/pages/app/warranties');
const messaging = () => import('@/pages/app/messaging');
const settings = () => import('@/pages/app/settings');
const billing = () => import('@/pages/app/billing');
const platform = () => import('@/pages/platform/platform');

const guard = (perm: Permission, el: ReactNode) => <RequirePerm perm={perm}>{el}</RequirePerm>;

export const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/app/dashboard" replace /> },
  { path: '/login', element: load(auth, 'LoginPage') },
  { path: '/forgot-password', element: load(auth, 'ForgotPasswordPage') },
  { path: '/reset-password', element: load(auth, 'ResetPasswordPage') },
  { path: '/invite', element: load(auth, 'InvitePage') },
  { path: '/pricing', element: load(commercial, 'PricingPage') },
  { path: '/planos', element: load(commercial, 'PricingPage') },
  { path: '/signup', element: load(commercial, 'SignupPage') },
  { path: '/cadastro', element: load(commercial, 'SignupPage') },
  { path: '/checkout/cartao', element: load(commercial, 'CheckoutPendingPage') },
  { path: '/checkout/pix', element: load(commercial, 'CheckoutPendingPage') },
  { path: '/checkout/pendente', element: load(commercial, 'CheckoutPendingPage') },
  { path: '/checkout/resultado', element: load(commercial, 'CheckoutResultPage') },
  { path: '/status', element: load(portal, 'StatusPage') },
  { path: '/status/:numero', element: load(portal, 'StatusPage') },
  { path: '/track/:token', element: load(portal, 'StatusPage') },
  { path: '/quote', element: load(portal, 'QuotePage') },
  { path: '/quote/:token', element: load(portal, 'QuotePage') },
  {
    path: '/app',
    element: (
      <RequireAuth>
        <RequireTenant>
          <AppLayout />
        </RequireTenant>
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="dashboard" replace /> },
      { path: 'dashboard', element: load(dashboard, 'DashboardPage') },
      { path: 'onboarding', element: load(settings, 'OnboardingPage') },
      { path: 'service-orders', element: guard('os:view', load(orders, 'ServiceOrdersPage')) },
      { path: 'service-orders/new', element: guard('os:create', load(orders, 'NewServiceOrderPage')) },
      { path: 'service-orders/:id', element: guard('os:view', load(orderDetail, 'ServiceOrderDetailPage')) },
      { path: 'technician/queue', element: guard('os:view', load(technician, 'TechnicianQueuePage')) },
      { path: 'technician/orders/:id', element: guard('os:view', load(orderDetail, 'ServiceOrderDetailPage')) },
      { path: 'customers', element: guard('customer:view', load(customers, 'CustomersPage')) },
      { path: 'customers/:id', element: guard('customer:view', load(customers, 'CustomerDetailPage')) },
      { path: 'sales/pos', element: guard('sales:create', load(pos, 'PosPage')) },
      { path: 'sales', element: guard('sales:view', load(pos, 'SalesPage')) },
      { path: 'products', element: guard('product:view', load(inventory, 'ProductsPage')) },
      { path: 'stock', element: guard('stock:view', load(inventory, 'StockPage')) },
      { path: 'stock/transfers', element: guard('stock:view', load(inventory, 'TransfersPage')) },
      { path: 'cash', element: guard('cash:operate', load(cash, 'CashPage')) },
      { path: 'cash/sessions/:id', element: guard('cash:operate', load(cash, 'CashSessionPage')) },
      { path: 'reports', element: guard('reports:view', load(reports, 'ReportsPage')) },
      { path: 'warranties', element: guard('warranty:view', load(warranties, 'WarrantiesPage')) },
      { path: 'messaging', element: guard('messaging:view', load(messaging, 'MessagingPage')) },
      { path: 'settings/company', element: guard('settings:edit', load(settings, 'CompanySettingsPage')) },
      { path: 'settings/branches', element: guard('branches:manage', load(settings, 'BranchesPage')) },
      { path: 'settings/users', element: guard('users:manage', load(settings, 'UsersPage')) },
      { path: 'settings/documents', element: guard('documents:manage', load(settings, 'DocumentsPage')) },
      { path: 'billing', element: guard('billing:view', load(billing, 'BillingPage')) },
      { path: 'billing/planos', element: guard('billing:view', load(billing, 'BillingPlansPage')) },
      { path: 'billing/faturas/:id', element: guard('billing:view', load(billing, 'InvoicePage')) },
    ],
  },
  {
    path: '/platform',
    element: (
      <RequireAuth>
        <RequirePlatform>
          <PlatformLayout />
        </RequirePlatform>
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="dashboard" replace /> },
      { path: 'dashboard', element: load(platform, 'PlatformDashboardPage') },
      { path: 'tenants', element: load(platform, 'PlatformTenantsPage') },
      { path: 'tenants/:id', element: load(platform, 'PlatformTenantPage') },
      { path: 'plans', element: load(platform, 'PlatformPlansPage') },
      { path: 'subscriptions', element: load(platform, 'PlatformSubscriptionsPage') },
      { path: 'invoices', element: load(platform, 'PlatformInvoicesPage') },
      { path: 'billing-events', element: load(platform, 'PlatformBillingEventsPage') },
      { path: 'reconciliation', element: load(platform, 'PlatformReconciliationPage') },
      { path: 'messaging', element: load(platform, 'PlatformMessagingPage') },
      { path: 'jobs', element: load(platform, 'PlatformJobsPage') },
      { path: 'audit', element: load(platform, 'PlatformAuditPage') },
    ],
  },
  { path: '*', element: <Navigate to="/app/dashboard" replace /> },
]);
