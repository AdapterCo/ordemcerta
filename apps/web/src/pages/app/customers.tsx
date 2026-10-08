import { zodResolver } from '@hookform/resolvers/zod';
import { customerSchema, type TechnicalStatus } from '@ordemcerta/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import type { z } from 'zod';
import { Pagination, QueryState, StatusBadge, useAction, useApi, useUrlFilters } from '@/components/data';
import { Alert, Badge, Button, Card, Checkbox, ConfirmDialog, Dialog, Field, Input, PageHeader, Table, Td, Th } from '@/components/ui';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatBRL, formatDateBR, formatDateTimeBR, formatDocument, formatPhoneBR } from '@/lib/utils';

interface CustomerRow {
  id: string;
  name: string;
  phoneE164: string | null;
  email: string | null;
  document: string | null;
  _count: { serviceOrders: number };
}

function CustomerForm({ initial, onSaved }: { initial?: Partial<z.input<typeof customerSchema>> & { id?: string }; onSaved: (id: string) => void }) {
  const form = useForm<z.input<typeof customerSchema>>({ resolver: zodResolver(customerSchema), defaultValues: { consentWhatsapp: true, ...initial } });
  const [dup, setDup] = useState<{ existingId: string; existingName: string } | null>(null);
  const e = form.formState.errors;
  const save = form.handleSubmit(async (v) => {
    try {
      const r = initial?.id
        ? await api<{ id: string }>(`/customers/${initial.id}`, { method: 'PATCH', body: v })
        : await api<{ id: string }>('/customers', { method: 'POST', body: v, query: { allowDuplicate: dup ? 'true' : undefined } });
      onSaved(r.id);
    } catch (err) {
      const d = (err as { details?: { existingId?: string; existingName?: string } }).details;
      if (d?.existingId) setDup({ existingId: d.existingId, existingName: d.existingName ?? '' });
      else throw err;
    }
  });
  return (
    <form onSubmit={save} className="grid gap-3 sm:grid-cols-2" noValidate>
      {dup && (
        <div className="sm:col-span-2">
          <Alert tone="yellow" title="Possível duplicidade">
            Já existe <Link className="underline" to={`/app/customers/${dup.existingId}`}>{dup.existingName}</Link> com este telefone/documento. Salve novamente para cadastrar mesmo assim.
          </Alert>
        </div>
      )}
      <Field label="Nome" htmlFor="name" error={e.name?.message} className="sm:col-span-2">
        <Input id="name" {...form.register('name')} />
      </Field>
      <Field label="Telefone" htmlFor="phone" error={e.phone?.message}>
        <Input id="phone" type="tel" {...form.register('phone')} />
      </Field>
      <Field label="WhatsApp" htmlFor="wa" error={e.whatsapp?.message}>
        <Input id="wa" type="tel" {...form.register('whatsapp')} />
      </Field>
      <Field label="E-mail" htmlFor="email" error={e.email?.message}>
        <Input id="email" type="email" {...form.register('email')} />
      </Field>
      <Field label="CPF/CNPJ" htmlFor="doc" error={e.document?.message}>
        <Input id="doc" {...form.register('document')} />
      </Field>
      <Field label="Observações" htmlFor="notes" className="sm:col-span-2">
        <Input id="notes" {...form.register('notes')} />
      </Field>
      <div className="sm:col-span-2">
        <Checkbox label="Aceita avisos do serviço por WhatsApp (opt-in)" checked={Boolean(form.watch('consentWhatsapp'))} onChange={(v) => form.setValue('consentWhatsapp', v)} />
      </div>
      <Button type="submit" loading={form.formState.isSubmitting} className="sm:col-span-2">
        Salvar
      </Button>
    </form>
  );
}

export function CustomersPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const [f, setF] = useUrlFilters({ q: '', page: '1' });
  const [creating, setCreating] = useState(sp.get('new') === '1');
  const q = useApi<Paginated<CustomerRow>>(['customers'], '/customers', { q: f.q, page: f.page });
  return (
    <div>
      <PageHeader title="Clientes" actions={can('customer:edit') && <Button onClick={() => setCreating(true)}>Novo cliente</Button>} />
      <Input aria-label="Buscar" className="mb-3 max-w-md" placeholder="Nome, telefone, CPF/CNPJ ou e-mail" defaultValue={f.q} onKeyDown={(e) => e.key === 'Enter' && setF({ q: (e.target as HTMLInputElement).value })} />
      <QueryState loading={q.isLoading} error={q.error} empty={q.data?.items.length === 0}>
        <Table>
          <thead>
            <tr>
              <Th>Nome</Th>
              <Th>Telefone</Th>
              <Th>Documento</Th>
              <Th>OS</Th>
            </tr>
          </thead>
          <tbody>
            {q.data?.items.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <Td>
                  <Link className="font-medium text-brand-700 underline" to={`/app/customers/${c.id}`}>
                    {c.name}
                  </Link>
                </Td>
                <Td>{formatPhoneBR(c.phoneE164)}</Td>
                <Td>{formatDocument(c.document)}</Td>
                <Td>{c._count.serviceOrders}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {q.data && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={(p) => setF({ page: String(p) })} />}
      </QueryState>
      <Dialog open={creating} onOpenChange={setCreating} title="Novo cliente" wide>
        <CustomerForm onSaved={(id) => navigate(`/app/customers/${id}`)} />
      </Dialog>
    </div>
  );
}

export function CustomerDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const q = useApi<any>(['customer', id], `/customers/${id}`); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [editing, setEditing] = useState(false);
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [device, setDevice] = useState({ brand: '', model: '', color: '', imei: '', serial: '' });
  const [anon, setAnon] = useState(false);
  const addDevice = useAction((_: void) => api(`/customers/${id}/devices`, { method: 'POST', body: { ...device, imei: device.imei || null, serial: device.serial || null, color: device.color || null } }), {
    success: 'Aparelho cadastrado',
    invalidate: [['customer', id!]],
    onSuccess: () => setDeviceOpen(false),
  });
  const consent = useAction((granted: boolean) => api(`/customers/${id}/consents`, { method: 'POST', body: { channel: 'WHATSAPP', purpose: 'SERVICE_NOTIFICATIONS', granted, source: 'balcao' } }), {
    success: 'Consentimento atualizado',
    invalidate: [['customer', id!]],
  });
  const anonymize = useAction((_: void) => api(`/customers/${id}/anonymize`, { method: 'POST' }), { success: 'Cliente anonimizado', invalidate: [['customer', id!]], onSuccess: () => setAnon(false) });
  const exportData = async () => {
    const data = await api(`/customers/${id}/export`);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dados-cliente-${id}.json`;
    a.click();
  };
  const c = q.data;
  const waConsent = c?.consents.find((x: { channel: string; revokedAt: string | null }) => x.channel === 'WHATSAPP' && !x.revokedAt);
  return (
    <QueryState loading={q.isLoading} error={q.error}>
      {c && (
        <div className="space-y-4">
          <PageHeader
            title={c.name}
            description={`${formatPhoneBR(c.phoneE164)} ${c.email ? `· ${c.email}` : ''}`}
            actions={
              <>
                {can('os:create') && (
                  <Link to="/app/service-orders/new">
                    <Button>Nova OS</Button>
                  </Link>
                )}
                {can('customer:edit') && (
                  <Button variant="secondary" onClick={() => setEditing(true)}>
                    Editar
                  </Button>
                )}
                {can('customer:export') && (
                  <Button variant="secondary" onClick={() => void exportData()}>
                    Exportar dados (LGPD)
                  </Button>
                )}
                {can('customer:anonymize') && !c.anonymizedAt && (
                  <Button variant="danger" onClick={() => setAnon(true)}>
                    Anonimizar
                  </Button>
                )}
              </>
            }
          />
          {c.anonymizedAt && <Alert tone="yellow">Cliente anonimizado em {formatDateTimeBR(c.anonymizedAt)}. Registros legais preservados.</Alert>}
          <div className="grid gap-4 md:grid-cols-2">
            <Card title="Dados">
              <p className="text-sm">Documento: {formatDocument(c.document) || '—'}</p>
              <p className="text-sm">WhatsApp: {formatPhoneBR(c.whatsappE164) || '—'}</p>
              <div className="mt-2 flex items-center gap-2 text-sm">
                Opt-in WhatsApp: <Badge tone={waConsent ? 'green' : 'gray'}>{waConsent ? 'concedido' : 'não'}</Badge>
                {can('customer:edit') && (
                  <Button size="sm" variant="ghost" onClick={() => consent.mutate(!waConsent)}>
                    {waConsent ? 'Revogar' : 'Registrar opt-in'}
                  </Button>
                )}
              </div>
            </Card>
            <Card title="Aparelhos" actions={can('customer:edit') && <Button size="sm" variant="secondary" onClick={() => setDeviceOpen(true)}>Adicionar</Button>}>
              <ul className="space-y-1 text-sm">
                {c.devices.map((d: { id: string; brand: string; model: string; color: string | null; imeiMasked: string | null }) => (
                  <li key={d.id}>
                    {d.brand} {d.model} {d.color ?? ''} {d.imeiMasked && <span className="text-slate-500">· IMEI {d.imeiMasked}</span>}
                  </li>
                ))}
              </ul>
            </Card>
          </div>
          <Card title="Histórico de OS">
            <Table>
              <thead>
                <tr>
                  <Th>OS</Th>
                  <Th>Status</Th>
                  <Th>Total</Th>
                  <Th>Entrada</Th>
                </tr>
              </thead>
              <tbody>
                {c.serviceOrders.map((o: { id: string; number: number; technicalStatus: TechnicalStatus; totalCents: number; createdAt: string }) => (
                  <tr key={o.id}>
                    <Td>
                      <Link className="text-brand-700 underline" to={`/app/service-orders/${o.id}`}>
                        {o.number}
                      </Link>
                    </Td>
                    <Td>
                      <StatusBadge status={o.technicalStatus} />
                    </Td>
                    <Td>{formatBRL(o.totalCents)}</Td>
                    <Td>{formatDateBR(o.createdAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
          <Dialog open={editing} onOpenChange={setEditing} title="Editar cliente" wide>
            <CustomerForm
              initial={{ id: c.id, name: c.name, phone: c.phoneE164 ?? '', whatsapp: c.whatsappE164, email: c.email, document: c.document, notes: c.notes }}
              onSaved={() => {
                setEditing(false);
                void q.refetch();
              }}
            />
          </Dialog>
          <Dialog
            open={deviceOpen}
            onOpenChange={setDeviceOpen}
            title="Novo aparelho"
            footer={
              <Button loading={addDevice.isPending} disabled={!device.brand || !device.model} onClick={() => addDevice.mutate()}>
                Salvar
              </Button>
            }
          >
            <div className="grid gap-2 sm:grid-cols-2">
              {(['brand', 'model', 'color', 'imei', 'serial'] as const).map((k) => (
                <Field key={k} label={{ brand: 'Marca', model: 'Modelo', color: 'Cor', imei: 'IMEI', serial: 'Serial' }[k]} htmlFor={`d-${k}`}>
                  <Input id={`d-${k}`} value={device[k]} onChange={(e) => setDevice({ ...device, [k]: e.target.value })} />
                </Field>
              ))}
            </div>
          </Dialog>
          <ConfirmDialog
            open={anon}
            onOpenChange={setAnon}
            danger
            title="Anonimizar cliente"
            description="Remove nome, contatos, documento e identificadores dos aparelhos. OS e registros financeiros são preservados por obrigação legal. Irreversível."
            confirmLabel="Anonimizar"
            loading={anonymize.isPending}
            onConfirm={() => anonymize.mutate()}
          />
        </div>
      )}
    </QueryState>
  );
}
