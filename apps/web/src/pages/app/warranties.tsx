import { useState } from 'react';
import { Link } from 'react-router';
import { Pagination, QueryState, useAction, useApi, useUrlFilters } from '@/components/data';
import { Badge, Button, Checkbox, Dialog, Field, PageHeader, Select, Table, Td, Textarea, Th } from '@/components/ui';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateBR, WARRANTY_STATUS_LABELS } from '@/lib/utils';

/* eslint-disable @typescript-eslint/no-explicit-any */
const NEXT: Record<string, string[]> = { OPEN: ['IN_ANALYSIS', 'DENIED'], IN_ANALYSIS: ['APPROVED', 'DENIED'], APPROVED: ['RESOLVED'], DENIED: ['OPEN'], RESOLVED: [] };

export function WarrantiesPage() {
  const { can } = useAuth();
  const [f, setF] = useUrlFilters({ status: '', page: '1' });
  const q = useApi<Paginated<any>>(['warranties'], '/warranties/claims', { status: f.status, page: f.page });
  const [edit, setEdit] = useState<any | null>(null);
  const [form, setForm] = useState({ status: '', triageNotes: '', resolution: '', denialReason: '', createReturnOrder: false });
  const save = useAction(
    (_: void) =>
      api(`/warranties/claims/${edit.id}`, {
        method: 'PATCH',
        body: { status: form.status || undefined, triageNotes: form.triageNotes || null, resolution: form.resolution || null, denialReason: form.denialReason || null, createReturnOrder: form.createReturnOrder },
      }),
    { success: 'Garantia atualizada', invalidate: [['warranties']], onSuccess: () => setEdit(null) },
  );
  return (
    <div>
      <PageHeader title="Garantias e pós-venda" description="Retornos vinculados à OS original. O prazo contratual não reduz a garantia legal." />
      <Select aria-label="Status" className="mb-3 max-w-xs" value={f.status} onChange={(e) => setF({ status: e.target.value })}>
        <option value="">Todas</option>
        {Object.entries(WARRANTY_STATUS_LABELS).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </Select>
      <QueryState loading={q.isLoading} error={q.error} empty={q.data?.items.length === 0} emptyTitle="Nenhuma solicitação">
        <Table>
          <thead>
            <tr>
              <Th>OS original</Th>
              <Th>Cliente</Th>
              <Th>Motivo</Th>
              <Th>Garantia contratual</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {q.data?.items.map((c) => (
              <tr key={c.id}>
                <Td>
                  <Link className="text-brand-700 underline" to={`/app/service-orders/${c.orderId}`}>
                    {c.order.number}
                  </Link>
                </Td>
                <Td>{c.order.customer.name}</Td>
                <Td className="max-w-xs truncate">{c.reason}</Td>
                <Td>{c.order.warrantyUntil ? `até ${formatDateBR(c.order.warrantyUntil)}` : '—'}</Td>
                <Td>
                  <Badge tone={c.status === 'RESOLVED' ? 'green' : c.status === 'DENIED' ? 'red' : 'yellow'}>{WARRANTY_STATUS_LABELS[c.status as keyof typeof WARRANTY_STATUS_LABELS]}</Badge>
                </Td>
                <Td>
                  {can('warranty:manage') && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setEdit(c);
                        setForm({ status: '', triageNotes: c.triageNotes ?? '', resolution: c.resolution ?? '', denialReason: c.denialReason ?? '', createReturnOrder: false });
                      }}
                    >
                      Tratar
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {q.data && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={(p) => setF({ page: String(p) })} />}
      </QueryState>
      <Dialog open={Boolean(edit)} onOpenChange={() => setEdit(null)} title={`Garantia da OS ${edit?.order.number}`} footer={<Button loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button>}>
        {edit && (
          <div className="space-y-3">
            <p className="text-sm">{edit.reason}</p>
            <Field label="Mudar status para" htmlFor="ws">
              <Select id="ws" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="">(manter)</option>
                {NEXT[edit.status]!.map((s) => (
                  <option key={s} value={s}>
                    {WARRANTY_STATUS_LABELS[s as keyof typeof WARRANTY_STATUS_LABELS]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Triagem/diagnóstico" htmlFor="wt">
              <Textarea id="wt" value={form.triageNotes} onChange={(e) => setForm({ ...form, triageNotes: e.target.value })} />
            </Field>
            {form.status === 'DENIED' && (
              <Field label="Fundamentação da negativa (obrigatória)" htmlFor="wd">
                <Textarea id="wd" value={form.denialReason} onChange={(e) => setForm({ ...form, denialReason: e.target.value })} />
              </Field>
            )}
            <Field label="Resolução" htmlFor="wr">
              <Textarea id="wr" value={form.resolution} onChange={(e) => setForm({ ...form, resolution: e.target.value })} />
            </Field>
            {!edit.returnOrderId && <Checkbox label="Abrir OS de retorno em garantia (sem cobrança)" checked={form.createReturnOrder} onChange={(v) => setForm({ ...form, createReturnOrder: v })} />}
          </div>
        )}
      </Dialog>
    </div>
  );
}
