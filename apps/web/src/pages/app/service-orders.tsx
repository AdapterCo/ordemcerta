import { zodResolver } from '@hookform/resolvers/zod';
import { ACCESSORY_TYPES, customerSchema, PRIORITIES, TECHNICAL_STATUSES, type AccessoryType, type TechnicalStatus } from '@ordemcerta/shared';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { z } from 'zod';
import { DeliveryBadge, Pagination, PRIORITY_TONE, QueryState, StatusBadge, useAction, useApi, useUrlFilters } from '@/components/data';
import { SignaturePad } from '@/components/signature-pad';
import { Alert, Badge, Button, Card, Checkbox, Dialog, Field, Input, MoneyInput, PageHeader, Select, Table, Td, Textarea, Th } from '@/components/ui';
import { api, errorMessage, openPdf, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ACCESSORY_LABELS, formatDateBR, formatDateTimeBR, formatPhoneBR, PRIORITY_LABELS, TECHNICAL_STATUS_LABELS } from '@/lib/utils';

interface OrderRow {
  id: string;
  number: number;
  technicalStatus: TechnicalStatus;
  deliveryStatus: 'IN_CUSTODY' | 'READY_FOR_PICKUP' | 'DELIVERED' | 'RETURNED_UNREPAIRED';
  priority: string;
  receivedAt: string;
  estimatedDeliveryAt: string | null;
  customer: { name: string; phoneE164: string | null };
  device: { brand: string; model: string };
  branch: { name: string };
  technicianName: string | null;
}

export function ServiceOrdersPage() {
  const { branchId } = useAuth();
  const [f, setF] = useUrlFilters({ q: '', status: '', overdue: '', page: '1', from: '', to: '' });
  const q = useApi<Paginated<OrderRow>>(['service-orders', branchId], '/service-orders', {
    q: f.q,
    status: f.status,
    overdue: f.overdue,
    branchId: branchId ?? undefined,
    page: f.page,
    from: f.from ? new Date(f.from).toISOString() : undefined,
    to: f.to ? new Date(`${f.to}T23:59:59`).toISOString() : undefined,
  });
  return (
    <div>
      <PageHeader
        title="Ordens de serviço"
        actions={
          <Link to="/app/service-orders/new">
            <Button>Nova OS</Button>
          </Link>
        }
      />
      <Card className="mb-3">
        <div className="grid gap-2 sm:grid-cols-5">
          <Input aria-label="Busca" placeholder="Número, cliente, telefone, modelo, IMEI (4 últ.)" defaultValue={f.q} onKeyDown={(e) => e.key === 'Enter' && setF({ q: (e.target as HTMLInputElement).value })} className="sm:col-span-2" />
          <Select aria-label="Status" value={f.status} onChange={(e) => setF({ status: e.target.value })}>
            <option value="">Todos os status</option>
            {TECHNICAL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {TECHNICAL_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          <Input aria-label="De" type="date" value={f.from} onChange={(e) => setF({ from: e.target.value })} />
          <Input aria-label="Até" type="date" value={f.to} onChange={(e) => setF({ to: e.target.value })} />
        </div>
        <div className="mt-2">
          <Checkbox label="Somente atrasadas" checked={f.overdue === 'true'} onChange={(v) => setF({ overdue: v ? 'true' : '' })} />
        </div>
      </Card>
      <QueryState loading={q.isLoading} error={q.error} empty={q.data?.items.length === 0} emptyTitle="Nenhuma OS encontrada">
        <Table>
          <thead>
            <tr>
              <Th>OS</Th>
              <Th>Cliente</Th>
              <Th>Aparelho</Th>
              <Th>Status</Th>
              <Th>Entrega</Th>
              <Th>Prioridade</Th>
              <Th>Técnico</Th>
              <Th>Entrada</Th>
              <Th>Previsão</Th>
            </tr>
          </thead>
          <tbody>
            {q.data?.items.map((o) => (
              <tr key={o.id} className="hover:bg-slate-50">
                <Td>
                  <Link className="font-medium text-brand-700 underline" to={`/app/service-orders/${o.id}`}>
                    {o.number}
                  </Link>
                </Td>
                <Td>
                  {o.customer.name}
                  <div className="text-xs text-slate-500">{formatPhoneBR(o.customer.phoneE164)}</div>
                </Td>
                <Td>
                  {o.device.brand} {o.device.model}
                </Td>
                <Td>
                  <StatusBadge status={o.technicalStatus} />
                </Td>
                <Td>
                  <DeliveryBadge status={o.deliveryStatus} />
                </Td>
                <Td>
                  <Badge tone={PRIORITY_TONE[o.priority]}>{PRIORITY_LABELS[o.priority as keyof typeof PRIORITY_LABELS]}</Badge>
                </Td>
                <Td>{o.technicianName ?? '—'}</Td>
                <Td>{formatDateTimeBR(o.receivedAt)}</Td>
                <Td className={o.estimatedDeliveryAt && new Date(o.estimatedDeliveryAt) < new Date() && o.deliveryStatus === 'IN_CUSTODY' ? 'font-semibold text-red-600' : ''}>
                  {o.estimatedDeliveryAt ? formatDateBR(o.estimatedDeliveryAt) : '—'}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {q.data && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={(p) => setF({ page: String(p) })} />}
      </QueryState>
    </div>
  );
}

/* =================================================================== recepção */

interface CustomerHit {
  id: string;
  name: string;
  phoneE164: string | null;
  document: string | null;
}
interface DeviceDto {
  id: string;
  brand: string;
  model: string;
  color: string | null;
  imeiMasked: string | null;
}

function CustomerPicker({ value, onChange }: { value: CustomerHit | null; onChange: (c: CustomerHit | null) => void }) {
  const [term, setTerm] = useState('');
  const [creating, setCreating] = useState(false);
  const search = useApi<Paginated<CustomerHit>>(['customers-search', term], term.length >= 2 ? '/customers' : null, { q: term, pageSize: 8 });
  const form = useForm<z.input<typeof customerSchema>>({ resolver: zodResolver(customerSchema), defaultValues: { consentWhatsapp: true } });
  const create = form.handleSubmit(async (v) => {
    try {
      const c = await api<CustomerHit>('/customers', { method: 'POST', body: v });
      onChange(c);
      setCreating(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  });
  if (value)
    return (
      <div className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 p-3">
        <div>
          <p className="font-medium">{value.name}</p>
          <p className="text-sm text-slate-500">{formatPhoneBR(value.phoneE164)}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
          Trocar
        </Button>
      </div>
    );
  return (
    <div className="space-y-2">
      <Input aria-label="Buscar cliente" placeholder="Buscar por nome, telefone ou CPF/CNPJ" value={term} onChange={(e) => setTerm(e.target.value)} />
      {search.data?.items.map((c) => (
        <button key={c.id} type="button" className="block w-full rounded border border-slate-200 p-2 text-left text-sm hover:bg-slate-50" onClick={() => onChange(c)}>
          {c.name} <span className="text-slate-500">{formatPhoneBR(c.phoneE164)}</span>
        </button>
      ))}
      <Button type="button" variant="secondary" size="sm" onClick={() => setCreating(true)}>
        Novo cliente
      </Button>
      <Dialog open={creating} onOpenChange={setCreating} title="Novo cliente">
        <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome" htmlFor="c-name" error={form.formState.errors.name?.message} className="sm:col-span-2">
            <Input id="c-name" {...form.register('name')} />
          </Field>
          <Field label="Telefone" htmlFor="c-phone" error={form.formState.errors.phone?.message}>
            <Input id="c-phone" type="tel" {...form.register('phone')} />
          </Field>
          <Field label="WhatsApp (se diferente)" htmlFor="c-wa" error={form.formState.errors.whatsapp?.message}>
            <Input id="c-wa" type="tel" {...form.register('whatsapp')} />
          </Field>
          <Field label="E-mail" htmlFor="c-email" error={form.formState.errors.email?.message}>
            <Input id="c-email" type="email" {...form.register('email')} />
          </Field>
          <Field label="CPF/CNPJ (opcional)" htmlFor="c-doc" error={form.formState.errors.document?.message}>
            <Input id="c-doc" {...form.register('document')} />
          </Field>
          <div className="sm:col-span-2">
            <Checkbox label="Cliente autoriza avisos do serviço por WhatsApp (opt-in)" checked={Boolean(form.watch('consentWhatsapp'))} onChange={(v) => form.setValue('consentWhatsapp', v)} />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" loading={form.formState.isSubmitting}>
              Salvar cliente
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

interface ChecklistItem {
  key: string;
  label: string;
  ok: boolean | null;
  notes?: string;
}

export function ChecklistEditor({ items, onChange }: { items: ChecklistItem[]; onChange: (i: ChecklistItem[]) => void }) {
  return (
    <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
      {items.map((it, idx) => (
        <div key={it.key} className="flex flex-wrap items-center gap-2 p-2 text-sm">
          <span className="min-w-40 flex-1">{it.label}</span>
          {([
            [true, 'OK'],
            [false, 'Falha'],
            [null, 'N/T'],
          ] as const).map(([v, l]) => (
            <label key={l} className="inline-flex items-center gap-1">
              <input type="radio" name={`chk-${it.key}`} checked={it.ok === v} onChange={() => onChange(items.map((x, i) => (i === idx ? { ...x, ok: v } : x)))} />
              {l}
            </label>
          ))}
          <input
            aria-label={`Observação ${it.label}`}
            className="h-8 w-full rounded border border-slate-300 px-2 sm:w-48"
            placeholder="Observação"
            value={it.notes ?? ''}
            onChange={(e) => onChange(items.map((x, i) => (i === idx ? { ...x, notes: e.target.value } : x)))}
          />
        </div>
      ))}
    </div>
  );
}

interface Created {
  order: { id: string; number: number };
  trackingToken: string;
  trackingUrl: string;
}

export function NewServiceOrderPage() {
  const { branchId, me, can } = useAuth();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState<CustomerHit | null>(null);
  const devices = useApi<DeviceDto[]>(['devices', customer?.id], customer ? `/customers/${customer.id}/devices` : null);
  const settings = useApi<Record<string, unknown>>(['settings', branchId], '/settings', { branchId: branchId ?? undefined });
  const techs = useApi<Array<{ branchId: string; membership: { user: { id: string; name: string } } }>>(['technicians', branchId], can('os:assign') ? '/members/technicians' : null, { branchId: branchId ?? undefined });
  const [deviceId, setDeviceId] = useState<string>('new');
  const [device, setDevice] = useState({ brand: '', model: '', color: '', imei: '', serial: '' });
  const [form, setForm] = useState({
    reportedIssue: '',
    category: 'REPAIR',
    priority: 'NORMAL',
    estimatedDeliveryAt: '',
    notes: '',
    unlockSecret: '',
    technicianUserId: '',
    requiresApproval: true,
  });
  const [fee, setFee] = useState(0);
  const [accessories, setAccessories] = useState<Record<AccessoryType, { received: boolean; description: string }>>(
    Object.fromEntries(ACCESSORY_TYPES.map((t) => [t, { received: false, description: '' }])) as Record<AccessoryType, { received: boolean; description: string }>,
  );
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [created, setCreated] = useState<Created | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [signer, setSigner] = useState('');

  useEffect(() => {
    const items = settings.data?.['os.intake_checklist'] as Array<{ key: string; label: string }> | undefined;
    if (items && !checklist.length) setChecklist(items.map((i) => ({ ...i, ok: null })));
  }, [settings.data, checklist.length]);
  useEffect(() => {
    if (devices.data?.length) setDeviceId(devices.data[0]!.id);
    else setDeviceId('new');
  }, [devices.data]);
  useEffect(() => {
    if (created) void QRCode.toDataURL(created.trackingUrl, { margin: 1, width: 220 }).then(setQr);
    if (customer) setSigner(customer.name);
  }, [created, customer]);

  const submit = useAction(
    (_: void, key) =>
      api<Created>('/service-orders', {
        method: 'POST',
        idempotencyKey: key,
        body: {
          branchId,
          customerId: customer!.id,
          deviceId: deviceId === 'new' ? undefined : deviceId,
          device: deviceId === 'new' ? { brand: device.brand, model: device.model, color: device.color || null, imei: device.imei || null, serial: device.serial || null } : undefined,
          category: form.category,
          priority: form.priority,
          reportedIssue: form.reportedIssue,
          estimatedDeliveryAt: form.estimatedDeliveryAt ? new Date(`${form.estimatedDeliveryAt}T18:00:00`).toISOString() : null,
          accessories: Object.entries(accessories)
            .filter(([, v]) => v.received)
            .map(([type, v]) => ({ type, description: v.description || undefined, received: true })),
          intakeChecklist: checklist,
          notes: form.notes || null,
          requiresApproval: form.requiresApproval,
          diagnosisFeeCents: fee,
          technicianUserId: form.technicianUserId || null,
          unlockSecret: form.unlockSecret || null,
        },
      }),
    { success: 'OS criada', invalidate: [['service-orders']], onSuccess: setCreated },
  );

  const sign = useAction(
    (_: void) => api(`/service-orders/${created!.order.id}/intake-signature`, { method: 'POST', body: { signerName: signer, signaturePng: signature, accepted: true } }),
    { success: 'Termo de recebimento assinado' },
  );

  if (!branchId) return <Alert tone="red">Nenhuma filial disponível. Cadastre uma filial em Configurações.</Alert>;
  const canSubmit = customer && form.reportedIssue.trim().length > 2 && (deviceId !== 'new' || (device.brand && device.model));

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Nova ordem de serviço" description={`Filial: ${me?.current?.branches.find((b) => b.id === branchId)?.name ?? ''}`} />
      <div className="space-y-4">
        <Card title="1. Cliente">
          <CustomerPicker value={customer} onChange={setCustomer} />
        </Card>
        {customer && (
          <Card title="2. Aparelho">
            <Field label="Aparelho" htmlFor="dev">
              <Select id="dev" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
                {devices.data?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.brand} {d.model} {d.color ?? ''} {d.imeiMasked ? `· IMEI ${d.imeiMasked}` : ''}
                  </option>
                ))}
                <option value="new">+ Novo aparelho</option>
              </Select>
            </Field>
            {deviceId === 'new' && (
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Field label="Marca" htmlFor="brand">
                  <Input id="brand" value={device.brand} onChange={(e) => setDevice({ ...device, brand: e.target.value })} />
                </Field>
                <Field label="Modelo" htmlFor="model">
                  <Input id="model" value={device.model} onChange={(e) => setDevice({ ...device, model: e.target.value })} />
                </Field>
                <Field label="Cor" htmlFor="color">
                  <Input id="color" value={device.color} onChange={(e) => setDevice({ ...device, color: e.target.value })} />
                </Field>
                <Field label="IMEI (opcional)" htmlFor="imei" hint="Armazenado criptografado; exibido mascarado">
                  <Input id="imei" inputMode="numeric" value={device.imei} onChange={(e) => setDevice({ ...device, imei: e.target.value.replace(/\D/g, '') })} maxLength={15} />
                </Field>
                <Field label="Serial (opcional)" htmlFor="serial">
                  <Input id="serial" value={device.serial} onChange={(e) => setDevice({ ...device, serial: e.target.value })} />
                </Field>
              </div>
            )}
          </Card>
        )}
        <Card title="3. Atendimento">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Tipo" htmlFor="cat">
              <Select id="cat" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                <option value="REPAIR">Reparo</option>
                <option value="DIAGNOSIS">Diagnóstico</option>
              </Select>
            </Field>
            <Field label="Prioridade" htmlFor="prio">
              <Select id="prio" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Previsão de entrega" htmlFor="eta">
              <Input id="eta" type="date" value={form.estimatedDeliveryAt} onChange={(e) => setForm({ ...form, estimatedDeliveryAt: e.target.value })} />
            </Field>
            <Field label="Defeito relatado" htmlFor="issue" className="sm:col-span-3">
              <Textarea id="issue" value={form.reportedIssue} onChange={(e) => setForm({ ...form, reportedIssue: e.target.value })} />
            </Field>
            <Field label="Taxa de diagnóstico informada ao cliente" htmlFor="fee" hint="Cobrada somente se o orçamento for recusado ou o aparelho devolvido sem reparo">
              <MoneyInput id="fee" value={fee} onChange={setFee} />
            </Field>
            {can('os:assign') && (
              <Field label="Técnico (opcional)" htmlFor="tech">
                <Select id="tech" value={form.technicianUserId} onChange={(e) => setForm({ ...form, technicianUserId: e.target.value })}>
                  <option value="">Fila (sem atribuição)</option>
                  {techs.data?.map((t) => (
                    <option key={t.membership.user.id} value={t.membership.user.id}>
                      {t.membership.user.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Senha/padrão de desbloqueio (opcional)" htmlFor="unlock" hint="Criptografada, expira automaticamente e nunca aparece em PDF/WhatsApp. Prefira desbloqueio assistido.">
              <Input id="unlock" type="password" autoComplete="off" value={form.unlockSecret} onChange={(e) => setForm({ ...form, unlockSecret: e.target.value })} />
            </Field>
          </div>
          {can('os:approve_override') && (
            <div className="mt-3">
              <Checkbox label="Exige aprovação de orçamento antes do reparo" checked={form.requiresApproval} onChange={(v) => setForm({ ...form, requiresApproval: v })} />
            </div>
          )}
        </Card>
        <Card title="4. Acessórios recebidos">
          <div className="grid gap-2 sm:grid-cols-2">
            {ACCESSORY_TYPES.map((t) => (
              <div key={t} className="flex items-center gap-2">
                <Checkbox label={ACCESSORY_LABELS[t]} checked={accessories[t].received} onChange={(v) => setAccessories({ ...accessories, [t]: { ...accessories[t], received: v } })} />
                {accessories[t].received && (
                  <input
                    aria-label={`Descrição ${ACCESSORY_LABELS[t]}`}
                    className="h-8 flex-1 rounded border border-slate-300 px-2 text-sm"
                    placeholder="Descrição"
                    value={accessories[t].description}
                    onChange={(e) => setAccessories({ ...accessories, [t]: { ...accessories[t], description: e.target.value } })}
                  />
                )}
              </div>
            ))}
          </div>
        </Card>
        <Card title="5. Estado físico e testes iniciais">
          <ChecklistEditor items={checklist} onChange={setChecklist} />
          <Field label="Observações internas" htmlFor="notes" className="mt-3">
            <Textarea id="notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </Card>
        <Button size="lg" className="w-full" disabled={!canSubmit} loading={submit.isPending} onClick={() => submit.mutate()}>
          Abrir ordem de serviço
        </Button>
      </div>

      <Dialog open={Boolean(created)} onOpenChange={(v) => !v && navigate(`/app/service-orders/${created!.order.id}`)} title={`OS nº ${created?.order.number} criada`} wide>
        {created && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 text-center">
              {qr && <img src={qr} alt="QR Code de acompanhamento" className="mx-auto h-48 w-48" />}
              <p className="text-xs text-slate-500">Código do comprovante (exibido uma única vez):</p>
              <p className="break-all rounded bg-slate-100 p-2 font-mono text-xs">{created.trackingToken}</p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => void navigator.clipboard.writeText(created.trackingUrl).then(() => toast.success('Link copiado'))}>
                  Copiar link
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void openPdf(`/service-orders/${created.order.id}/pdf`, { type: 'intake', format: 'A4' }, { 'X-Tracking-Token': created.trackingToken })}>
                  Ficha A4
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void openPdf(`/service-orders/${created.order.id}/pdf`, { type: 'intake', format: 'THERMAL' }, { 'X-Tracking-Token': created.trackingToken })}>
                  Térmica
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Assinatura do termo de recebimento</p>
              <Field label="Nome de quem assina" htmlFor="signer">
                <Input id="signer" value={signer} onChange={(e) => setSigner(e.target.value)} />
              </Field>
              <SignaturePad onChange={setSignature} />
              <p className="text-xs text-slate-500">Assinatura eletrônica simples, com hash do termo e evidências registradas.</p>
              <Button disabled={!signature || signer.length < 3} loading={sign.isPending} onClick={() => sign.mutate()}>
                Registrar assinatura
              </Button>
            </div>
            <div className="sm:col-span-2">
              <Button className="w-full" onClick={() => navigate(`/app/service-orders/${created.order.id}`)}>
                Ir para a OS
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
