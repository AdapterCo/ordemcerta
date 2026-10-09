import { DOCUMENT_TEMPLATE_TYPES, TENANT_ROLES } from '@ordemcerta/shared';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { QueryState, useAction, useApi } from '@/components/data';
import { Alert, Badge, Button, Card, Checkbox, ConfirmDialog, Dialog, Field, Input, PageHeader, Select, Table, Td, Textarea, Th } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { DOCUMENT_TEMPLATE_LABELS, formatDateTimeBR, ROLE_LABELS } from '@/lib/utils';

/* eslint-disable @typescript-eslint/no-explicit-any */

export function CompanySettingsPage() {
  const tenant = useApi<any>(['tenant'], '/tenant');
  const settings = useApi<Record<string, any>>(['settings-all'], '/settings');
  const usage = useApi<any>(['usage'], '/tenant/usage');
  const [form, setForm] = useState<any>(null);
  const [policy, setPolicy] = useState<Record<string, any>>({});
  useEffect(() => {
    if (tenant.data && !form) setForm({ name: tenant.data.name, legalName: tenant.data.legalName ?? '', document: tenant.data.document ?? '', phone: tenant.data.phone ?? '', email: tenant.data.email ?? '', timezone: tenant.data.timezone, primaryColor: tenant.data.primaryColor ?? '#0f766e' });
    if (settings.data) setPolicy(settings.data);
  }, [tenant.data, settings.data, form]);
  const save = useAction((_: void) => api('/tenant', { method: 'PATCH', body: { ...form, legalName: form.legalName || null, document: form.document || null, phone: form.phone || null, email: form.email || null } }), {
    success: 'Empresa atualizada',
    invalidate: [['tenant']],
  });
  const savePolicy = useAction(
    (keys: string[]) => api('/settings', { method: 'PUT', body: { entries: keys.map((key) => ({ key, value: policy[key] })) } }),
    { success: 'Políticas atualizadas', invalidate: [['settings-all']] },
  );
  return (
    <div className="space-y-4">
      <PageHeader title="Empresa" />
      <QueryState loading={tenant.isLoading} error={tenant.error}>
        {form && (
          <Card title="Dados" actions={<Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button>}>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ['name', 'Nome fantasia'],
                ['legalName', 'Razão social'],
                ['document', 'CNPJ/CPF'],
                ['phone', 'Telefone'],
                ['email', 'E-mail'],
                ['timezone', 'Fuso horário'],
              ].map(([k, l]) => (
                <Field key={k} label={l!} htmlFor={`t-${k}`}>
                  <Input id={`t-${k}`} value={form[k!]} onChange={(e) => setForm({ ...form, [k!]: e.target.value })} />
                </Field>
              ))}
              <Field label="Cor" htmlFor="t-color">
                <Input id="t-color" type="color" value={form.primaryColor} onChange={(e) => setForm({ ...form, primaryColor: e.target.value })} />
              </Field>
            </div>
          </Card>
        )}
      </QueryState>
      {usage.data && (
        <Card title={`Uso do plano ${usage.data.limits.planCode}`}>
          <p className="text-sm">
            Filiais ativas: {usage.data.activeBranches}/{usage.data.limits.maxBranches}
          </p>
          <ul className="mt-1 text-sm">
            {usage.data.perBranch.map((b: any) => (
              <li key={b.branchId}>
                {b.branchName}: técnicos {b.technicians}/{usage.data.limits.maxTechniciansPerBranch} · caixas {b.cashRegisters}/{usage.data.limits.maxCashRegistersPerBranch}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {settings.data && (
        <Card title="Políticas operacionais" actions={<Button size="sm" loading={savePolicy.isPending} onClick={() => savePolicy.mutate(['os.default_warranty_days', 'os.sla_hours', 'os.require_payment_for_delivery', 'stock.allow_negative', 'cash.one_session_per_operator', 'sales.max_discount_percent_without_permission', 'portal.require_otp_for_quote', 'quote.default_valid_days'])}>Salvar</Button>}>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ['os.default_warranty_days', 'Garantia padrão (dias)'],
              ['os.sla_hours', 'SLA da OS (horas)'],
              ['sales.max_discount_percent_without_permission', 'Desconto máx. sem permissão (%)'],
              ['quote.default_valid_days', 'Validade do orçamento (dias)'],
            ].map(([k, l]) => (
              <Field key={k} label={l!} htmlFor={k}>
                <Input id={k} type="number" value={policy[k!] ?? ''} onChange={(e) => setPolicy({ ...policy, [k!]: Number(e.target.value) })} />
              </Field>
            ))}
            <Checkbox label="Entrega exige quitação" checked={Boolean(policy['os.require_payment_for_delivery'])} onChange={(v) => setPolicy({ ...policy, 'os.require_payment_for_delivery': v })} />
            <Checkbox label="Permitir estoque negativo" checked={Boolean(policy['stock.allow_negative'])} onChange={(v) => setPolicy({ ...policy, 'stock.allow_negative': v })} />
            <Checkbox label="Um caixa aberto por operador" checked={Boolean(policy['cash.one_session_per_operator'])} onChange={(v) => setPolicy({ ...policy, 'cash.one_session_per_operator': v })} />
            <Checkbox label="OTP por e-mail para aprovar orçamento no portal" checked={Boolean(policy['portal.require_otp_for_quote'])} onChange={(v) => setPolicy({ ...policy, 'portal.require_otp_for_quote': v })} />
          </div>
        </Card>
      )}
    </div>
  );
}

export function BranchesPage() {
  const q = useApi<any[]>(['branches-all'], '/branches', { includeInactive: 'true' });
  const [edit, setEdit] = useState<any | null>(null);
  const save = useAction(
    (_: void) =>
      edit.id
        ? api(`/branches/${edit.id}`, { method: 'PATCH', body: { name: edit.name, phone: edit.phone || null, timezone: edit.timezone, status: edit.status, address: edit.address } })
        : api('/branches', { method: 'POST', body: { name: edit.name, phone: edit.phone || null, timezone: edit.timezone, address: edit.address } }),
    { success: 'Filial salva', invalidate: [['branches-all']], onSuccess: () => setEdit(null) },
  );
  return (
    <div>
      <PageHeader title="Filiais" actions={<Button onClick={() => setEdit({ name: '', phone: '', timezone: 'America/Sao_Paulo', address: {} })}>Nova filial</Button>} />
      <QueryState loading={q.isLoading} error={q.error}>
        <Table>
          <thead>
            <tr>
              <Th>Nome</Th>
              <Th>Telefone</Th>
              <Th>Fuso</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {q.data?.map((b) => (
              <tr key={b.id}>
                <Td>{b.name}</Td>
                <Td>{b.phone ?? '—'}</Td>
                <Td>{b.timezone}</Td>
                <Td>
                  <Badge tone={b.status === 'ACTIVE' ? 'green' : 'gray'}>{b.status === 'ACTIVE' ? 'Ativa' : 'Inativa'}</Badge>
                </Td>
                <Td>
                  <Button size="sm" variant="secondary" onClick={() => setEdit({ ...b, address: b.address ?? {} })}>
                    Editar
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </QueryState>
      <Dialog open={Boolean(edit)} onOpenChange={() => setEdit(null)} title={edit?.id ? 'Editar filial' : 'Nova filial (limite do plano)'} footer={<Button loading={save.isPending} disabled={!edit?.name} onClick={() => save.mutate()}>Salvar</Button>}>
        {edit && (
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Nome" htmlFor="bn">
              <Input id="bn" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </Field>
            <Field label="Telefone" htmlFor="bp">
              <Input id="bp" value={edit.phone ?? ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
            </Field>
            {['street', 'number', 'district', 'city', 'state', 'zip'].map((k) => (
              <Field key={k} label={{ street: 'Rua', number: 'Número', district: 'Bairro', city: 'Cidade', state: 'UF', zip: 'CEP' }[k]!} htmlFor={`ba-${k}`}>
                <Input id={`ba-${k}`} value={edit.address[k] ?? ''} onChange={(e) => setEdit({ ...edit, address: { ...edit.address, [k]: e.target.value } })} />
              </Field>
            ))}
            {edit.id && (
              <Field label="Status" htmlFor="bs">
                <Select id="bs" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
                  <option value="ACTIVE">Ativa</option>
                  <option value="INACTIVE">Inativa</option>
                </Select>
              </Field>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}

export function UsersPage() {
  const { me } = useAuth();
  const q = useApi<any>(['members'], '/members');
  const branches = me?.current?.branches ?? [];
  const [create, setCreate] = useState<any | null>(null);
  const [edit, setEdit] = useState<any | null>(null);
  const [transfer, setTransfer] = useState<any | null>(null);
  const [resetTarget, setResetTarget] = useState<any | null>(null);
  /** Credenciais exibidas uma única vez após cadastro/redefinição. */
  const [credentials, setCredentials] = useState<{ title: string; email: string; password: string } | null>(null);
  const [pw, setPw] = useState('');
  const send = useAction(
    (_: void) => api<{ email: string; temporaryPassword: string | null; existingAccount: boolean }>('/members', { method: 'POST', body: { ...create, password: create.password || undefined } }),
    {
      invalidate: [['members']],
      onSuccess: (r) => {
        setCreate(null);
        if (r.temporaryPassword) setCredentials({ title: 'Usuário criado', email: r.email, password: r.temporaryPassword });
        else toast.success('Este e-mail já tinha conta no OrdemCerta: foi vinculado à empresa e entra com a senha que já usa.');
      },
    },
  );
  const reset = useAction((_: void) => api<{ email: string; temporaryPassword: string }>(`/members/${resetTarget.id}/reset-password`, { method: 'POST', body: {} }), {
    onSuccess: (r) => {
      setResetTarget(null);
      setCredentials({ title: 'Senha redefinida', email: r.email, password: r.temporaryPassword });
    },
  });
  const save = useAction((_: void) => api(`/members/${edit.id}`, { method: 'PATCH', body: { role: edit.role, status: edit.status, branchIds: edit.branchIds, technicianBranchIds: edit.technicianBranchIds } }), {
    success: 'Membro atualizado',
    invalidate: [['members']],
    onSuccess: () => setEdit(null),
  });
  const doTransfer = useAction((_: void) => api('/members/transfer-ownership', { method: 'POST', body: { membershipId: transfer.id, password: pw } }), { success: 'Propriedade transferida', invalidate: [['members']], onSuccess: () => setTransfer(null) });
  const BranchPicker = ({ value, onChange, tech, onTech }: { value: string[]; onChange: (v: string[]) => void; tech: string[]; onTech: (v: string[]) => void }) => (
    <div className="space-y-1">
      {branches.map((b) => (
        <div key={b.id} className="flex flex-wrap gap-4 text-sm">
          <Checkbox label={b.name} checked={value.includes(b.id)} onChange={(v) => onChange(v ? [...value, b.id] : value.filter((x) => x !== b.id))} />
          {value.includes(b.id) && <Checkbox label="habilitação técnica (consome vaga)" checked={tech.includes(b.id)} onChange={(v) => onTech(v ? [...tech, b.id] : tech.filter((x) => x !== b.id))} />}
        </div>
      ))}
    </div>
  );
  return (
    <div className="space-y-4">
      <PageHeader
        title="Usuários"
        description="Cadastre o funcionário com uma senha provisória; no primeiro acesso ele cria a senha dele."
        actions={<Button onClick={() => setCreate({ name: '', email: '', password: '', role: 'RECEPTIONIST', branchIds: branches.length === 1 ? [branches[0]!.id] : [], technicianBranchIds: [] })}>Novo usuário</Button>}
      />
      <QueryState loading={q.isLoading} error={q.error}>
        <Table>
          <thead>
            <tr>
              <Th>Nome</Th>
              <Th>E-mail</Th>
              <Th>Papel</Th>
              <Th>Filiais</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {q.data?.members.map((m: any) => (
              <tr key={m.id}>
                <Td>{m.user.name}</Td>
                <Td>{m.user.email}</Td>
                <Td>{ROLE_LABELS[m.role as keyof typeof ROLE_LABELS]}</Td>
                <Td className="text-xs">
                  {m.branches.map((b: any) => `${branches.find((x) => x.id === b.branchId)?.name ?? '—'}${b.isTechnician ? ' (téc.)' : ''}`).join(', ')}
                </Td>
                <Td>
                  <Badge tone={m.status === 'ACTIVE' ? 'green' : 'gray'}>{m.status === 'ACTIVE' ? 'Ativo' : 'Desativado'}</Badge>
                </Td>
                <Td>
                  {m.role !== 'TENANT_OWNER' && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="secondary" onClick={() => setEdit({ id: m.id, role: m.role, status: m.status, branchIds: m.branches.map((b: any) => b.branchId), technicianBranchIds: m.branches.filter((b: any) => b.isTechnician).map((b: any) => b.branchId) })}>
                        Editar
                      </Button>
                      {m.user.id !== me?.user.id && (m.role !== 'TENANT_ADMIN' || me?.current?.role === 'TENANT_OWNER') && (
                        <Button size="sm" variant="ghost" onClick={() => setResetTarget(m)}>
                          Redefinir senha
                        </Button>
                      )}
                      {me?.current?.role === 'TENANT_OWNER' && m.status === 'ACTIVE' && (
                        <Button size="sm" variant="ghost" onClick={() => setTransfer(m)}>
                          Tornar proprietário
                        </Button>
                      )}
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </QueryState>
      <Dialog
        open={Boolean(create)}
        onOpenChange={() => setCreate(null)}
        title="Novo usuário"
        footer={
          <Button loading={send.isPending} disabled={!create?.name || !create?.email} onClick={() => send.mutate()}>
            Criar usuário
          </Button>
        }
      >
        {create && (
          <div className="space-y-3">
            <Field label="Nome" htmlFor="cn">
              <Input id="cn" value={create.name} onChange={(e) => setCreate({ ...create, name: e.target.value })} />
            </Field>
            <Field label="E-mail (usado no login)" htmlFor="ce">
              <Input id="ce" type="email" autoComplete="off" value={create.email} onChange={(e) => setCreate({ ...create, email: e.target.value })} />
            </Field>
            <Field label="Senha provisória" htmlFor="cp" hint="Deixe em branco para o sistema gerar uma. Mínimo de 10 caracteres, com letras e números.">
              <Input id="cp" autoComplete="new-password" value={create.password} onChange={(e) => setCreate({ ...create, password: e.target.value })} />
            </Field>
            <Field label="Papel" htmlFor="cr">
              <Select id="cr" value={create.role} onChange={(e) => setCreate({ ...create, role: e.target.value })}>
                {TENANT_ROLES.filter((r) => r !== 'TENANT_OWNER').map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
            </Field>
            <BranchPicker value={create.branchIds} onChange={(v) => setCreate({ ...create, branchIds: v })} tech={create.technicianBranchIds} onTech={(v) => setCreate({ ...create, technicianBranchIds: v })} />
            <p className="text-xs text-slate-500">Técnicos ativos são limitados pelo plano (por filial). No primeiro login o usuário é obrigado a trocar a senha.</p>
          </div>
        )}
      </Dialog>
      <ConfirmDialog
        open={Boolean(resetTarget)}
        onOpenChange={() => setResetTarget(null)}
        title={`Redefinir a senha de ${resetTarget?.user.name}`}
        description="Será gerada uma nova senha provisória e as sessões abertas desse usuário serão encerradas. No próximo login ele cria a senha dele."
        loading={reset.isPending}
        onConfirm={() => reset.mutate()}
      />
      <Dialog open={Boolean(credentials)} onOpenChange={() => setCredentials(null)} title={credentials?.title ?? ''} footer={<Button onClick={() => setCredentials(null)}>Pronto, anotei</Button>}>
        {credentials && (
          <div className="space-y-3">
            <Alert tone="yellow">Esta senha aparece só agora. Entregue ao funcionário; no primeiro login ele cria a senha pessoal.</Alert>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <p>
                E-mail: <strong>{credentials.email}</strong>
              </p>
              <p className="mt-1">
                Senha provisória: <strong className="font-mono text-base">{credentials.password}</strong>
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={() =>
                void navigator.clipboard
                  .writeText(`Acesso OrdemCerta\n${window.location.origin}/login\nE-mail: ${credentials.email}\nSenha provisória: ${credentials.password}`)
                  .then(() => toast.success('Copiado'))
                  .catch(() => toast.error('Não foi possível copiar'))
              }
            >
              Copiar acesso
            </Button>
          </div>
        )}
      </Dialog>
      <Dialog open={Boolean(edit)} onOpenChange={() => setEdit(null)} title="Editar membro" footer={<Button loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button>}>
        {edit && (
          <div className="space-y-3">
            <Select aria-label="Papel" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>
              {TENANT_ROLES.filter((r) => r !== 'TENANT_OWNER').map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
            <Select aria-label="Status" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
              <option value="ACTIVE">Ativo</option>
              <option value="DISABLED">Desativado</option>
            </Select>
            <BranchPicker value={edit.branchIds} onChange={(v) => setEdit({ ...edit, branchIds: v })} tech={edit.technicianBranchIds} onTech={(v) => setEdit({ ...edit, technicianBranchIds: v })} />
          </div>
        )}
      </Dialog>
      <ConfirmDialog open={Boolean(transfer)} onOpenChange={() => setTransfer(null)} title={`Transferir propriedade para ${transfer?.user.name}`} description="Você passará a administrador. Confirme com sua senha." danger loading={doTransfer.isPending} onConfirm={() => doTransfer.mutate()}>
        <Input aria-label="Sua senha" type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
      </ConfirmDialog>
    </div>
  );
}

export function DocumentsPage() {
  const q = useApi<any[]>(['doc-templates'], '/document-templates');
  const [edit, setEdit] = useState<{ type: string; content: string } | null>(null);
  const save = useAction((_: void) => api('/document-templates', { method: 'POST', body: edit }), { success: 'Nova versão publicada', invalidate: [['doc-templates']], onSuccess: () => setEdit(null) });
  return (
    <div className="space-y-4">
      <PageHeader title="Documentos e termos" description="Modelos versionados. Revise juridicamente antes do uso comercial." />
      <Alert tone="yellow">Não inclua cláusulas que excluam a garantia legal ou a responsabilidade prevista no Código de Defesa do Consumidor.</Alert>
      <QueryState loading={q.isLoading} error={q.error}>
        <div className="grid gap-3 md:grid-cols-2">
          {q.data?.map((t) => (
            <Card key={t.type} title={`${DOCUMENT_TEMPLATE_LABELS[t.type as keyof typeof DOCUMENT_TEMPLATE_LABELS]} — v${t.active.version}${t.active.isDefault ? ' (padrão)' : ''}`} actions={<Button size="sm" variant="secondary" onClick={() => setEdit({ type: t.type, content: t.active.content })}>Nova versão</Button>}>
              <p className="whitespace-pre-wrap text-sm text-slate-700">{t.active.content}</p>
            </Card>
          ))}
        </div>
      </QueryState>
      <Dialog open={Boolean(edit)} onOpenChange={() => setEdit(null)} title="Nova versão do modelo" wide footer={<Button loading={save.isPending} onClick={() => save.mutate()}>Publicar</Button>}>
        <Textarea aria-label="Conteúdo" className="min-h-60" value={edit?.content ?? ''} onChange={(e) => setEdit({ ...edit!, content: e.target.value })} />
        <p className="mt-1 text-xs text-slate-500">Campos dinâmicos: {'{{taxa_diagnostico}} {{link_consulta}} {{dias_garantia}} {{validade}} {{versao}} {{total}}'} — inseridos como texto (sem HTML).</p>
        <p className="text-xs text-slate-500">Tipos: {DOCUMENT_TEMPLATE_TYPES.join(', ')}</p>
      </Dialog>
    </div>
  );
}

/** Onboarding após ativação: dados da empresa, primeira filial, políticas e próximos passos. */
export function OnboardingPage() {
  const { reload } = useAuth();
  const navigate = useNavigate();
  const branches = useApi<any[]>(['branches-all'], '/branches');
  const [branch, setBranch] = useState({ name: 'Loja principal', phone: '', timezone: 'America/Sao_Paulo' });
  const create = useAction((_: void) => api('/branches', { method: 'POST', body: { ...branch, phone: branch.phone || null } }), { success: 'Filial criada', invalidate: [['branches-all']], onSuccess: () => void reload() });
  const register = useAction(
    (_: void) => api('/cash-registers', { method: 'POST', body: { branchId: branches.data![0].id, name: 'Caixa 1' } }),
    { success: 'Caixa cadastrado' },
  );
  const finish = useAction((_: void) => api('/tenant/onboarding/complete', { method: 'POST' }), {
    success: 'Tudo pronto!',
    onSuccess: async () => {
      await reload();
      navigate('/app/dashboard');
    },
  });
  const hasBranch = (branches.data?.length ?? 0) > 0;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="Bem-vindo à OrdemCerta" description="Configure o básico para começar a operar." />
      <Card title="1. Primeira filial">
        {hasBranch ? (
          <p className="text-sm text-emerald-700">✓ Filial cadastrada: {branches.data![0].name}</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-3">
            <Input aria-label="Nome da filial" value={branch.name} onChange={(e) => setBranch({ ...branch, name: e.target.value })} />
            <Input aria-label="Telefone" placeholder="Telefone" value={branch.phone} onChange={(e) => setBranch({ ...branch, phone: e.target.value })} />
            <Button loading={create.isPending} onClick={() => create.mutate()}>
              Criar filial
            </Button>
          </div>
        )}
      </Card>
      <Card title="2. Caixa">
        <Button variant="secondary" disabled={!hasBranch} loading={register.isPending} onClick={() => register.mutate()}>
          Cadastrar "Caixa 1"
        </Button>
      </Card>
      <Card title="3. Próximos passos (opcionais)">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Dados da empresa, cor e políticas: Configurações → Empresa</li>
          <li>Convidar atendentes e técnicos: Configurações → Usuários</li>
          <li>Termos e garantia: Configurações → Documentos</li>
          <li>Catálogo e estoque inicial: Produtos / Estoque</li>
          <li>WhatsApp oficial com sua conta Meta: WhatsApp</li>
        </ul>
      </Card>
      <Button size="lg" className="w-full" disabled={!hasBranch} loading={finish.isPending} onClick={() => finish.mutate()}>
        Concluir e começar
      </Button>
    </div>
  );
}
