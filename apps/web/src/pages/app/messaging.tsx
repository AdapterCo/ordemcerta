import { MESSAGE_TEMPLATE_VARIABLES, MESSAGING_EVENT_TYPES } from '@ordemcerta/shared';
import { useEffect, useState } from 'react';
import { Pagination, QueryState, useAction, useApi } from '@/components/data';
import { Alert, Badge, Button, Card, Checkbox, Dialog, Field, Input, PageHeader, Select, Table, Td, Textarea, Th } from '@/components/ui';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTimeBR, MESSAGING_EVENT_LABELS, MESSAGING_STATUS_LABELS } from '@/lib/utils';

/* eslint-disable @typescript-eslint/no-explicit-any */

function ChannelCard({ channel }: { channel: any }) {
  const { can } = useAuth();
  const status = useApi<any>(['channel-status', channel.id], `/messaging/channels/${channel.id}/status`);
  const [onboarding, setOnboarding] = useState<any | null>(null);
  const [form, setForm] = useState({ wabaId: '', phoneNumberId: '', accessToken: '' });
  const [billing, setBilling] = useState(false);
  const [evidence, setEvidence] = useState({ evidenceNote: '', own: false, noCredit: false });
  const inv = [['messaging-channels'], ['channel-status', channel.id]];
  const start = useAction((_: void) => api(`/messaging/channels/${channel.id}/onboarding/start`, { method: 'POST' }), { invalidate: inv, onSuccess: setOnboarding });
  const complete = useAction((_: void) => api(`/messaging/channels/${channel.id}/onboarding/complete`, { method: 'POST', body: form }), { success: 'Conta oficial conectada', invalidate: inv, onSuccess: () => setOnboarding(null) });
  const disconnect = useAction((_: void) => api(`/messaging/channels/${channel.id}/disconnect`, { method: 'POST' }), { success: 'Desconectado', invalidate: inv });
  const reconnect = useAction((_: void) => api(`/messaging/channels/${channel.id}/connect`, { method: 'POST' }), { success: 'Credenciais revalidadas', invalidate: inv });
  const sync = useAction((_: void) => api(`/messaging/channels/${channel.id}/templates/sync`, { method: 'POST' }), { success: 'Templates sincronizados', invalidate: [['templates']] });
  const submitBilling = useAction(
    (_: void) =>
      api(`/messaging/channels/${channel.id}/billing-verification`, {
        method: 'POST',
        body: { method: 'ASSISTED', evidenceNote: evidence.evidenceNote, confirmOwnBilling: evidence.own, confirmNoCreditLineSharing: evidence.noCredit },
      }),
    { success: 'Evidência enviada para validação', invalidate: inv, onSuccess: () => setBilling(false) },
  );
  const s = status.data;
  return (
    <Card
      title={
        <span>
          {channel.name} <Badge tone={channel.status === 'ACTIVE' ? 'green' : channel.status === 'ERROR' ? 'red' : 'yellow'}>{MESSAGING_STATUS_LABELS[channel.status as keyof typeof MESSAGING_STATUS_LABELS]}</Badge>{' '}
          {channel.provider !== 'WHATSAPP_CLOUD' && <Badge tone="red">Não oficial</Badge>}
        </span>
      }
    >
      <dl className="grid grid-cols-2 gap-1 text-sm">
        <dt className="text-slate-500">Número</dt>
        <dd>{channel.displayPhoneMasked ?? '—'}</dd>
        <dt className="text-slate-500">WABA</dt>
        <dd>{channel.externalWabaId ? `••••${channel.externalWabaId.slice(-4)}` : '—'}</dd>
        <dt className="text-slate-500">Faturamento próprio</dt>
        <dd>{{ UNKNOWN: 'Não verificado', PENDING_REVIEW: 'Em revisão', VERIFIED_OWN_BILLING: 'Verificado', REJECTED: 'Rejeitado' }[channel.billingStatus as string]}</dd>
        <dt className="text-slate-500">Último webhook</dt>
        <dd>{channel.webhookLastReceivedAt ? formatDateTimeBR(channel.webhookLastReceivedAt) : '—'}</dd>
      </dl>
      {channel.lastError && <p className="mt-2 text-sm text-red-600">{channel.lastError}</p>}
      {s && (
        <ul className="mt-3 space-y-1 text-sm">
          {[
            ['Credenciais oficiais armazenadas (criptografadas)', s.readiness.credentialsStored],
            ['Faturamento próprio da WABA validado', s.readiness.ownBillingVerified],
            ['Template aprovado', s.readiness.approvedTemplates > 0],
            ['Webhook recebido', s.readiness.webhookReceived],
            ['Mensagem real entregue', s.readiness.realMessageDelivered],
          ].map(([label, ok]) => (
            <li key={label as string}>
              {ok ? '✅' : '⬜'} {label}
            </li>
          ))}
          <li className="font-semibold">{s.readiness.ready ? 'Integração pronta' : 'Integração ainda não pronta para produção'}</li>
        </ul>
      )}
      <p className="mt-2 text-xs text-slate-500">{s?.notice}</p>
      {can('messaging:manage') && (
        <div className="mt-3 flex flex-wrap gap-2">
          {['NOT_CONNECTED', 'ONBOARDING', 'DISCONNECTED', 'ERROR'].includes(channel.status) && (
            <Button size="sm" loading={start.isPending} onClick={() => start.mutate()}>
              Conectar conta oficial
            </Button>
          )}
          {channel.hasCredentials && channel.billingStatus !== 'VERIFIED_OWN_BILLING' && (
            <Button size="sm" variant="secondary" onClick={() => setBilling(true)}>
              Enviar evidência de faturamento
            </Button>
          )}
          {channel.hasCredentials && (
            <>
              <Button size="sm" variant="secondary" loading={reconnect.isPending} onClick={() => reconnect.mutate()}>
                Revalidar
              </Button>
              <Button size="sm" variant="secondary" loading={sync.isPending} onClick={() => sync.mutate()}>
                Sincronizar templates
              </Button>
              <Button size="sm" variant="danger" loading={disconnect.isPending} onClick={() => disconnect.mutate()}>
                Desconectar
              </Button>
            </>
          )}
        </div>
      )}
      <Dialog open={Boolean(onboarding)} onOpenChange={() => setOnboarding(null)} title="Conexão oficial (BYOK)" wide footer={<Button loading={complete.isPending} disabled={!form.wabaId || !form.phoneNumberId || !form.accessToken} onClick={() => complete.mutate()}>Conectar</Button>}>
        {onboarding?.mode === 'embedded_signup' ? (
          <Alert tone="blue">Embedded Signup habilitado (config {onboarding.configId}). Conclua o fluxo da Meta e informe os IDs retornados abaixo.</Alert>
        ) : (
          <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm">
            {onboarding?.instructions?.map((i: string) => (
              <li key={i}>{i}</li>
            ))}
          </ol>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="ID da WABA" htmlFor="waba">
            <Input id="waba" value={form.wabaId} onChange={(e) => setForm({ ...form, wabaId: e.target.value.trim() })} />
          </Field>
          <Field label="ID do número (phone_number_id)" htmlFor="pnid">
            <Input id="pnid" value={form.phoneNumberId} onChange={(e) => setForm({ ...form, phoneNumberId: e.target.value.trim() })} />
          </Field>
          <Field label="Token de acesso do cliente" htmlFor="tok" className="sm:col-span-2" hint="Nunca será exibido novamente.">
            <Input id="tok" type="password" autoComplete="off" value={form.accessToken} onChange={(e) => setForm({ ...form, accessToken: e.target.value.trim() })} />
          </Field>
        </div>
      </Dialog>
      <Dialog open={billing} onOpenChange={setBilling} title="Faturamento próprio da WABA" footer={<Button loading={submitBilling.isPending} disabled={!evidence.own || !evidence.noCredit || evidence.evidenceNote.length < 10} onClick={() => submitBilling.mutate()}>Enviar</Button>}>
        <div className="space-y-3 text-sm">
          <p>O consumo das mensagens é cobrado pela Meta diretamente na sua conta. A OrdemCerta não compartilha linha de crédito nem cobra tarifas da Meta.</p>
          <Textarea aria-label="Evidência" placeholder="Descreva a forma de pagamento configurada na WABA (ex.: cartão em nome da empresa, ID da conta de pagamento) e anexe prints ao suporte, se solicitado." value={evidence.evidenceNote} onChange={(e) => setEvidence({ ...evidence, evidenceNote: e.target.value })} />
          <Checkbox label="Confirmo que a WABA possui faturamento próprio configurado na Meta" checked={evidence.own} onChange={(v) => setEvidence({ ...evidence, own: v })} />
          <Checkbox label="Confirmo que não há compartilhamento de linha de crédito com a plataforma ou BSP" checked={evidence.noCredit} onChange={(v) => setEvidence({ ...evidence, noCredit: v })} />
        </div>
      </Dialog>
    </Card>
  );
}

function TemplatesCard() {
  const { can } = useAuth();
  const q = useApi<any[]>(['templates'], '/messaging/templates');
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    if (q.data) {
      setRows(
        MESSAGING_EVENT_TYPES.map((ev) => {
          const t = q.data!.find((x) => x.eventType === ev);
          return t
            ? { eventType: ev, name: t.name, language: t.language, body: t.body, variables: t.variablesJson, enabled: t.enabled, approvalStatus: t.approvalStatus }
            : { eventType: ev, name: '', language: 'pt_BR', body: '', variables: ['cliente_nome', 'os_numero'], enabled: false, approvalStatus: 'DRAFT' };
        }),
      );
    }
  }, [q.data]);
  const save = useAction((_: void) => api('/messaging/templates', { method: 'PUT', body: { templates: rows.filter((r) => r.name && r.body) } }), { success: 'Templates salvos', invalidate: [['templates']] });
  return (
    <Card title="Templates (devem existir e estar aprovados na sua WABA)" actions={can('messaging:manage') && <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button>}>
      <p className="mb-2 text-xs text-slate-500">Variáveis permitidas (na ordem dos parâmetros do template): {MESSAGE_TEMPLATE_VARIABLES.join(', ')}. IMEI, senhas e laudos nunca são enviados.</p>
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={r.eventType} className="grid gap-2 rounded border border-slate-200 p-2 sm:grid-cols-6">
            <div className="text-sm font-medium sm:col-span-6">
              {MESSAGING_EVENT_LABELS[r.eventType as keyof typeof MESSAGING_EVENT_LABELS]} <Badge tone={r.approvalStatus === 'APPROVED' ? 'green' : 'gray'}>{r.approvalStatus}</Badge>
            </div>
            <Input aria-label="Nome do template na Meta" placeholder="nome_template_meta" value={r.name} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="sm:col-span-2" />
            <Input aria-label="Idioma" value={r.language} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, language: e.target.value } : x)))} />
            <Input aria-label="Variáveis" value={r.variables.join(',')} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, variables: e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean) } : x)))} className="sm:col-span-2" />
            <Checkbox label="Ativo" checked={r.enabled} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, enabled: v } : x)))} />
            <Textarea aria-label="Prévia do texto" placeholder="Prévia: Olá {{cliente_nome}}, sua OS {{os_numero}} ..." value={r.body} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)))} className="sm:col-span-6" />
          </div>
        ))}
      </div>
    </Card>
  );
}

export function MessagingPage() {
  const { can, branchId } = useAuth();
  const channels = useApi<any[]>(['messaging-channels'], '/messaging/channels');
  const [page, setPage] = useState(1);
  const deliveries = useApi<Paginated<any>>(['deliveries', page], '/messaging/deliveries', { page });
  const [name, setName] = useState('WhatsApp da loja');
  const [scope, setScope] = useState<'branch' | 'tenant'>('tenant');
  const [test, setTest] = useState({ channelId: '', to: '', eventType: 'OS_RECEIVED' });
  const create = useAction((_: void) => api('/messaging/channels', { method: 'POST', body: { name, provider: 'WHATSAPP_CLOUD', branchId: scope === 'branch' ? branchId : null } }), { success: 'Canal criado', invalidate: [['messaging-channels']] });
  const sendTest = useAction((_: void) => api('/messaging/test', { method: 'POST', body: test }), { success: 'Teste enfileirado', invalidate: [['deliveries']] });
  const statusLabel: Record<string, string> = { QUEUED: 'Na fila', SENT: 'Enviada', DELIVERED: 'Entregue', READ: 'Lida', FAILED: 'Falhou', SKIPPED: 'Não enviada', BLOCKED: 'Bloqueada' };
  return (
    <div className="space-y-4">
      <PageHeader title="WhatsApp (API oficial, conta própria)" description="Notificações de início e fim de serviço, orçamento e retirada. Sua conta Meta, seu número, seu faturamento." />
      <QueryState loading={channels.isLoading} error={channels.error}>
        <div className="grid gap-4 lg:grid-cols-2">
          {channels.data?.map((c) => (
            <ChannelCard key={c.id} channel={c} />
          ))}
        </div>
      </QueryState>
      {can('messaging:manage') && (
        <Card title="Novo canal">
          <div className="flex flex-wrap gap-2">
            <Input aria-label="Nome" value={name} onChange={(e) => setName(e.target.value)} className="max-w-xs" />
            <Select aria-label="Escopo" value={scope} onChange={(e) => setScope(e.target.value as 'branch' | 'tenant')} className="w-auto">
              <option value="tenant">Toda a empresa</option>
              <option value="branch">Somente a filial atual</option>
            </Select>
            <Button loading={create.isPending} onClick={() => create.mutate()}>
              Criar canal oficial
            </Button>
          </div>
        </Card>
      )}
      <TemplatesCard />
      {can('messaging:manage') && (
        <Card title="Mensagem de teste (real)">
          <div className="flex flex-wrap gap-2">
            <Select aria-label="Canal" value={test.channelId} onChange={(e) => setTest({ ...test, channelId: e.target.value })} className="w-auto">
              <option value="">Canal</option>
              {channels.data?.filter((c) => c.status === 'ACTIVE').map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Input aria-label="Telefone" placeholder="Telefone de cliente cadastrado" value={test.to} onChange={(e) => setTest({ ...test, to: e.target.value })} className="max-w-xs" />
            <Select aria-label="Evento" value={test.eventType} onChange={(e) => setTest({ ...test, eventType: e.target.value })} className="w-auto">
              {MESSAGING_EVENT_TYPES.map((e) => (
                <option key={e} value={e}>
                  {MESSAGING_EVENT_LABELS[e]}
                </option>
              ))}
            </Select>
            <Button disabled={!test.channelId || !test.to} loading={sendTest.isPending} onClick={() => sendTest.mutate()}>
              Enviar teste
            </Button>
          </div>
        </Card>
      )}
      <Card title="Envios">
        <Table>
          <thead>
            <tr>
              <Th>Data</Th>
              <Th>Evento</Th>
              <Th>Destinatário</Th>
              <Th>Status</Th>
              <Th>Detalhe</Th>
            </tr>
          </thead>
          <tbody>
            {deliveries.data?.items.map((d) => (
              <tr key={d.id}>
                <Td>{formatDateTimeBR(d.createdAt)}</Td>
                <Td>{MESSAGING_EVENT_LABELS[d.eventType as keyof typeof MESSAGING_EVENT_LABELS] ?? d.eventType}</Td>
                <Td>{d.recipientMasked}</Td>
                <Td>
                  <Badge tone={['DELIVERED', 'READ', 'SENT'].includes(d.status) ? 'green' : d.status === 'FAILED' ? 'red' : 'gray'}>{statusLabel[d.status]}</Badge>
                </Td>
                <Td className="max-w-xs truncate text-xs text-slate-500">{d.lastError ?? ''}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {deliveries.data && <Pagination page={deliveries.data.page} pageSize={deliveries.data.pageSize} total={deliveries.data.total} onPage={setPage} />}
      </Card>
    </div>
  );
}
