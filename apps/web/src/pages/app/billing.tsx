import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { QueryState, useAction, useApi } from '@/components/data';
import { Alert, Badge, Button, Card, ConfirmDialog, PageHeader, Table, Td, Th } from '@/components/ui';
import { api, openPdf } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatBRL, formatDateBR, formatDateTimeBR, INVOICE_STATUS_LABELS, SUBSCRIPTION_STATUS_LABELS } from '@/lib/utils';

/* eslint-disable @typescript-eslint/no-explicit-any */

function PixBox({ pix }: { pix: any }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {pix.qrImageDataUrl && <img src={pix.qrImageDataUrl} alt="QR Code Pix" className="mx-auto h-56 w-56" />}
      <div className="space-y-2 text-sm">
        <p className="text-lg font-semibold">{formatBRL(pix.amountCents)}</p>
        <p>Válido até {formatDateTimeBR(pix.expiresAt)}</p>
        {pix.qrCode && (
          <>
            <p className="break-all rounded bg-slate-100 p-2 font-mono text-xs">{pix.qrCode}</p>
            <Button size="sm" variant="secondary" onClick={() => void navigator.clipboard.writeText(pix.qrCode).then(() => toast.success('Código copiado'))}>
              Copiar código
            </Button>
          </>
        )}
        <p className="text-xs text-slate-500">Pix manual: a cada mês uma nova fatura. A liberação ocorre somente após a confirmação do pagamento pelo Mercado Pago.</p>
      </div>
    </div>
  );
}

export function BillingPage() {
  const { can, reload } = useAuth();
  const q = useApi<any>(['billing-sub'], '/billing/subscription');
  const invoices = useApi<any[]>(['billing-invoices'], '/billing/invoices');
  const [pix, setPix] = useState<any | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const inv = [['billing-sub'], ['billing-invoices']];
  const genPix = useAction((invoiceId: string) => api('/billing/checkout/pix', { method: 'POST', body: { invoiceId } }), { onSuccess: setPix, invalidate: inv });
  const card = useAction((_: void) => api<{ checkoutUrl: string | null; alreadyAuthorized: boolean }>('/billing/checkout/card', { method: 'POST' }), {
    onSuccess: (r) => {
      if (r.checkoutUrl) window.location.href = r.checkoutUrl;
      else toast.info('Cartão já autorizado. Aguardando confirmação da cobrança.');
    },
  });
  const check = useAction((id: string) => api(`/billing/invoices/${id}/check`, { method: 'POST' }), {
    invalidate: inv,
    onSuccess: async () => {
      await reload();
      toast.info('Situação atualizada com o Mercado Pago');
    },
  });
  const cancel = useAction((_: void) => api('/billing/subscription/cancel', { method: 'POST' }), { success: 'Cancelamento agendado para o fim do período', invalidate: inv, onSuccess: () => setConfirmCancel(false) });
  const reactivate = useAction((_: void) => api<{ note: string | null }>('/billing/subscription/reactivate', { method: 'POST' }), { success: 'Assinatura reativada', invalidate: inv, onSuccess: (r) => r.note && toast.info(r.note) });
  const cancelChange = useAction((id: string) => api(`/billing/plan-changes/${id}/cancel`, { method: 'POST' }), { success: 'Mudança cancelada', invalidate: inv });
  const s = q.data;
  return (
    <div className="space-y-4">
      <PageHeader title="Assinatura OrdemCerta" actions={can('billing:manage') && <Link to="/app/billing/planos"><Button variant="secondary">Mudar de plano</Button></Link>} />
      <QueryState loading={q.isLoading} error={q.error}>
        {s && (
          <>
            {!s.providerConfigured && <Alert tone="red" title="Mercado Pago: integração não configurada">Os pagamentos não podem ser processados nesta instalação.</Alert>}
            <Card title={`Plano ${s.plan.name} — ${formatBRL(s.plan.priceCents)}/mês`}>
              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <p>
                  Situação: <Badge tone={s.status === 'ACTIVE' ? 'green' : s.status === 'PENDING_PAYMENT' ? 'yellow' : 'red'}>{SUBSCRIPTION_STATUS_LABELS[s.status as keyof typeof SUBSCRIPTION_STATUS_LABELS]}</Badge>
                </p>
                <p>Forma: {s.paymentMode === 'CARD_RECURRING' ? 'Cartão recorrente' : 'Pix manual'}</p>
                <p>Período: {s.currentPeriodStart ? `${formatDateBR(s.currentPeriodStart)} a ${formatDateBR(s.currentPeriodEnd)}` : 'aguardando primeiro pagamento'}</p>
                {s.graceUntil && <p className="text-amber-700">Tolerância até {formatDateTimeBR(s.graceUntil)}</p>}
                {s.scheduledPlan && <p>Downgrade agendado para {s.scheduledPlan.name} na renovação</p>}
                {s.providerCancelPending && <p className="text-red-600">Cancelamento no Mercado Pago pendente de confirmação (reconciliação em andamento)</p>}
              </div>
              {s.status === 'PENDING_PAYMENT' && <Alert tone="blue" title="Aguardando confirmação do pagamento">A operação será liberada automaticamente após a confirmação do Mercado Pago (webhook validado ou consulta).</Alert>}
              <div className="mt-3 flex flex-wrap gap-2">
                {can('billing:manage') && s.status === 'CANCEL_AT_PERIOD_END' && (
                  <Button loading={reactivate.isPending} onClick={() => reactivate.mutate()}>
                    Reativar
                  </Button>
                )}
                {can('billing:manage') && ['ACTIVE', 'PAST_DUE'].includes(s.status) && (
                  <Button variant="ghost" onClick={() => setConfirmCancel(true)}>
                    Cancelar assinatura
                  </Button>
                )}
              </div>
            </Card>
            {s.openInvoice && (
              <Card title={`Fatura em aberto — ${formatBRL(s.openInvoice.amountCents)} · vence ${formatDateBR(s.openInvoice.dueAt)}`}>
                <div className="flex flex-wrap gap-2">
                  {can('billing:manage') && (
                    <Button loading={genPix.isPending} onClick={() => genPix.mutate(s.openInvoice.id)}>
                      Gerar Pix / Ver QR
                    </Button>
                  )}
                  {can('billing:manage') && ['PENDING_PAYMENT', 'PAST_DUE', 'SUSPENDED'].includes(s.status) && (
                    <Button variant="secondary" loading={card.isPending} onClick={() => card.mutate()}>
                      Pagar com cartão recorrente
                    </Button>
                  )}
                  <Button variant="secondary" loading={check.isPending} onClick={() => check.mutate(s.openInvoice.id)}>
                    Consultar pagamento
                  </Button>
                </div>
                {pix && (
                  <div className="mt-4">
                    <PixBox pix={pix} />
                  </div>
                )}
              </Card>
            )}
            {s.pendingChanges.length > 0 && (
              <Card title="Mudanças de plano pendentes">
                {s.pendingChanges.map((c: any) => (
                  <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span>
                      {c.type === 'UPGRADE' ? 'Upgrade' : 'Downgrade'} para {c.toPlan.name} · {c.status}
                      {c.prorationCents > 0 && ` · diferença ${formatBRL(c.prorationCents)}`}
                      {c.providerSyncError && <span className="block text-red-600">{c.providerSyncError}</span>}
                    </span>
                    <div className="flex gap-2">
                      {c.invoice && c.status === 'PENDING_PAYMENT' && (
                        <Link to={`/app/billing/faturas/${c.invoice.id}`}>
                          <Button size="sm">Pagar diferença</Button>
                        </Link>
                      )}
                      {can('billing:manage') && c.status !== 'PENDING_PROVIDER_SYNC' && (
                        <Button size="sm" variant="ghost" onClick={() => cancelChange.mutate(c.id)}>
                          Cancelar
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </Card>
            )}
            <Card title="Uso por filial">
              <p className="text-sm">
                Filiais ativas {s.usage.activeBranches}/{s.usage.limits.maxBranches}
              </p>
              <ul className="text-sm">
                {s.usage.perBranch.map((b: any) => (
                  <li key={b.branchId}>
                    {b.branchName}: técnicos {b.technicians}/{s.usage.limits.maxTechniciansPerBranch} · caixas {b.cashRegisters}/{s.usage.limits.maxCashRegistersPerBranch}
                  </li>
                ))}
              </ul>
            </Card>
          </>
        )}
      </QueryState>
      <Card title="Faturas">
        <Table>
          <thead>
            <tr>
              <Th>Período</Th>
              <Th>Tipo</Th>
              <Th>Valor</Th>
              <Th>Vencimento</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {invoices.data?.map((i) => (
              <tr key={i.id}>
                <Td>
                  {formatDateBR(i.periodStart)} – {formatDateBR(i.periodEnd)}
                </Td>
                <Td>{i.kind === 'PRORATION' ? 'Diferença de plano' : i.kind === 'REGULARIZATION' ? `Regularização · ${i.plan.name}` : i.plan.name}</Td>
                <Td>{formatBRL(i.amountCents)}</Td>
                <Td>{formatDateBR(i.dueAt)}</Td>
                <Td>
                  <Badge tone={i.status === 'PAID' ? 'green' : ['OPEN', 'PENDING'].includes(i.status) ? 'yellow' : 'gray'}>{INVOICE_STATUS_LABELS[i.status as keyof typeof INVOICE_STATUS_LABELS]}</Badge>
                </Td>
                <Td>
                  <div className="flex gap-1">
                    <Link to={`/app/billing/faturas/${i.id}`}>
                      <Button size="sm" variant="secondary">
                        Abrir
                      </Button>
                    </Link>
                    {i.status === 'PAID' && (
                      <Button size="sm" variant="ghost" onClick={() => void openPdf(`/billing/invoices/${i.id}/receipt`)}>
                        Recibo
                      </Button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        danger
        title="Cancelar assinatura"
        description="O acesso continua até o fim do período pago; depois a conta fica somente leitura. Nenhum dado é apagado."
        confirmLabel="Agendar cancelamento"
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate()}
      />
    </div>
  );
}

export function BillingPlansPage() {
  const plans = useApi<any[]>(['public-plans'], '/billing/plans');
  const sub = useApi<any>(['billing-sub'], '/billing/subscription');
  const [target, setTarget] = useState<string | null>(null);
  const preview = useApi<any>(['plan-preview', target], target ? '/billing/subscription/change-plan/preview' : null, { planCode: target ?? undefined });
  const change = useAction((_: void) => api('/billing/subscription/change-plan', { method: 'POST', body: { planCode: target } }), { success: 'Solicitação registrada', invalidate: [['billing-sub']], onSuccess: () => setTarget(null) });
  return (
    <div className="space-y-4">
      <PageHeader title="Planos" description="Upgrade cobra a diferença proporcional e vale após o pagamento; downgrade é agendado para a próxima renovação." />
      <div className="grid gap-3 md:grid-cols-4">
        {plans.data?.map((p) => (
          <Card key={p.code} title={p.name}>
            <p className="text-xl font-bold">{formatBRL(p.priceCents)}/mês</p>
            <p className="text-sm text-slate-600">
              {p.maxBranches} filial(is) · {p.maxTechniciansPerBranch} técnicos/filial · {p.maxCashRegistersPerBranch} caixa/filial
            </p>
            {sub.data?.plan.code === p.code ? (
              <Badge tone="green" className="mt-2">
                Plano atual
              </Badge>
            ) : (
              <Button size="sm" className="mt-2" onClick={() => setTarget(p.code)}>
                Escolher
              </Button>
            )}
          </Card>
        ))}
      </div>
      <ConfirmDialog open={Boolean(target)} onOpenChange={() => setTarget(null)} title="Confirmar mudança de plano" loading={change.isPending} onConfirm={() => change.mutate()}>
        {preview.isLoading && <p className="text-sm">Calculando…</p>}
        {preview.data && (
          <div className="space-y-2 text-sm">
            <p>
              {preview.data.currentPlan.name} ({formatBRL(preview.data.currentPlan.priceCents)}) → {preview.data.newPlan.name} ({formatBRL(preview.data.newPlan.priceCents)})
            </p>
            {preview.data.type === 'UPGRADE' ? (
              <p>
                Diferença proporcional a pagar agora: <strong>{formatBRL(preview.data.prorationCents)}</strong>. O novo plano vale após a confirmação do pagamento; o ciclo é mantido.
              </p>
            ) : (
              <p>O downgrade será aplicado na próxima renovação ({formatDateBR(preview.data.effectiveAt)}), sem devolução proporcional.</p>
            )}
            {preview.data.violations.length > 0 && (
              <Alert tone="red" title="Ajuste antes de agendar">
                <ul className="list-disc pl-4">
                  {preview.data.violations.map((v: any, i: number) => (
                    <li key={i}>{v.message}</li>
                  ))}
                </ul>
              </Alert>
            )}
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}

export function InvoicePage() {
  const { id } = useParams();
  const { can } = useAuth();
  const q = useApi<any>(['billing-invoice', id], `/billing/invoices/${id}`);
  const [pix, setPix] = useState<any | null>(null);
  const gen = useAction((_: void) => api(`/billing/invoices/${id}/pix`, { method: 'POST' }), { onSuccess: setPix, invalidate: [['billing-invoice', id!]] });
  const check = useAction((_: void) => api(`/billing/invoices/${id}/check`, { method: 'POST' }), { success: 'Consulta realizada', invalidate: [['billing-invoice', id!], ['billing-sub']] });
  const shown = pix ?? q.data?.pix;
  return (
    <QueryState loading={q.isLoading} error={q.error}>
      {q.data && (
        <div className="space-y-4">
          <PageHeader title={`Fatura ${formatBRL(q.data.amountCents)}`} description={`${q.data.kind === 'PRORATION' ? 'Diferença de plano' : q.data.kind === 'REGULARIZATION' ? `Regularização · ${q.data.plan.name}` : q.data.plan.name} · ${formatDateBR(q.data.periodStart)} – ${formatDateBR(q.data.periodEnd)}`} />
          <Badge tone={q.data.status === 'PAID' ? 'green' : 'yellow'}>{INVOICE_STATUS_LABELS[q.data.status as keyof typeof INVOICE_STATUS_LABELS]}</Badge>
          {['OPEN', 'PENDING', 'EXPIRED'].includes(q.data.status) && (
            <Card title="Pagamento via Pix">
              {shown ? <PixBox pix={shown} /> : <p className="text-sm">Gere o Pix para pagar esta fatura.</p>}
              <div className="mt-3 flex gap-2">
                {can('billing:manage') && (
                  <Button loading={gen.isPending} onClick={() => gen.mutate()}>
                    {shown ? 'Atualizar/gerar novo Pix' : 'Gerar Pix'}
                  </Button>
                )}
                <Button variant="secondary" loading={check.isPending} onClick={() => check.mutate()}>
                  Consultar pagamento
                </Button>
              </div>
            </Card>
          )}
          <Card title="Tentativas">
            <ul className="space-y-1 text-sm">
              {q.data.attempts.map((a: any) => (
                <li key={a.id}>
                  {formatDateTimeBR(a.createdAt)} · {a.method} · {a.status} {a.errorCode && <span className="text-red-600">({a.errorCode})</span>}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </QueryState>
  );
}
