import { useQuery } from '@tanstack/react-query';
import {
  ORDER_EVENT_LABELS,
  PART_PAYMENT_METHOD_LABELS,
  PART_PAYMENT_METHODS,
  PAYMENT_METHODS,
  QUOTE_LINE_KINDS,
  lineTotalCents,
  statusLabel,
  type Permission,
  type TechnicalStatus,
} from '@ordemcerta/shared';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { DeliveryBadge, QueryState, StatusBadge, useAction, useApi } from '@/components/data';
import { SignatureCollector, type SignatureValue } from '@/components/signature-collector';
import { Alert, Badge, Button, Card, Checkbox, ConfirmDialog, Dialog, Field, Input, MoneyInput, PageHeader, Select, Table, Tabs, Td, Textarea, Th } from '@/components/ui';
import { api, errorMessage, openPdf } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  ACCESSORY_LABELS,
  formatBRL,
  formatDateBR,
  formatDateTimeBR,
  formatPhoneBR,
  ORDER_PAYMENT_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PRIORITY_LABELS,
  QUOTE_STATUS_LABELS,
} from '@/lib/utils';
import { ChecklistEditor } from './service-orders';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Order = any;

function useOrder(id: string) {
  return useQuery({ queryKey: ['os', id], queryFn: () => api<Order>(`/service-orders/${id}`) });
}

/* ---------------------------------------------------------- ações de estado */

interface ActionDef {
  key: string;
  label: string;
  path: string;
  perm: Permission;
  from: TechnicalStatus[];
  variant?: 'primary' | 'secondary' | 'danger';
  dialog?: 'reason' | 'diagnosis' | 'complete' | 'assign';
}

const ACTIONS: ActionDef[] = [
  { key: 'assign', label: 'Atribuir técnico', path: 'assign', perm: 'os:assign', from: ['RECEIVED', 'WAITING_DIAGNOSIS', 'DIAGNOSING', 'APPROVED', 'WAITING_PARTS', 'IN_REPAIR', 'REOPENED'], variant: 'secondary', dialog: 'assign' },
  { key: 'accept', label: 'Aceitar OS', path: 'accept', perm: 'os:accept', from: ['RECEIVED'] },
  { key: 'start-diagnosis', label: 'Iniciar diagnóstico', path: 'start-diagnosis', perm: 'os:diagnose', from: ['WAITING_DIAGNOSIS', 'WAITING_QUOTE_APPROVAL', 'REJECTED', 'REOPENED'] },
  { key: 'submit-diagnosis', label: 'Concluir diagnóstico', path: 'submit-diagnosis', perm: 'os:diagnose', from: ['DIAGNOSING'], dialog: 'diagnosis' },
  { key: 'request-parts', label: 'Aguardando peças', path: 'request-parts', perm: 'os:repair', from: ['APPROVED', 'IN_REPAIR'], variant: 'secondary' },
  { key: 'parts-arrived', label: 'Peças chegaram', path: 'parts-arrived', perm: 'os:repair', from: ['WAITING_PARTS'], variant: 'secondary' },
  { key: 'start-repair', label: 'Iniciar reparo', path: 'start-repair', perm: 'os:repair', from: ['APPROVED', 'WAITING_PARTS', 'TESTING', 'REOPENED'] },
  { key: 'start-testing', label: 'Iniciar testes', path: 'start-testing', perm: 'os:repair', from: ['IN_REPAIR'] },
  { key: 'complete-repair', label: 'Concluir reparo', path: 'complete-repair', perm: 'os:repair', from: ['TESTING'], dialog: 'complete' },
  { key: 'return-unrepaired', label: 'Devolver sem reparo', path: 'return-unrepaired', perm: 'os:view', from: ['DIAGNOSING', 'REJECTED'], variant: 'secondary', dialog: 'reason' },
  { key: 'cancel', label: 'Cancelar OS', path: 'cancel', perm: 'os:cancel', from: ['RECEIVED', 'WAITING_DIAGNOSIS', 'DIAGNOSING', 'WAITING_QUOTE_APPROVAL', 'APPROVED', 'WAITING_PARTS', 'REJECTED', 'REOPENED'], variant: 'danger', dialog: 'reason' },
  { key: 'reopen', label: 'Reabrir', path: 'reopen', perm: 'os:reopen', from: ['READY', 'RETURNED_UNREPAIRED', 'CANCELED'], variant: 'secondary', dialog: 'reason' },
];

function StateActions({ o }: { o: Order }) {
  const { can, branchId } = useAuth();
  const [dialog, setDialog] = useState<ActionDef | null>(null);
  const [reason, setReason] = useState('');
  const [diag, setDiag] = useState({ diagnosis: o.diagnosis ?? '', technicalReport: o.technicalReport ?? '', preApproved: false });
  const [checklist, setChecklist] = useState<Array<{ key: string; label: string; ok: boolean | null; notes?: string }>>([]);
  const [warrantyDays, setWarrantyDays] = useState<number | ''>('');
  const [tech, setTech] = useState('');
  const settings = useApi<Record<string, unknown>>(['settings', o.branchId], '/settings', { branchId: o.branchId });
  const techs = useApi<Array<{ membership: { user: { id: string; name: string } } }>>(['technicians', o.branchId], can('os:assign') ? '/members/technicians' : null, { branchId: o.branchId });

  useEffect(() => {
    const items = settings.data?.['os.post_repair_checklist'] as Array<{ key: string; label: string }> | undefined;
    if (items) setChecklist(items.map((i) => ({ ...i, ok: null })));
  }, [settings.data]);

  const run = useAction(
    ({ a, body }: { a: ActionDef; body: Record<string, unknown> }) => api(`/service-orders/${o.id}/${a.path}`, { method: 'POST', body: { version: o.version, ...body } }),
    { success: 'Atualizado', invalidate: [['os', o.id], ['service-orders'], ['queue']], onSuccess: () => setDialog(null) },
  );

  const available = ACTIONS.filter((a) => a.from.includes(o.technicalStatus) && can(a.perm));
  void branchId;
  return (
    <div className="flex flex-wrap gap-2">
      {available.map((a) => (
        <Button key={a.key} size="sm" variant={a.variant ?? 'primary'} loading={run.isPending && run.variables?.a.key === a.key} onClick={() => (a.dialog ? setDialog(a) : run.mutate({ a, body: {} }))}>
          {a.label}
        </Button>
      ))}
      {dialog?.dialog === 'reason' && (
        <ConfirmDialog
          open
          onOpenChange={() => setDialog(null)}
          title={dialog.label}
          danger={dialog.variant === 'danger'}
          loading={run.isPending}
          onConfirm={() => run.mutate({ a: dialog, body: { reason } })}
        >
          <Field label="Motivo" htmlFor="reason">
            <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </ConfirmDialog>
      )}
      {dialog?.dialog === 'assign' && (
        <ConfirmDialog open onOpenChange={() => setDialog(null)} title="Atribuir técnico" loading={run.isPending} onConfirm={() => run.mutate({ a: dialog, body: { technicianUserId: tech } })}>
          <Select aria-label="Técnico" value={tech} onChange={(e) => setTech(e.target.value)}>
            <option value="">Selecione</option>
            {techs.data?.map((t) => (
              <option key={t.membership.user.id} value={t.membership.user.id}>
                {t.membership.user.name}
              </option>
            ))}
          </Select>
        </ConfirmDialog>
      )}
      {dialog?.dialog === 'diagnosis' && (
        <ConfirmDialog open onOpenChange={() => setDialog(null)} title="Concluir diagnóstico" loading={run.isPending} onConfirm={() => run.mutate({ a: dialog, body: diag })}>
          <div className="space-y-3">
            <Field label="Diagnóstico" htmlFor="diag">
              <Textarea id="diag" value={diag.diagnosis} onChange={(e) => setDiag({ ...diag, diagnosis: e.target.value })} />
            </Field>
            <Field label="Laudo técnico (interno)" htmlFor="report">
              <Textarea id="report" value={diag.technicalReport} onChange={(e) => setDiag({ ...diag, technicalReport: e.target.value })} />
            </Field>
            {(!o.requiresApproval || can('os:approve_override')) && (
              <Checkbox label="Orçamento previamente aprovado (seguir direto para reparo)" checked={diag.preApproved} onChange={(v) => setDiag({ ...diag, preApproved: v })} />
            )}
            {!diag.preApproved && <p className="text-xs text-slate-500">É necessário ter um orçamento criado (aba Orçamento) para enviar à aprovação.</p>}
          </div>
        </ConfirmDialog>
      )}
      {dialog?.dialog === 'complete' && (
        <Dialog
          open
          onOpenChange={() => setDialog(null)}
          title="Checklist final obrigatório"
          wide
          footer={
            <Button loading={run.isPending} onClick={() => run.mutate({ a: dialog, body: { checklist, warrantyDays: warrantyDays === '' ? undefined : warrantyDays } })}>
              Concluir reparo
            </Button>
          }
        >
          <ChecklistEditor items={checklist} onChange={setChecklist} />
          <Field label="Garantia (dias)" htmlFor="wd" hint="Vazio: maior garantia das linhas aprovadas ou padrão da empresa" className="mt-3">
            <Input id="wd" type="number" min={0} value={warrantyDays} onChange={(e) => setWarrantyDays(e.target.value === '' ? '' : Number(e.target.value))} />
          </Field>
        </Dialog>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- orçamento */

interface Line {
  kind: string;
  productId?: string | null;
  description: string;
  qty: number;
  unitPriceCents: number;
  unitCostCents: number;
  discountCents: number;
  warrantyDays: number;
}

function QuoteTab({ o }: { o: Order }) {
  const { can } = useAuth();
  const [editing, setEditing] = useState(false);
  const [lines, setLines] = useState<Line[]>([{ kind: 'LABOR', description: 'Mão de obra', qty: 1, unitPriceCents: 0, unitCostCents: 0, discountCents: 0, warrantyDays: 90 }]);
  const [meta, setMeta] = useState({ validDays: 7, estimatedDays: 2, notes: '' });
  const [discount, setDiscount] = useState(0);
  const [productTerm, setProductTerm] = useState('');
  const products = useApi<{ items: Array<{ id: string; name: string; priceCents: number; costCents: number }> }>(['products-q', productTerm], productTerm.length >= 2 ? '/products' : null, { q: productTerm, pageSize: 6 });
  const [approve, setApprove] = useState<string | null>(null);
  const [approveForm, setApproveForm] = useState({ customerName: o.customer.name, method: 'IN_PERSON', notes: '' });
  const [reject, setReject] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [sentLink, setSentLink] = useState<string | null>(null);

  const subtotal = lines.reduce((s, l) => s + l.qty * l.unitPriceCents, 0);
  const total = subtotal - lines.reduce((s, l) => s + l.discountCents, 0) - discount;
  const inv = [['os', o.id]] as const;

  const create = useAction((_: void) => api(`/service-orders/${o.id}/quotes`, { method: 'POST', body: { lines, discountCents: discount, ...meta, notes: meta.notes || null } }), {
    success: 'Orçamento criado',
    invalidate: [...inv],
    onSuccess: () => setEditing(false),
  });
  const send = useAction((id: string) => api<{ quoteUrl: string }>(`/quotes/${id}/send`, { method: 'POST' }), { success: 'Orçamento enviado', invalidate: [...inv], onSuccess: (r) => setSentLink(r.quoteUrl) });
  const doApprove = useAction((id: string) => api(`/quotes/${id}/approve`, { method: 'POST', body: approveForm }), { success: 'Orçamento aprovado', invalidate: [...inv], onSuccess: () => setApprove(null) });
  const doReject = useAction((id: string) => api(`/quotes/${id}/reject`, { method: 'POST', body: { reason: rejectReason } }), { success: 'Recusa registrada', invalidate: [...inv], onSuccess: () => setReject(null) });

  const quotable = ['DIAGNOSING', 'WAITING_QUOTE_APPROVAL', 'REJECTED', 'REOPENED'].includes(o.technicalStatus);
  return (
    <div className="space-y-4">
      {sentLink && (
        <Alert tone="green" title="Link do orçamento (uso limitado)">
          <p className="break-all font-mono text-xs">{sentLink}</p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => void navigator.clipboard.writeText(sentLink).then(() => toast.success('Copiado'))}>
            Copiar
          </Button>
        </Alert>
      )}
      {o.quotes.map((q: any) => (
        <Card
          key={q.id}
          title={
            <span>
              Versão {q.version} <Badge tone={q.status === 'APPROVED' ? 'green' : q.status === 'REJECTED' ? 'red' : q.status === 'SENT' ? 'yellow' : 'gray'}>{QUOTE_STATUS_LABELS[q.status as keyof typeof QUOTE_STATUS_LABELS]}</Badge>
            </span>
          }
          actions={
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => void openPdf(`/quotes/${q.id}/pdf`)}>
                PDF
              </Button>
              {can('quote:send') && ['DRAFT', 'SENT'].includes(q.status) && (
                <Button size="sm" loading={send.isPending} onClick={() => send.mutate(q.id)}>
                  {q.status === 'SENT' ? 'Reenviar link' : 'Enviar ao cliente'}
                </Button>
              )}
              {can('quote:approve_manual') && ['DRAFT', 'SENT'].includes(q.status) && o.technicalStatus === 'WAITING_QUOTE_APPROVAL' && (
                <>
                  <Button size="sm" variant="secondary" onClick={() => setApprove(q.id)}>
                    Aprovação presencial
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setReject(q.id)}>
                    Recusa
                  </Button>
                </>
              )}
            </div>
          }
        >
          <Table>
            <thead>
              <tr>
                <Th>Item</Th>
                <Th>Qtd</Th>
                <Th>Unitário</Th>
                <Th>Desconto no item</Th>
                <Th>Total</Th>
                <Th>Garantia</Th>
              </tr>
            </thead>
            <tbody>
              {q.lines.map((l: any) => (
                <tr key={l.id}>
                  <Td>{l.description}</Td>
                  <Td>{l.qty}</Td>
                  <Td>{formatBRL(l.unitPriceCents)}</Td>
                  <Td>{formatBRL(l.discountCents)}</Td>
                  <Td>{formatBRL(lineTotalCents(l))}</Td>
                  <Td>{l.warrantyDays} dias</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="mt-2 text-right text-sm">
            Subtotal {formatBRL(q.subtotalCents)} · Descontos {formatBRL(q.discountCents)} · <strong>Total {formatBRL(q.totalCents)}</strong>
          </p>
          <p className="text-right text-xs text-slate-500">
            Validade {formatDateTimeBR(q.expiresAt)} · hash {q.contentHash.slice(0, 12)}…
          </p>
        </Card>
      ))}
      {can('quote:create') && quotable && !editing && (
        <Button onClick={() => setEditing(true)}>{o.quotes.length ? 'Nova versão do orçamento' : 'Criar orçamento'}</Button>
      )}
      {!quotable && !o.quotes.length && <Alert tone="blue">O orçamento é criado durante o diagnóstico.</Alert>}
      {editing && (
        <Card title="Novo orçamento">
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Liste o que será cobrado do cliente. O <strong>custo da peça</strong> é interno (não aparece para o cliente) e serve para calcular a sua margem.
            </p>
            {lines.map((l, i) => {
              const set = (patch: Partial<Line>) => setLines(lines.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <div key={i} className="rounded-md border border-slate-200 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Item {i + 1}</span>
                    <Button variant="ghost" size="sm" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                      Remover item
                    </Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-6">
                    <Field label="Tipo" htmlFor={`qk${i}`}>
                      <Select id={`qk${i}`} value={l.kind} onChange={(e) => set({ kind: e.target.value })}>
                        {QUOTE_LINE_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {{ PART: 'Peça', LABOR: 'Mão de obra', SERVICE: 'Serviço', FEE: 'Taxa' }[k]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Descrição (aparece para o cliente)" htmlFor={`qdesc${i}`} className="sm:col-span-3">
                      <Input id={`qdesc${i}`} placeholder="Ex.: Tela original iPhone 13" value={l.description} onChange={(e) => set({ description: e.target.value })} />
                    </Field>
                    <Field label="Quantidade" htmlFor={`qq${i}`}>
                      <Input id={`qq${i}`} type="number" min={1} value={l.qty} onChange={(e) => set({ qty: Math.max(1, Number(e.target.value)) })} />
                    </Field>
                    <Field label="Garantia (dias)" htmlFor={`qw${i}`}>
                      <Input id={`qw${i}`} type="number" min={0} value={l.warrantyDays} onChange={(e) => set({ warrantyDays: Number(e.target.value) })} />
                    </Field>
                    <Field label="Preço unitário para o cliente" htmlFor={`qp${i}`} className="sm:col-span-2">
                      <MoneyInput id={`qp${i}`} value={l.unitPriceCents} onChange={(v) => set({ unitPriceCents: v })} />
                    </Field>
                    <Field label="Desconto neste item" htmlFor={`qld${i}`} hint="Opcional. Valor em R$ abatido só deste item" className="sm:col-span-2">
                      <MoneyInput id={`qld${i}`} value={l.discountCents} onChange={(v) => set({ discountCents: v })} />
                    </Field>
                    {l.kind === 'PART' ? (
                      <Field label="Custo unitário da peça (interno)" htmlFor={`qc${i}`} hint="Quanto a loja paga pela peça" className="sm:col-span-2">
                        <MoneyInput id={`qc${i}`} value={l.unitCostCents} onChange={(v) => set({ unitCostCents: v })} />
                      </Field>
                    ) : (
                      <div className="sm:col-span-2" />
                    )}
                  </div>
                  <p className="mt-2 text-right text-sm">
                    Total do item: <strong>{formatBRL(Math.max(l.qty * l.unitPriceCents - l.discountCents, 0))}</strong>
                    {l.kind === 'PART' && l.unitCostCents > 0 && (
                      <span className="ml-2 text-xs text-slate-500">· margem {formatBRL(l.qty * (l.unitPriceCents - l.unitCostCents) - l.discountCents)}</span>
                    )}
                  </p>
                </div>
              );
            })}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setLines([...lines, { kind: 'PART', description: '', qty: 1, unitPriceCents: 0, unitCostCents: 0, discountCents: 0, warrantyDays: 90 }])}>
                + Peça
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setLines([...lines, { kind: 'SERVICE', description: '', qty: 1, unitPriceCents: 0, unitCostCents: 0, discountCents: 0, warrantyDays: 90 }])}>
                + Serviço / mão de obra
              </Button>
              <Input aria-label="Buscar peça no catálogo" placeholder="Ou buscar peça do estoque…" className="h-8 max-w-64" value={productTerm} onChange={(e) => setProductTerm(e.target.value)} />
            </div>
            {products.data?.items.map((p) => (
              <button
                key={p.id}
                type="button"
                className="block w-full rounded border border-slate-200 p-1 text-left text-sm hover:bg-slate-50"
                onClick={() => {
                  setLines([...lines, { kind: 'PART', productId: p.id, description: p.name, qty: 1, unitPriceCents: p.priceCents, unitCostCents: p.costCents, discountCents: 0, warrantyDays: 90 }]);
                  setProductTerm('');
                }}
              >
                {p.name} — {formatBRL(p.priceCents)}
              </button>
            ))}
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Desconto no total do orçamento" htmlFor="qd" hint="Opcional. Abatido do valor final, além dos descontos por item">
                <MoneyInput id="qd" value={discount} onChange={setDiscount} />
              </Field>
              <Field label="Orçamento válido por (dias)" htmlFor="qv">
                <Input id="qv" type="number" min={1} max={60} value={meta.validDays} onChange={(e) => setMeta({ ...meta, validDays: Number(e.target.value) })} />
              </Field>
              <Field label="Prazo para o serviço (dias)" htmlFor="qe" hint="Após a aprovação">
                <Input id="qe" type="number" min={0} value={meta.estimatedDays} onChange={(e) => setMeta({ ...meta, estimatedDays: Number(e.target.value) })} />
              </Field>
            </div>
            <dl className="ml-auto grid max-w-sm grid-cols-2 gap-1 rounded-md bg-slate-50 p-3 text-sm">
              <dt className="text-slate-500">Soma dos itens</dt>
              <dd className="text-right">{formatBRL(subtotal)}</dd>
              <dt className="text-slate-500">Descontos nos itens</dt>
              <dd className="text-right">− {formatBRL(lines.reduce((s, l) => s + l.discountCents, 0))}</dd>
              <dt className="text-slate-500">Desconto no total</dt>
              <dd className="text-right">− {formatBRL(discount)}</dd>
              <dt className="font-semibold">Total para o cliente</dt>
              <dd className="text-right text-lg font-semibold">{formatBRL(Math.max(total, 0))}</dd>
            </dl>
            <Field label="Observações para o cliente (opcional)" htmlFor="qn">
              <Textarea id="qn" placeholder="Ex.: peça com previsão de chegada em 2 dias úteis" value={meta.notes} onChange={(e) => setMeta({ ...meta, notes: e.target.value })} />
            </Field>
            <div className="flex gap-2">
              <Button loading={create.isPending} disabled={!lines.length || total < 0} onClick={() => create.mutate()}>
                Salvar versão
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        </Card>
      )}
      <ConfirmDialog open={Boolean(approve)} onOpenChange={() => setApprove(null)} title="Registrar aprovação do cliente" loading={doApprove.isPending} onConfirm={() => doApprove.mutate(approve!)}>
        <div className="space-y-2">
          <Field label="Nome do cliente que aprovou" htmlFor="an">
            <Input id="an" value={approveForm.customerName} onChange={(e) => setApproveForm({ ...approveForm, customerName: e.target.value })} />
          </Field>
          <Field label="Meio" htmlFor="am">
            <Select id="am" value={approveForm.method} onChange={(e) => setApproveForm({ ...approveForm, method: e.target.value })}>
              <option value="IN_PERSON">Presencial</option>
              <option value="PHONE">Telefone</option>
            </Select>
          </Field>
          <Textarea placeholder="Observações / evidência" value={approveForm.notes} onChange={(e) => setApproveForm({ ...approveForm, notes: e.target.value })} />
        </div>
      </ConfirmDialog>
      <ConfirmDialog open={Boolean(reject)} onOpenChange={() => setReject(null)} title="Registrar recusa" danger loading={doReject.isPending} onConfirm={() => doReject.mutate(reject!)}>
        <Textarea aria-label="Motivo" placeholder="Motivo" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
      </ConfirmDialog>
    </div>
  );
}

/* ----------------------------------------------------------------- peças */

const emptyPurchase = { description: '', qty: 1, unitCostCents: 0, supplierName: '', paymentMethod: 'PIX', cashSessionId: '', notes: '' };

/** Peças compradas no ato do serviço (fora do estoque): custo, fornecedor e como foram pagas. */
function PartPurchases({ o }: { o: Order }) {
  const { can } = useAuth();
  const [form, setForm] = useState(emptyPurchase);
  const [cancel, setCancel] = useState<any | null>(null);
  const [reason, setReason] = useState('');
  const sessions = useApi<Array<{ id: string; branchId: string; register: { name: string } }>>(['cash-current'], can('cash:operate') ? '/cash-sessions/current' : null);
  const branchSessions = sessions.data?.filter((s) => s.branchId === o.branchId) ?? [];
  useEffect(() => {
    if (form.paymentMethod === 'CASH_REGISTER' && !form.cashSessionId && branchSessions[0]) setForm((f) => ({ ...f, cashSessionId: branchSessions[0]!.id }));
  }, [form.paymentMethod, form.cashSessionId, branchSessions]);
  const inv = [['os', o.id], ['os-history', o.id]] as const;
  const save = useAction(
    (_: void, key) =>
      api(`/service-orders/${o.id}/part-purchases`, {
        method: 'POST',
        idempotencyKey: key,
        body: {
          ...form,
          supplierName: form.supplierName || null,
          notes: form.notes || null,
          cashSessionId: form.paymentMethod === 'CASH_REGISTER' ? form.cashSessionId : undefined,
        },
      }),
    { success: 'Compra de peça registrada', invalidate: [...inv, ['cash-current']], onSuccess: () => setForm(emptyPurchase) },
  );
  const doCancel = useAction((_: void) => api(`/service-orders/${o.id}/part-purchases/${cancel.id}/cancel`, { method: 'POST', body: { reason } }), {
    success: 'Compra cancelada',
    invalidate: [...inv],
    onSuccess: () => {
      setCancel(null);
      setReason('');
    },
  });
  const active = (o.partPurchases ?? []).filter((p: any) => !p.canceledAt);
  const totalCost = active.reduce((s: number, p: any) => s + p.totalCostCents, 0);
  const total = form.qty * form.unitCostCents;
  const needsCash = form.paymentMethod === 'CASH_REGISTER';
  const canSave = form.description.trim().length > 0 && (!needsCash || (form.cashSessionId && total > 0));

  return (
    <>
      <Card title="Peças compradas para este serviço" actions={active.length > 0 && <span className="text-sm">Custo total: <strong>{formatBRL(totalCost)}</strong></span>}>
        {!o.partPurchases?.length ? (
          <p className="text-sm text-slate-500">Nenhuma peça comprada registrada. Registre aqui as peças compradas especificamente para este serviço (fora do estoque).</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Peça</Th>
                <Th>Qtd</Th>
                <Th>Custo unit.</Th>
                <Th>Custo total</Th>
                <Th>Fornecedor</Th>
                <Th>Pagamento</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {o.partPurchases.map((p: any) => (
                <tr key={p.id} className={p.canceledAt ? 'text-slate-400 line-through' : undefined}>
                  <Td>
                    {p.description}
                    <span className="block text-xs text-slate-500 no-underline">{formatDateBR(p.purchasedAt)}</span>
                  </Td>
                  <Td>{p.qty}</Td>
                  <Td>{formatBRL(p.unitCostCents)}</Td>
                  <Td>{formatBRL(p.totalCostCents)}</Td>
                  <Td>{p.supplierName ?? '—'}</Td>
                  <Td className="text-xs">{PART_PAYMENT_METHOD_LABELS[p.paymentMethod as keyof typeof PART_PAYMENT_METHOD_LABELS]}</Td>
                  <Td>
                    {p.canceledAt ? (
                      <Badge tone="gray">Cancelada</Badge>
                    ) : (
                      can('os:repair') && (
                        <Button size="sm" variant="ghost" onClick={() => setCancel(p)}>
                          Cancelar
                        </Button>
                      )
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {can('os:repair') && o.technicalStatus !== 'CANCELED' && (
        <Card title="Registrar peça comprada">
          <div className="grid gap-3 sm:grid-cols-6">
            <Field label="Peça" htmlFor="pp-d" className="sm:col-span-3">
              <Input id="pp-d" placeholder="Ex.: Tela iPhone 13 incell" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <Field label="Quantidade" htmlFor="pp-q">
              <Input id="pp-q" type="number" min={1} value={form.qty} onChange={(e) => setForm({ ...form, qty: Math.max(1, Number(e.target.value)) })} />
            </Field>
            <Field label="Custo unitário" htmlFor="pp-c" className="sm:col-span-2">
              <MoneyInput id="pp-c" value={form.unitCostCents} onChange={(v) => setForm({ ...form, unitCostCents: v })} />
            </Field>
            <Field label="Fornecedor (opcional)" htmlFor="pp-s" className="sm:col-span-2">
              <Input id="pp-s" placeholder="Ex.: Distribuidora X" value={form.supplierName} onChange={(e) => setForm({ ...form, supplierName: e.target.value })} />
            </Field>
            <Field label="Como a loja pagou" htmlFor="pp-m" className="sm:col-span-2">
              <Select id="pp-m" value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value, cashSessionId: '' })}>
                {PART_PAYMENT_METHODS.filter((m) => m !== 'CASH_REGISTER' || can('cash:operate')).map((m) => (
                  <option key={m} value={m}>
                    {PART_PAYMENT_METHOD_LABELS[m]}
                  </option>
                ))}
              </Select>
            </Field>
            {needsCash && (
              <Field label="Caixa de onde saiu o dinheiro" htmlFor="pp-cx" className="sm:col-span-2">
                {branchSessions.length ? (
                  <Select id="pp-cx" value={form.cashSessionId} onChange={(e) => setForm({ ...form, cashSessionId: e.target.value })}>
                    {branchSessions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.register.name}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <p className="text-sm text-amber-700">
                    Nenhum caixa aberto nesta filial. <Link className="underline" to="/app/cash">Abrir caixa</Link>
                  </p>
                )}
              </Field>
            )}
            <Field label="Observação (opcional)" htmlFor="pp-n" className="sm:col-span-6">
              <Input id="pp-n" placeholder="Ex.: nota fiscal 1234, garantia do fornecedor 90 dias" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm">
              Custo desta compra: <strong>{formatBRL(total)}</strong>
              {needsCash && total > 0 && <span className="ml-2 text-xs text-amber-700">será registrada uma sangria de {formatBRL(total)} no caixa</span>}
            </span>
            <Button loading={save.isPending} disabled={!canSave} onClick={() => save.mutate()}>
              Registrar compra
            </Button>
          </div>
          <p className="mt-2 text-xs text-slate-500">O custo entra na margem desta OS nos relatórios. O preço cobrado do cliente é definido no orçamento.</p>
        </Card>
      )}
      <ConfirmDialog
        open={Boolean(cancel)}
        onOpenChange={() => setCancel(null)}
        title={`Cancelar compra: ${cancel?.description ?? ''}`}
        description={cancel?.cashMovementId ? 'O valor volta para o caixa (suprimento) se ele ainda estiver aberto.' : 'O custo sai da margem da OS.'}
        danger
        loading={doCancel.isPending}
        onConfirm={() => doCancel.mutate()}
      >
        <Textarea aria-label="Motivo" placeholder="Motivo do cancelamento (mín. 5 caracteres)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </ConfirmDialog>
    </>
  );
}

function PartsTab({ o }: { o: Order }) {
  const { can } = useAuth();
  const [term, setTerm] = useState('');
  const [qty, setQty] = useState(1);
  const products = useApi<{ items: Array<{ id: string; name: string; sku: string; kind: string }> }>(['products-parts', term], term.length >= 2 ? '/products' : null, { q: term, pageSize: 6 });
  const inv = [['os', o.id]] as const;
  const reserve = useAction((productId: string, key) => api('/stock/reserve', { method: 'POST', idempotencyKey: key, body: { orderId: o.id, productId, quantity: qty } }), { success: 'Peça reservada', invalidate: [...inv] });
  const consume = useAction((reservationId: string, key) => api('/stock/consume', { method: 'POST', idempotencyKey: key, body: { reservationId } }), { success: 'Baixa registrada', invalidate: [...inv] });
  const release = useAction((reservationId: string, key) => api('/stock/release', { method: 'POST', idempotencyKey: key, body: { reservationId } }), { success: 'Reserva liberada', invalidate: [...inv] });
  return (
    <div className="space-y-4">
      <PartPurchases o={o} />
      <h3 className="pt-2 text-sm font-semibold text-slate-700">Peças do estoque</h3>
      <Table>
        <thead>
          <tr>
            <Th>Peça</Th>
            <Th>Reservado</Th>
            <Th>Baixado</Th>
            <Th>Situação</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {o.reservations.map((r: any) => (
            <tr key={r.id}>
              <Td>
                {r.product.name} <span className="text-xs text-slate-500">{r.product.sku}</span>
              </Td>
              <Td>{r.quantity}</Td>
              <Td>{r.consumedQty}</Td>
              <Td>
                <Badge tone={r.status === 'CONSUMED' ? 'green' : r.status === 'RELEASED' ? 'gray' : 'yellow'}>{{ ACTIVE: 'Reservada', CONSUMED: 'Baixada', RELEASED: 'Liberada' }[r.status as string]}</Badge>
              </Td>
              <Td>
                {r.status === 'ACTIVE' && can('stock:reserve') && (
                  <div className="flex gap-1">
                    <Button size="sm" loading={consume.isPending} onClick={() => consume.mutate(r.id)}>
                      Dar baixa
                    </Button>
                    <Button size="sm" variant="secondary" loading={release.isPending} onClick={() => release.mutate(r.id)}>
                      Liberar
                    </Button>
                  </div>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {can('stock:reserve') && !['READY', 'CANCELED', 'RETURNED_UNREPAIRED'].includes(o.technicalStatus) && (
        <Card title="Reservar peça">
          <div className="flex flex-wrap gap-2">
            <Input aria-label="Buscar peça" placeholder="Buscar peça por nome/SKU" value={term} onChange={(e) => setTerm(e.target.value)} className="max-w-xs" />
            <Input aria-label="Quantidade" type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value)))} className="w-24" />
          </div>
          <div className="mt-2 space-y-1">
            {products.data?.items
              .filter((p) => p.kind !== 'SERVICE')
              .map((p) => (
                <button key={p.id} type="button" className="block w-full rounded border border-slate-200 p-2 text-left text-sm hover:bg-slate-50" onClick={() => reserve.mutate(p.id)}>
                  Reservar {qty}x {p.name} <span className="text-slate-500">({p.sku})</span>
                </button>
              ))}
          </div>
        </Card>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- pagamento */

function PaymentTab({ o }: { o: Order }) {
  const { can } = useAuth();
  const sessions = useApi<Array<{ id: string; register: { name: string }; branchId: string }>>(['cash-current'], can('cash:operate') ? '/cash-sessions/current' : null);
  const [parts, setParts] = useState<Array<{ method: string; amountCents: number; tenderedCents?: number }>>([]);
  const [session, setSession] = useState('');
  const r = o.receivable;
  useEffect(() => {
    if (r && !parts.length) setParts([{ method: 'PIX', amountCents: r.outstandingCents }]);
    const s = sessions.data?.find((x) => x.branchId === o.branchId);
    if (s && !session) setSession(s.id);
  }, [r, parts.length, sessions.data, session, o.branchId]);
  const createReceivable = useAction((_: void) => api('/receivables', { method: 'POST', body: { sourceType: 'SERVICE_ORDER', sourceId: o.id } }), { success: 'Cobrança gerada', invalidate: [['os', o.id]] });
  const pay = useAction(
    (_: void, key) => api('/payments', { method: 'POST', idempotencyKey: key, body: { branchId: o.branchId, cashSessionId: session, receivableId: r.id, parts: parts.map((p) => ({ ...p, tenderedCents: p.method === 'CASH' ? p.tenderedCents : undefined })) } }),
    { success: 'Pagamento registrado', invalidate: [['os', o.id]], onSuccess: () => setParts([]) },
  );
  const sum = parts.reduce((s, p) => s + p.amountCents, 0);
  return (
    <div className="space-y-4">
      <Card title="Cobrança da OS">
        {!r ? (
          <div className="space-y-2">
            <p className="text-sm text-slate-600">Sem cobrança gerada. A cobrança é criada ao aprovar o orçamento (ou taxa de diagnóstico em recusa/devolução).</p>
            {can('payment:receive') && (o.approvedQuoteId || o.diagnosisFeeCents > 0) && (
              <Button size="sm" loading={createReceivable.isPending} onClick={() => createReceivable.mutate()}>
                Gerar cobrança
              </Button>
            )}
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <dt className="text-slate-500">Total</dt>
            <dd>{formatBRL(r.amountCents)}</dd>
            <dt className="text-slate-500">Recebido (líquido)</dt>
            <dd>{formatBRL(r.paidCents - r.refundedCents)}</dd>
            <dt className="text-slate-500">Em aberto</dt>
            <dd className="font-semibold">{formatBRL(r.outstandingCents)}</dd>
            <dt className="text-slate-500">Situação</dt>
            <dd>{ORDER_PAYMENT_STATUS_LABELS[o.paymentStatus as keyof typeof ORDER_PAYMENT_STATUS_LABELS]}</dd>
          </dl>
        )}
      </Card>
      {r && r.outstandingCents > 0 && can('payment:receive') && (
        <Card title="Receber pagamento (registro manual)">
          {!sessions.data?.some((s) => s.branchId === o.branchId) ? (
            <Alert tone="yellow">
              Abra o caixa desta filial para receber. <Link className="underline" to="/app/cash">Ir para o caixa</Link>
            </Alert>
          ) : (
            <div className="space-y-2">
              <Select aria-label="Sessão de caixa" value={session} onChange={(e) => setSession(e.target.value)}>
                {sessions.data
                  ?.filter((s) => s.branchId === o.branchId)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.register.name}
                    </option>
                  ))}
              </Select>
              {parts.map((p, i) => (
                <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Select aria-label="Meio" value={p.method} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, method: e.target.value } : x)))}>
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {PAYMENT_METHOD_LABELS[m]}
                      </option>
                    ))}
                  </Select>
                  <MoneyInput value={p.amountCents} onChange={(v) => setParts(parts.map((x, j) => (j === i ? { ...x, amountCents: v } : x)))} />
                  {p.method === 'CASH' && <MoneyInput value={p.tenderedCents ?? p.amountCents} onChange={(v) => setParts(parts.map((x, j) => (j === i ? { ...x, tenderedCents: v } : x)))} />}
                  <Button variant="ghost" size="sm" onClick={() => setParts(parts.filter((_, j) => j !== i))}>
                    Remover
                  </Button>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => setParts([...parts, { method: 'CASH', amountCents: Math.max(r.outstandingCents - sum, 0) }])}>
                  + Meio de pagamento
                </Button>
                <span className="text-sm">
                  Soma: {formatBRL(sum)} / em aberto {formatBRL(r.outstandingCents)}
                </span>
              </div>
              <Button loading={pay.isPending} disabled={!session || sum <= 0 || sum > r.outstandingCents} onClick={() => pay.mutate()}>
                Registrar recebimento
              </Button>
              <p className="text-xs text-slate-500">Sem integração de adquirência: o recebimento é registrado manualmente e identificado como tal.</p>
            </div>
          )}
        </Card>
      )}
      <Card
        title="Vendas vinculadas a esta OS"
        actions={
          can('sales:create') && (
            <Link to={`/app/sales/pos?orderId=${o.id}`}>
              <Button size="sm" variant="secondary">
                Vender acessório para esta OS
              </Button>
            </Link>
          )
        }
      >
        {!o.linkedSales?.length ? (
          <p className="text-sm text-slate-500">
            Nenhuma venda vinculada. Use o botão para vender um acessório (película, capa, carregador…) ao cliente desta OS: a venda é feita no PDV, sai do estoque e fica registrada aqui.
          </p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Venda</Th>
                <Th>Itens</Th>
                <Th>Total</Th>
                <Th>Situação</Th>
              </tr>
            </thead>
            <tbody>
              {o.linkedSales.map((s: any) => (
                <tr key={s.id}>
                  <Td>
                    nº {s.number}
                    {s.confirmedAt && <span className="block text-xs text-slate-500">{formatDateTimeBR(s.confirmedAt)}</span>}
                  </Td>
                  <Td className="text-sm">{s.items.map((i: any) => `${i.qty}x ${i.description}`).join(', ')}</Td>
                  <Td>{formatBRL(s.totalCents)}</Td>
                  <Td>
                    <Badge tone={s.status === 'CONFIRMED' ? 'green' : s.status === 'CANCELED' ? 'gray' : 'yellow'}>
                      {{ CONFIRMED: 'Paga', CANCELED: 'Cancelada', REFUNDED: 'Estornada', PARTIALLY_REFUNDED: 'Estorno parcial' }[s.status as string] ?? s.status}
                    </Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="mt-2 text-xs text-slate-500">As vendas vinculadas são pagas no PDV, separadas da cobrança do serviço acima.</p>
      </Card>
    </div>
  );
}

/* --------------------------------------------------------------- entrega */

function DeliveryCard({ o }: { o: Order }) {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ receivedByName: o.customer.name, receivedByDocument: '', overrideUnpaid: false, overrideReason: '' });
  const [signature, setSignature] = useState<SignatureValue | null>(null);
  const deliver = useAction(
    (_: void, key) =>
      api(`/service-orders/${o.id}/deliver`, {
        method: 'POST',
        idempotencyKey: key,
        body: {
          version: o.version,
          ...form,
          receivedByDocument: form.receivedByDocument || null,
          signatureCaptureId: signature?.kind === 'capture' ? signature.captureId : undefined,
          signaturePng: signature?.kind === 'screen' ? signature.png : undefined,
        },
      }),
    { success: 'Entrega registrada', invalidate: [['os', o.id], ['service-orders']], onSuccess: () => setOpen(false) },
  );
  if (o.deliveryStatus !== 'READY_FOR_PICKUP' || !can('os:deliver')) return null;
  const outstanding = o.receivable?.outstandingCents ?? 0;
  return (
    <>
      <Button onClick={() => setOpen(true)}>Registrar retirada</Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Retirada do aparelho"
        wide
        footer={
          <Button loading={deliver.isPending} disabled={!form.receivedByName || (outstanding > 0 && form.overrideUnpaid && form.overrideReason.length < 5)} onClick={() => deliver.mutate()}>
            Confirmar entrega
          </Button>
        }
      >
        <div className="space-y-3">
          {outstanding > 0 && (
            <Alert tone="yellow" title={`Saldo em aberto: ${formatBRL(outstanding)}`}>
              Registre o pagamento antes da entrega ou, se autorizado, libere com motivo (auditado).
            </Alert>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Recebido por" htmlFor="rb">
              <Input id="rb" value={form.receivedByName} onChange={(e) => setForm({ ...form, receivedByName: e.target.value })} />
            </Field>
            <Field label="Documento (opcional)" htmlFor="rd">
              <Input id="rd" value={form.receivedByDocument} onChange={(e) => setForm({ ...form, receivedByDocument: e.target.value })} />
            </Field>
          </div>
          {outstanding > 0 && can('os:deliver_override') && (
            <div className="space-y-2">
              <Checkbox label="Liberar entrega com saldo em aberto" checked={form.overrideUnpaid} onChange={(v) => setForm({ ...form, overrideUnpaid: v })} />
              {form.overrideUnpaid && <Textarea aria-label="Motivo da liberação" placeholder="Motivo da liberação" value={form.overrideReason} onChange={(e) => setForm({ ...form, overrideReason: e.target.value })} />}
            </div>
          )}
          <div>
            <p className="mb-2 text-sm font-medium">Assinatura de quem retira</p>
            {open && <SignatureCollector orderId={o.id} purpose="PICKUP" paperLabel="Assinou o recibo de retirada impresso" onChange={setSignature} />}
          </div>
        </div>
      </Dialog>
    </>
  );
}

/* --------------------------------------------- termo de recebimento (depois) */

/** Colhe a assinatura do termo de recebimento quando não foi feita na abertura da OS. */
function IntakeSignButton({ o }: { o: Order }) {
  const [open, setOpen] = useState(false);
  const [signature, setSignature] = useState<SignatureValue | null>(null);
  const [signer, setSigner] = useState(o.customer.name as string);
  const sign = useAction(
    (_: void) =>
      api(`/service-orders/${o.id}/intake-signature`, {
        method: 'POST',
        body: {
          signerName: signature?.kind === 'capture' ? signature.signerName || signer : signer,
          accepted: true,
          ...(signature?.kind === 'capture' ? { signatureCaptureId: signature.captureId } : signature?.kind === 'screen' ? { signaturePng: signature.png } : { paper: true }),
        },
      }),
    { success: 'Termo de recebimento registrado', invalidate: [['os', o.id], ['os-history', o.id]], onSuccess: () => setOpen(false) },
  );
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Colher assinatura do termo
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Assinatura do termo de recebimento"
        footer={
          <Button loading={sign.isPending} disabled={!signature || (signature.kind !== 'capture' && signer.trim().length < 3)} onClick={() => sign.mutate()}>
            Registrar termo
          </Button>
        }
      >
        <div className="space-y-3">
          {open && <SignatureCollector orderId={o.id} purpose="INTAKE" paperLabel="Cliente assinou a ficha impressa" onChange={setSignature} />}
          {signature?.kind !== 'capture' && (
            <Field label="Nome de quem assina" htmlFor="isn">
              <Input id="isn" value={signer} onChange={(e) => setSigner(e.target.value)} />
            </Field>
          )}
        </div>
      </Dialog>
    </>
  );
}

/* --------------------------------------------------------------- página */

export function ServiceOrderDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const q = useOrder(id!);
  const history = useApi<Array<{ id: string; eventType: string; fromStatus: string | null; toStatus: string | null; createdAt: string; actorName: string | null }>>(['os-history', id], `/service-orders/${id}/history`);
  const [note, setNote] = useState({ text: '', visibility: 'INTERNAL' });
  const [secret, setSecret] = useState<string | null>(null);
  const [reveal, setReveal] = useState<'secret' | 'imei' | null>(null);
  const [revealReason, setRevealReason] = useState('');
  const [link, setLink] = useState<{ trackingUrl: string; trackingToken: string } | null>(null);
  const [claimReason, setClaimReason] = useState('');

  const addNote = useAction((_: void) => api(`/service-orders/${id}/notes`, { method: 'POST', body: note }), { success: 'Nota adicionada', invalidate: [['os', id!], ['os-history', id!]] });
  const reissue = useAction((_: void) => api<{ trackingUrl: string; trackingToken: string }>(`/service-orders/${id}/tracking-token`, { method: 'POST' }), { success: 'Novo link gerado', onSuccess: setLink });
  const doReveal = useAction(
    (_: void) =>
      reveal === 'secret'
        ? api<{ secret: string }>(`/service-orders/${id}/unlock-secret`, { method: 'POST', body: { reason: revealReason } }).then((r) => r.secret)
        : api<{ imei: string | null; serial: string | null }>(`/customers/devices/${q.data.device.id}/reveal`, { method: 'POST', body: { reason: revealReason } }).then((r) => `IMEI ${r.imei ?? '—'} · Serial ${r.serial ?? '—'}`),
    { onSuccess: (v) => setSecret(v as string) },
  );
  const claim = useAction((_: void) => api('/warranties/claims', { method: 'POST', body: { orderId: id, reason: claimReason } }), { success: 'Solicitação de garantia aberta', invalidate: [['os', id!]] });

  return (
    <QueryState loading={q.isLoading} error={q.error}>
      {q.data && (
        <div>
          <PageHeader
            title={`OS nº ${q.data.number}`}
            description={`${q.data.device.brand} ${q.data.device.model} · ${q.data.customer.name} · ${q.data.branch.name}`}
            actions={
              <>
                <Button size="sm" variant="secondary" onClick={() => void openPdf(`/service-orders/${id}/pdf`, { type: 'intake', format: 'A4' })}>
                  Ficha A4
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void openPdf(`/service-orders/${id}/pdf`, { type: 'intake', format: 'THERMAL' })}>
                  Térmica
                </Button>
                {q.data.deliveryStatus === 'DELIVERED' && (
                  <Button size="sm" variant="secondary" onClick={() => void openPdf(`/service-orders/${id}/pdf`, { type: 'pickup', format: 'A4' })}>
                    Recibo de retirada
                  </Button>
                )}
                {can('os:update') && (
                  <Button size="sm" variant="secondary" loading={reissue.isPending} onClick={() => reissue.mutate()}>
                    Novo link de acompanhamento
                  </Button>
                )}
              </>
            }
          />
          {link && (
            <div className="mb-3">
              <Alert tone="green" title="Link de acompanhamento (o anterior foi revogado)">
                <p className="break-all font-mono text-xs">{link.trackingUrl}</p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => void navigator.clipboard.writeText(link.trackingUrl)}>
                    Copiar
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => void openPdf(`/service-orders/${id}/pdf`, { type: 'intake', format: 'THERMAL' }, { 'X-Tracking-Token': link.trackingToken })}>
                    Imprimir comprovante com QR
                  </Button>
                </div>
              </Alert>
            </div>
          )}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <StatusBadge status={q.data.technicalStatus} />
            <DeliveryBadge status={q.data.deliveryStatus} />
            <Badge tone="gray">{ORDER_PAYMENT_STATUS_LABELS[q.data.paymentStatus as keyof typeof ORDER_PAYMENT_STATUS_LABELS]}</Badge>
            <Badge tone="blue">{PRIORITY_LABELS[q.data.priority as keyof typeof PRIORITY_LABELS]}</Badge>
            {q.data.warrantyOfOrderId && <Badge tone="purple">Retorno em garantia</Badge>}
            {q.data.slaDueAt && new Date(q.data.slaDueAt) < new Date() && !['READY', 'CANCELED'].includes(q.data.technicalStatus) && <Badge tone="red">SLA estourado</Badge>}
          </div>
          <div className="mb-4 flex flex-wrap gap-2">
            <StateActions o={q.data} />
            <DeliveryCard o={q.data} />
          </div>
          <Tabs
            tabs={[
              {
                value: 'summary',
                label: 'Resumo',
                content: (
                  <div className="grid gap-4 md:grid-cols-2">
                    <Card title="Cliente">
                      <p className="font-medium">
                        <Link className="underline" to={`/app/customers/${q.data.customer.id}`}>
                          {q.data.customer.name}
                        </Link>
                      </p>
                      <p className="text-sm text-slate-600">{formatPhoneBR(q.data.customer.phoneE164)}</p>
                      {q.data.customer.email && <p className="text-sm text-slate-600">{q.data.customer.email}</p>}
                    </Card>
                    <Card title="Aparelho">
                      <p>
                        {q.data.device.brand} {q.data.device.model} {q.data.device.color ?? ''}
                      </p>
                      <p className="text-sm text-slate-600">IMEI {q.data.device.imeiMasked ?? '—'}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {can('os:unlock_secret') && (q.data.device.imeiMasked || q.data.device.serialMasked) && (
                          <Button size="sm" variant="ghost" onClick={() => setReveal('imei')}>
                            Exibir IMEI completo
                          </Button>
                        )}
                        {can('os:unlock_secret') && q.data.hasUnlockSecret && (
                          <Button size="sm" variant="ghost" onClick={() => setReveal('secret')}>
                            Ver senha de desbloqueio
                          </Button>
                        )}
                      </div>
                    </Card>
                    <Card title="Defeito e diagnóstico">
                      <p className="text-sm">
                        <strong>Relatado:</strong> {q.data.reportedIssue}
                      </p>
                      {q.data.diagnosis && (
                        <p className="mt-2 text-sm">
                          <strong>Diagnóstico:</strong> {q.data.diagnosis}
                        </p>
                      )}
                      {q.data.technicalReport && (
                        <p className="mt-2 text-sm">
                          <strong>Laudo (interno):</strong> {q.data.technicalReport}
                        </p>
                      )}
                      {q.data.diagnosisFeeCents > 0 && <p className="mt-2 text-xs text-slate-500">Taxa de diagnóstico informada: {formatBRL(q.data.diagnosisFeeCents)}</p>}
                    </Card>
                    <Card title="Recebimento">
                      <p className="text-sm">Entrada: {formatDateTimeBR(q.data.receivedAt)}</p>
                      <p className="text-sm">Previsão: {q.data.estimatedDeliveryAt ? formatDateBR(q.data.estimatedDeliveryAt) : 'a definir'}</p>
                      <p className="text-sm">Atendente: {q.data.userNames[q.data.createdBy] ?? '—'}</p>
                      <p className="text-sm">Técnico: {q.data.assignedTechnicianId ? (q.data.userNames[q.data.assignedTechnicianId] ?? '—') : 'não atribuído'}</p>
                      <p className="mt-2 text-sm">
                        <strong>Acessórios:</strong> {q.data.accessories.filter((a: any) => a.received).map((a: any) => `${ACCESSORY_LABELS[a.type as keyof typeof ACCESSORY_LABELS]}${a.description ? ` (${a.description})` : ''}`).join(', ') || 'nenhum'}
                      </p>
                      {q.data.terms.some((t: any) => t.termType === 'INTAKE') ? (
                        <p className="mt-2 text-xs text-slate-500">Termo de recebimento assinado</p>
                      ) : (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="text-xs text-amber-700">Termo de recebimento ainda não assinado</span>
                          {can('os:create') && <IntakeSignButton o={q.data} />}
                        </div>
                      )}
                      {q.data.warrantyUntil && <p className="text-sm">Garantia até {formatDateBR(q.data.warrantyUntil)}</p>}
                    </Card>
                    {q.data.checklists.map((c: any) => (
                      <Card key={c.id} title={c.phase === 'INTAKE' ? 'Checklist de entrada' : 'Checklist pós-reparo'}>
                        <ul className="space-y-1 text-sm">
                          {(c.itemsJson as any[]).map((it) => (
                            <li key={it.key}>
                              {it.label}: <strong className={it.ok === false ? 'text-red-700' : undefined}>{it.ok === null ? 'Não testado' : it.ok ? 'OK' : 'Com defeito'}</strong>
                              {it.notes ? ` — ${it.notes}` : ''}
                            </li>
                          ))}
                        </ul>
                      </Card>
                    ))}
                  </div>
                ),
              },
              { value: 'quote', label: 'Orçamento', content: <QuoteTab o={q.data} /> },
              { value: 'parts', label: 'Peças', content: <PartsTab o={q.data} /> },
              { value: 'payment', label: 'Pagamento', content: <PaymentTab o={q.data} /> },
              {
                value: 'history',
                label: 'Histórico',
                content: (
                  <div className="grid gap-4 md:grid-cols-2">
                    <Card title="Linha do tempo">
                      <ol className="space-y-2 text-sm">
                        {history.data?.map((e) => (
                          <li key={e.id} className="border-l-2 border-brand-600 pl-3">
                            <p className="font-medium">{ORDER_EVENT_LABELS[e.eventType] ?? e.eventType.replaceAll('_', ' ')}</p>
                            <p className="text-xs text-slate-500">
                              {formatDateTimeBR(e.createdAt)} · {e.actorName ?? 'Sistema'}
                              {e.toStatus ? ` · ${statusLabel(e.fromStatus)} → ${statusLabel(e.toStatus)}` : ''}
                            </p>
                          </li>
                        ))}
                      </ol>
                    </Card>
                    <Card title="Notas">
                      <div className="space-y-2">
                        <Textarea aria-label="Nota" value={note.text} onChange={(e) => setNote({ ...note, text: e.target.value })} />
                        <div className="flex gap-2">
                          <Select aria-label="Visibilidade" value={note.visibility} onChange={(e) => setNote({ ...note, visibility: e.target.value })} className="w-auto">
                            <option value="INTERNAL">Interna (nunca no portal)</option>
                            <option value="CUSTOMER">Visível ao cliente</option>
                          </Select>
                          <Button disabled={!note.text.trim()} loading={addNote.isPending} onClick={() => addNote.mutate()}>
                            Adicionar
                          </Button>
                        </div>
                      </div>
                      <ul className="mt-3 space-y-2 text-sm">
                        {q.data.notes.map((n: any) => (
                          <li key={n.id} className="rounded bg-slate-50 p-2">
                            <p>{n.text}</p>
                            <p className="text-xs text-slate-500">
                              {formatDateTimeBR(n.createdAt)} · {q.data.userNames[n.authorId] ?? '—'} · {n.visibility === 'INTERNAL' ? 'interna' : 'cliente'}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </Card>
                  </div>
                ),
              },
              {
                value: 'warranty',
                label: 'Garantia',
                content: (
                  <div className="space-y-3">
                    {q.data.warrantyClaims.map((c: any) => (
                      <Card key={c.id} title={`Solicitação de ${formatDateBR(c.createdAt)}`}>
                        <p className="text-sm">{c.reason}</p>
                        <Link className="text-sm text-brand-700 underline-offset-2 hover:underline" to="/app/warranties">
                          Gerenciar em Garantias
                        </Link>
                      </Card>
                    ))}
                    {q.data.deliveryStatus === 'DELIVERED' && can('warranty:manage') ? (
                      <Card title="Abrir solicitação de garantia">
                        <Textarea aria-label="Motivo" placeholder="Descreva o problema relatado pelo cliente" value={claimReason} onChange={(e) => setClaimReason(e.target.value)} />
                        <Button className="mt-2" disabled={claimReason.trim().length < 5} loading={claim.isPending} onClick={() => claim.mutate()}>
                          Abrir solicitação
                        </Button>
                      </Card>
                    ) : (
                      <p className="text-sm text-slate-500">Garantia disponível após a entrega.</p>
                    )}
                  </div>
                ),
              },
            ]}
          />
          <Dialog
            open={Boolean(reveal)}
            onOpenChange={() => {
              setReveal(null);
              setSecret(null);
              setRevealReason('');
            }}
            title={reveal === 'secret' ? 'Senha de desbloqueio' : 'Identificadores do aparelho'}
            description="Acesso a dado sensível: o motivo é registrado na auditoria."
          >
            {secret ? (
              <p className="rounded bg-slate-100 p-3 font-mono">{secret}</p>
            ) : (
              <div className="space-y-2">
                <Input aria-label="Motivo" placeholder="Motivo do acesso" value={revealReason} onChange={(e) => setRevealReason(e.target.value)} />
                <Button disabled={revealReason.length < 5} loading={doReveal.isPending} onClick={() => doReveal.mutate()}>
                  Exibir
                </Button>
              </div>
            )}
          </Dialog>
        </div>
      )}
    </QueryState>
  );
}
