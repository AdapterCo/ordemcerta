import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Pagination, QueryState, useAction, useApi } from '@/components/data';
import { Badge, Button, Card, ConfirmDialog, Dialog, Field, Input, MoneyInput, PageHeader, Select, Stat, Table, Td, Textarea, Th } from '@/components/ui';
import { api, type Paginated } from '@/lib/api';
import { formatBRL, formatDateBR, formatDateTimeBR, SUBSCRIPTION_STATUS_LABELS } from '@/lib/utils';

/* eslint-disable @typescript-eslint/no-explicit-any */

const INTEGRATION_LABELS: Record<string, string> = {
  mail: 'E-mail (SMTP)',
  mercadoPago: 'Mercado Pago',
  whatsappCloud: 'WhatsApp Cloud API (Meta)',
  whatsappEmbeddedSignup: 'WhatsApp — cadastro incorporado',
};
const QUEUE_LABELS: Record<string, string> = {
  outbox: 'Eventos internos',
  messaging: 'Mensagens de WhatsApp',
  email: 'E-mails',
  exports: 'Exportações de relatórios',
  billing: 'Cobrança (Mercado Pago)',
  maintenance: 'Manutenção automática',
};
const COUNT_LABELS: Array<[string, string]> = [
  ['waiting', 'Aguardando'],
  ['active', 'Em execução'],
  ['delayed', 'Agendados'],
  ['failed', 'Com falha'],
  ['paused', 'Pausados'],
];

function QueueTable({ jobs }: { jobs: Record<string, Record<string, number> | { counts: Record<string, number> }> }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Fila</Th>
          {COUNT_LABELS.map(([, l]) => (
            <Th key={l}>{l}</Th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Object.entries(jobs).map(([name, raw]) => {
          const c = ('counts' in raw ? raw.counts : raw) as Record<string, number>;
          return (
            <tr key={name}>
              <Td>{QUEUE_LABELS[name] ?? name}</Td>
              {COUNT_LABELS.map(([k]) => (
                <Td key={k} className={k === 'failed' && c[k] ? 'font-semibold text-red-700' : undefined}>
                  {c[k] ?? 0}
                </Td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

export function PlatformDashboardPage() {
  const q = useApi<any>(['pf-metrics'], '/platform/metrics', undefined, { refetchInterval: 60_000 });
  const settings = useApi<{ graceDays: number }>(['pf-settings'], '/platform/settings');
  const [grace, setGrace] = useState<number | ''>('');
  const save = useAction((_: void) => api('/platform/settings', { method: 'PUT', body: { graceDays: Number(grace) } }), { success: 'Política atualizada', invalidate: [['pf-settings']] });
  const m = q.data;
  return (
    <div className="space-y-4">
      <PageHeader title="Métricas da plataforma" />
      <QueryState loading={q.isLoading} error={q.error}>
        {m && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="MRR" value={formatBRL(m.mrrCents)} />
              <Stat label="Empresas ativas" value={m.tenants.active} />
              <Stat label="Aguardando pagamento" value={m.tenants.pendingPayment} />
              <Stat label="Inadimplentes (tolerância)" value={m.tenants.pastDue} tone={m.tenants.pastDue ? 'yellow' : undefined} />
              <Stat label="Suspensas" value={m.tenants.suspended} tone={m.tenants.suspended ? 'red' : undefined} />
              <Stat label="Churn 30 dias" value={`${m.churn30d} (${m.churnRatePercent}%)`} />
              <Stat label="Assinaturas no banco" value={`${(m.storageBytes / 1024 / 1024).toFixed(1)} MB`} />
              <Stat label="Mensagens 30 dias" value={m.messagesSent30d} />
              <Stat label="Filiais ativas" value={m.activeBranches} />
              <Stat label="Usuários ativos" value={m.activeUsers} />
              <Stat label="Webhooks com falha" value={m.billing.failedWebhooks} tone={m.billing.failedWebhooks ? 'red' : undefined} />
              <Stat label="Pendências de reconciliação (30d)" value={m.billing.reconciliationIssues30d} tone={m.billing.reconciliationIssues30d ? 'yellow' : undefined} />
            </div>
            <Card title="Integrações e provedores">
              <ul className="grid gap-1 text-sm sm:grid-cols-3">
                {Object.entries(m.integrations).map(([k, v]) => (
                  <li key={k}>
                    {v ? '✅' : '⛔'} {INTEGRATION_LABELS[k] ?? k} <span className="text-xs text-slate-500">({v ? 'configurado' : 'não configurado'})</span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Filas de processamento">
              <QueueTable jobs={m.jobs} />
            </Card>
          </>
        )}
      </QueryState>
      <Card title="Política de inadimplência">
        <div className="flex items-end gap-2">
          <Field label={`Dias de tolerância (atual: ${settings.data?.graceDays ?? '…'})`} htmlFor="grace">
            <Input id="grace" type="number" min={0} max={30} value={grace} onChange={(e) => setGrace(e.target.value === '' ? '' : Number(e.target.value))} />
          </Field>
          <Button disabled={grace === ''} loading={save.isPending} onClick={() => save.mutate()}>
            Salvar
          </Button>
        </div>
      </Card>
    </div>
  );
}

export function PlatformTenantsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const q = useApi<Paginated<any>>(['pf-tenants', search, status, page], '/platform/tenants', { search, status, page });
  return (
    <div>
      <PageHeader title="Empresas" />
      <div className="mb-3 flex gap-2">
        <Input aria-label="Buscar" placeholder="Nome ou documento" onKeyDown={(e) => e.key === 'Enter' && setSearch((e.target as HTMLInputElement).value)} className="max-w-sm" />
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto">
          <option value="">Todos</option>
          {['PENDING_PAYMENT', 'ACTIVE', 'SUSPENDED', 'CANCELED'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>
      <QueryState loading={q.isLoading} error={q.error}>
        <Table>
          <thead>
            <tr>
              <Th>Empresa</Th>
              <Th>Plano</Th>
              <Th>Assinatura</Th>
              <Th>Filiais</Th>
              <Th>Membros</Th>
              <Th>Criada</Th>
            </tr>
          </thead>
          <tbody>
            {q.data?.items.map((t) => (
              <tr key={t.id}>
                <Td>
                  <Link className="text-brand-700 underline-offset-2 hover:underline" to={`/platform/tenants/${t.id}`}>
                    {t.name}
                  </Link>
                </Td>
                <Td>{t.subscription?.plan.name ?? '—'}</Td>
                <Td>{t.subscription ? SUBSCRIPTION_STATUS_LABELS[t.subscription.status as keyof typeof SUBSCRIPTION_STATUS_LABELS] : '—'}</Td>
                <Td>{t._count.branches}</Td>
                <Td>{t._count.memberships}</Td>
                <Td>{formatDateBR(t.createdAt)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {q.data && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />}
      </QueryState>
    </div>
  );
}

export function PlatformTenantPage() {
  const { id } = useParams();
  const q = useApi<any>(['pf-tenant', id], `/platform/tenants/${id}`);
  const [action, setAction] = useState<'ACTIVE' | 'SUSPENDED' | null>(null);
  const [reason, setReason] = useState('');
  const set = useAction((_: void) => api(`/platform/tenants/${id}/status`, { method: 'PATCH', body: { status: action, reason } }), { success: 'Status atualizado', invalidate: [['pf-tenant', id!]], onSuccess: () => setAction(null) });
  const t = q.data;
  return (
    <QueryState loading={q.isLoading} error={q.error}>
      {t && (
        <div className="space-y-4">
          <PageHeader
            title={t.name}
            description={`${t.status} · criada em ${formatDateBR(t.createdAt)}`}
            actions={
              <>
                <Button variant="secondary" onClick={() => setAction('ACTIVE')}>
                  Reativar
                </Button>
                <Button variant="danger" onClick={() => setAction('SUSPENDED')}>
                  Suspender
                </Button>
              </>
            }
          />
          <div className="grid gap-3 md:grid-cols-4">
            <Stat label="Filiais" value={t._count.branches} />
            <Stat label="Membros" value={t._count.memberships} />
            <Stat label="OS" value={t.usage.serviceOrders} />
            <Stat label="Assinaturas no banco" value={`${(t.usage.storageBytes / 1024 / 1024).toFixed(1)} MB`} />
          </div>
          {t.subscription && (
            <Card title="Assinatura">
              <p className="text-sm">
                {t.subscription.plan.name} · {formatBRL(t.subscription.priceCents)} · {t.subscription.status} · {t.subscription.paymentMode}
              </p>
              <p className="text-sm">
                Período {t.subscription.currentPeriodStart ? `${formatDateBR(t.subscription.currentPeriodStart)} – ${formatDateBR(t.subscription.currentPeriodEnd)}` : '—'}
              </p>
            </Card>
          )}
          <Card title="Faturas">
            <Table>
              <thead>
                <tr>
                  <Th>Período</Th>
                  <Th>Valor</Th>
                  <Th>Status</Th>
                  <Th>Pago em</Th>
                </tr>
              </thead>
              <tbody>
                {t.billingInvoices.map((i: any) => (
                  <tr key={i.id}>
                    <Td>{formatDateBR(i.periodStart)}</Td>
                    <Td>{formatBRL(i.amountCents)}</Td>
                    <Td>{i.status}</Td>
                    <Td>{i.paidAt ? formatDateTimeBR(i.paidAt) : '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
          <p className="text-xs text-slate-500">Dados operacionais dos clientes não são exibidos. Acesso de suporte requer autorização temporária do proprietário (auditada).</p>
          <ConfirmDialog open={Boolean(action)} onOpenChange={() => setAction(null)} title={action === 'SUSPENDED' ? 'Suspender empresa' : 'Reativar empresa'} danger={action === 'SUSPENDED'} loading={set.isPending} onConfirm={() => set.mutate()}>
            <Textarea aria-label="Motivo" placeholder="Motivo (auditado)" value={reason} onChange={(e) => setReason(e.target.value)} />
          </ConfirmDialog>
        </div>
      )}
    </QueryState>
  );
}

export function PlatformPlansPage() {
  const q = useApi<any[]>(['pf-plans'], '/platform/plans');
  const [edit, setEdit] = useState<any | null>(null);
  const save = useAction(
    (_: void) => {
      const body = { code: edit.code, name: edit.name, priceCents: edit.priceCents, maxBranches: edit.maxBranches, maxTechniciansPerBranch: edit.maxTechniciansPerBranch, maxCashRegistersPerBranch: edit.maxCashRegistersPerBranch, active: edit.active, sortOrder: edit.sortOrder };
      return edit.id ? api(`/platform/plans/${edit.id}`, { method: 'PATCH', body }) : api('/platform/plans', { method: 'POST', body });
    },
    { success: 'Plano salvo', invalidate: [['pf-plans']], onSuccess: () => setEdit(null) },
  );
  return (
    <div>
      <PageHeader title="Planos" description="Mudança de preço cria nova versão; assinaturas existentes mantêm o preço contratado." actions={<Button onClick={() => setEdit({ code: '', name: '', priceCents: 0, maxBranches: 1, maxTechniciansPerBranch: 3, maxCashRegistersPerBranch: 1, active: true, sortOrder: 9 })}>Novo plano</Button>} />
      <QueryState loading={q.isLoading} error={q.error}>
        <Table>
          <thead>
            <tr>
              <Th>Código</Th>
              <Th>Nome</Th>
              <Th>Preço</Th>
              <Th>Filiais</Th>
              <Th>Técnicos/filial</Th>
              <Th>Caixas/filial</Th>
              <Th>Versão</Th>
              <Th>Assinaturas</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {q.data?.map((p) => (
              <tr key={p.id}>
                <Td>{p.code}</Td>
                <Td>
                  {p.name} {!p.active && <Badge>inativo</Badge>}
                </Td>
                <Td>{formatBRL(p.priceCents)}</Td>
                <Td>{p.maxBranches}</Td>
                <Td>{p.maxTechniciansPerBranch}</Td>
                <Td>{p.maxCashRegistersPerBranch}</Td>
                <Td>v{p.priceVersion}</Td>
                <Td>{p._count.subscriptions}</Td>
                <Td>
                  <Button size="sm" variant="secondary" onClick={() => setEdit(p)}>
                    Editar
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </QueryState>
      <Dialog open={Boolean(edit)} onOpenChange={() => setEdit(null)} title="Plano" footer={<Button loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button>}>
        {edit && (
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Código" htmlFor="pc">
              <Input id="pc" disabled={Boolean(edit.id)} value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="Nome" htmlFor="pn">
              <Input id="pn" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </Field>
            <Field label="Preço mensal" htmlFor="pp">
              <MoneyInput id="pp" value={edit.priceCents} onChange={(v) => setEdit({ ...edit, priceCents: v })} />
            </Field>
            {(['maxBranches', 'maxTechniciansPerBranch', 'maxCashRegistersPerBranch', 'sortOrder'] as const).map((k) => (
              <Field key={k} label={k} htmlFor={k}>
                <Input id={k} type="number" min={0} value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: Number(e.target.value) })} />
              </Field>
            ))}
            <Field label="Ativo" htmlFor="pa">
              <Select id="pa" value={edit.active ? '1' : '0'} onChange={(e) => setEdit({ ...edit, active: e.target.value === '1' })}>
                <option value="1">Sim</option>
                <option value="0">Não</option>
              </Select>
            </Field>
          </div>
        )}
      </Dialog>
    </div>
  );
}

function SimpleList({ title, path, columns, render }: { title: string; path: string; columns: string[]; render: (r: any) => React.ReactNode[] }) {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const q = useApi<Paginated<any>>(['pf', path, status, page], path, { status, page });
  return (
    <div>
      <PageHeader title={title} />
      <Input aria-label="Filtrar status" placeholder="Filtrar por status (ex.: PAID, FAILED)" className="mb-3 max-w-xs" onKeyDown={(e) => e.key === 'Enter' && setStatus((e.target as HTMLInputElement).value.toUpperCase())} />
      <QueryState loading={q.isLoading} error={q.error}>
        <Table>
          <thead>
            <tr>
              {columns.map((c) => (
                <Th key={c}>{c}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {q.data?.items.map((r) => (
              <tr key={r.id}>
                {render(r).map((cell, i) => (
                  <Td key={i}>{cell}</Td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
        {q.data && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />}
      </QueryState>
    </div>
  );
}

export function PlatformSubscriptionsPage() {
  return (
    <SimpleList
      title="Assinaturas"
      path="/platform/subscriptions"
      columns={['Empresa', 'Plano', 'Status', 'Forma', 'Preço', 'Fim do período']}
      render={(s) => [s.tenant.name, s.plan.code, s.status, s.paymentMode, formatBRL(s.priceCents), s.currentPeriodEnd ? formatDateBR(s.currentPeriodEnd) : '—']}
    />
  );
}

export function PlatformInvoicesPage() {
  return (
    <SimpleList
      title="Faturas"
      path="/platform/invoices"
      columns={['Empresa', 'Plano', 'Tipo', 'Valor', 'Vencimento', 'Status']}
      render={(i) => [i.tenant.name, i.plan.code, i.kind, formatBRL(i.amountCents), formatDateBR(i.dueAt), i.status]}
    />
  );
}

export function PlatformBillingEventsPage() {
  const reprocess = useAction((id: string) => api(`/platform/billing-events/${id}/reprocess`, { method: 'POST' }), { success: 'Reprocessamento enfileirado', invalidate: [['pf']] });
  return (
    <SimpleList
      title="Webhooks Mercado Pago"
      path="/platform/billing-events"
      columns={['Recebido', 'Tipo', 'Recurso', 'Assinatura', 'Status', 'Tentativas', 'Erro', '']}
      render={(e) => [
        formatDateTimeBR(e.receivedAt),
        e.resourceType,
        e.resourceId,
        e.signatureValid ? 'válida' : 'inválida',
        e.status,
        e.attempts,
        e.error ?? '',
        e.signatureValid && ['FAILED', 'DEAD', 'IGNORED'].includes(e.status) ? (
          <Button size="sm" variant="secondary" onClick={() => reprocess.mutate(e.id)}>
            Reprocessar
          </Button>
        ) : null,
      ]}
    />
  );
}

export function PlatformReconciliationPage() {
  const q = useApi<any[]>(['pf-recon'], '/platform/reconciliation');
  const run = useAction((_: void) => api('/platform/reconciliation/run', { method: 'POST' }), { success: 'Reconciliação enfileirada' });
  return (
    <div>
      <PageHeader title="Reconciliação" actions={<Button loading={run.isPending} onClick={() => run.mutate()}>Executar agora</Button>} />
      <QueryState loading={q.isLoading} error={q.error} empty={q.data?.length === 0} emptyTitle="Sem pendências">
        <Table>
          <thead>
            <tr>
              <Th>Data</Th>
              <Th>Ocorrência</Th>
              <Th>Entidade</Th>
              <Th>Detalhes</Th>
            </tr>
          </thead>
          <tbody>
            {q.data?.map((r) => (
              <tr key={r.id}>
                <Td>{formatDateTimeBR(r.createdAt)}</Td>
                <Td>{r.action}</Td>
                <Td>
                  {r.entity} {r.entityId}
                </Td>
                <Td className="text-xs">{JSON.stringify(r.metadataJson)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </QueryState>
    </div>
  );
}

export function PlatformMessagingPage() {
  const q = useApi<any[]>(['pf-msg'], '/platform/messaging/billing-reviews');
  const [target, setTarget] = useState<{ id: string; approve: boolean } | null>(null);
  const [notes, setNotes] = useState('');
  const decide = useAction((_: void) => api(`/platform/messaging/channels/${target!.id}/billing-review`, { method: 'POST', body: { approve: target!.approve, notes } }), {
    success: 'Decisão registrada',
    invalidate: [['pf-msg']],
    onSuccess: () => setTarget(null),
  });
  return (
    <div>
      <PageHeader title="WhatsApp — validação de faturamento próprio" description="Aprove somente com evidência de faturamento próprio da WABA e ausência de linha de crédito compartilhada." />
      <QueryState loading={q.isLoading} error={q.error} empty={q.data?.length === 0} emptyTitle="Nenhuma revisão pendente">
        <div className="space-y-3">
          {q.data?.map((c) => (
            <Card key={c.id} title={`${c.tenant.name} · ${c.name}`}>
              <p className="text-sm">
                WABA ••••{c.externalWabaId?.slice(-4)} · {c.displayPhoneMasked}
              </p>
              <ul className="mt-2 space-y-1 text-sm">
                {c.billingChecks.map((b: any) => (
                  <li key={b.id}>
                    {formatDateTimeBR(b.checkedAt)} · {b.status}: {b.notes}
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={() => setTarget({ id: c.id, approve: true })}>
                  Aprovar
                </Button>
                <Button size="sm" variant="danger" onClick={() => setTarget({ id: c.id, approve: false })}>
                  Rejeitar
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </QueryState>
      <ConfirmDialog open={Boolean(target)} onOpenChange={() => setTarget(null)} title={target?.approve ? 'Aprovar faturamento próprio' : 'Rejeitar'} loading={decide.isPending} onConfirm={() => decide.mutate()}>
        <Textarea aria-label="Notas" placeholder="Evidência verificada / motivo" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </ConfirmDialog>
    </div>
  );
}

export function PlatformJobsPage() {
  const q = useApi<Record<string, any>>(['pf-jobs'], '/platform/jobs', undefined, { refetchInterval: 15_000 });
  const retry = useAction(({ queue, id }: { queue: string; id: string }) => api(`/platform/jobs/${queue}/${id}/retry`, { method: 'POST' }), { success: 'Job reenfileirado', invalidate: [['pf-jobs']] });
  return (
    <div>
      <PageHeader title="Filas de processamento" description="Tarefas em segundo plano (mensagens, e-mails, cobrança, relatórios). Falhas definitivas podem ser reprocessadas." />
      <QueryState loading={q.isLoading} error={q.error}>
        <div className="space-y-3">
          {q.data && (
            <Card title="Resumo">
              <QueueTable jobs={q.data} />
            </Card>
          )}
          {Object.entries(q.data ?? {}).map(([name, v]) => (
            <Card key={name} title={`Falhas — ${QUEUE_LABELS[name] ?? name}`}>
              {v.failed.length === 0 ? (
                <p className="text-sm text-slate-500">Sem falhas</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {v.failed.map((j: any) => (
                    <li key={j.id} className="flex items-center justify-between gap-2">
                      <span>
                        {j.name} #{j.id} · {j.attemptsMade} tentativas · {j.failedReason}
                      </span>
                      <Button size="sm" variant="secondary" onClick={() => retry.mutate({ queue: name, id: j.id })}>
                        Reprocessar
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
      </QueryState>
    </div>
  );
}

export function PlatformAuditPage() {
  const [page, setPage] = useState(1);
  const q = useApi<Paginated<any>>(['pf-audit', page], '/platform/audit', { page, pageSize: 50 });
  return (
    <div>
      <PageHeader title="Auditoria da plataforma e acessos de suporte" />
      <QueryState loading={q.isLoading} error={q.error}>
        <Table>
          <thead>
            <tr>
              <Th>Data</Th>
              <Th>Ação</Th>
              <Th>Ator</Th>
              <Th>Entidade</Th>
              <Th>Empresa</Th>
            </tr>
          </thead>
          <tbody>
            {q.data?.items.map((a) => (
              <tr key={a.id}>
                <Td>{formatDateTimeBR(a.createdAt)}</Td>
                <Td>{a.action}</Td>
                <Td>
                  {a.actorType} {a.actorId?.slice(0, 8)}
                </Td>
                <Td>
                  {a.entity} {a.entityId?.slice(0, 12)}
                </Td>
                <Td>{a.tenantId?.slice(0, 8) ?? '—'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {q.data && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />}
      </QueryState>
    </div>
  );
}
