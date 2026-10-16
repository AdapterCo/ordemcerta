import { zodResolver } from '@hookform/resolvers/zod';
import { passwordSchema } from '@ordemcerta/shared';
import { MailCheck, MonitorSmartphone, ShieldCheck } from 'lucide-react';
import QRCode from 'qrcode';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { QueryState, useAction, useApi } from '@/components/data';
import { Alert, Badge, Button, Card, ConfirmDialog, Field, Input, PageHeader } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const passwordForm = z
  .object({ currentPassword: z.string().min(1, 'Informe a senha atual'), newPassword: passwordSchema, confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, { message: 'As senhas não conferem', path: ['confirm'] });

interface SessionRow {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  mfaVerified: boolean;
}

/** Descrição curta do navegador/aparelho a partir do user-agent. */
function deviceLabel(ua: string | null) {
  if (!ua) return 'Navegador desconhecido';
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone/iPad' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : 'Outro sistema';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  return `${br} · ${os}`;
}

const dt = (s: string | null) => (s ? new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

export function ProfilePage() {
  const { me, reload } = useAuth();
  const user = me!.user;

  return (
    <div className="stagger space-y-6">
      <PageHeader eyebrow="Conta" title="Meu perfil" description="Seus dados de acesso, senha, verificação em duas etapas e aparelhos conectados." />
      <div className="grid gap-6 lg:grid-cols-2">
        <EmailCard email={user.email} name={user.name} verified={user.emailVerified} />
        <PasswordCard />
        <MfaCard enabled={user.mfaEnabled} platform={Boolean(user.platformRole)} onChange={reload} />
        <SessionsCard />
      </div>
    </div>
  );
}

function EmailCard({ email, name, verified }: { email: string; name: string; verified: boolean }) {
  const [sent, setSent] = useState<{ mailConfigured: boolean } | null>(null);
  const send = useAction(() => api<{ alreadyVerified: boolean; mailConfigured: boolean }>('/auth/email/verify-request', { method: 'POST' }), {
    onSuccess: (r) => setSent({ mailConfigured: r.mailConfigured }),
  });
  return (
    <Card title={<span className="flex items-center gap-2"><MailCheck className="h-4 w-4 text-brand-600" /> Dados de acesso</span>}>
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-xs font-semibold text-ink-600/70">Nome</dt>
          <dd className="font-medium">{name}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-ink-600/70">E-mail</dt>
          <dd className="flex flex-wrap items-center gap-2 font-medium break-all">
            {email} {verified ? <Badge tone="green">Confirmado</Badge> : <Badge tone="yellow">Não confirmado</Badge>}
          </dd>
        </div>
      </dl>
      {!verified && (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-ink-700">
            Confirmar o e-mail prova que a caixa postal é sua. Ele é exigido para você ser vinculado a outra empresa no OrdemCerta.
          </p>
          {sent ? (
            sent.mailConfigured ? (
              <Alert tone="green">Enviamos o link de confirmação para {email}. Ele vale por 24 horas.</Alert>
            ) : (
              <Alert tone="yellow" title="Envio de e-mail não configurado">O link foi gerado, mas o servidor ainda não tem SMTP configurado para enviá-lo.</Alert>
            )
          ) : (
            <Button variant="secondary" loading={send.isPending} onClick={() => send.mutate(undefined)}>
              Enviar link de confirmação
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

function PasswordCard() {
  const form = useForm<z.infer<typeof passwordForm>>({ resolver: zodResolver(passwordForm) });
  const submit = form.handleSubmit(async (v) => {
    try {
      await api('/auth/change-password', { method: 'POST', body: { currentPassword: v.currentPassword, newPassword: v.newPassword } });
      toast.success('Senha alterada. Os outros aparelhos foram desconectados.');
      form.reset();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  });
  return (
    <Card title="Alterar senha">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Senha atual" htmlFor="pw-current" error={form.formState.errors.currentPassword?.message}>
          <Input id="pw-current" type="password" autoComplete="current-password" {...form.register('currentPassword')} />
        </Field>
        <Field label="Nova senha" htmlFor="pw-new" error={form.formState.errors.newPassword?.message} hint="Mínimo de 10 caracteres, com letras e números">
          <Input id="pw-new" type="password" autoComplete="new-password" {...form.register('newPassword')} />
        </Field>
        <Field label="Confirmar nova senha" htmlFor="pw-confirm" error={form.formState.errors.confirm?.message}>
          <Input id="pw-confirm" type="password" autoComplete="new-password" {...form.register('confirm')} />
        </Field>
        <Button type="submit" loading={form.formState.isSubmitting}>
          Salvar nova senha
        </Button>
      </form>
    </Card>
  );
}

function MfaCard({ enabled, platform, onChange }: { enabled: boolean; platform: boolean; onChange: () => Promise<void> }) {
  const [setup, setSetup] = useState<{ img: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [disabling, setDisabling] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    run(async () => {
      const s = await api<{ otpauthUrl: string; secret: string }>('/auth/mfa/setup', { method: 'POST' });
      setSetup({ img: await QRCode.toDataURL(s.otpauthUrl), secret: s.secret });
      setCode('');
    });
  const enable = () =>
    run(async () => {
      await api('/auth/mfa/enable', { method: 'POST', body: { code } });
      toast.success('Verificação em duas etapas ativada');
      setSetup(null);
      setCode('');
      await onChange();
    });
  const disable = () =>
    run(async () => {
      await api('/auth/mfa/disable', { method: 'POST', body: { code } });
      toast.success('Verificação em duas etapas desativada');
      setDisabling(false);
      setCode('');
      await onChange();
    });

  const codeInput = (
    <Field label="Código de 6 dígitos do aplicativo" htmlFor="mfa-code">
      <Input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
    </Field>
  );

  return (
    <Card title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-brand-600" /> Verificação em duas etapas</span>}>
      <p className="mb-4 text-sm text-ink-700">
        Além da senha, o login pede um código do aplicativo autenticador (Google Authenticator, Microsoft Authenticator, Authy…).
      </p>
      {enabled ? (
        <div className="space-y-3">
          <Badge tone="green">Ativada</Badge>
          {!platform && (
            <div>
              <Button variant="secondary" onClick={() => setDisabling(true)}>
                Desativar
              </Button>
            </div>
          )}
          <ConfirmDialog
            open={disabling}
            onOpenChange={(o) => {
              setDisabling(o);
              setCode('');
            }}
            title="Desativar verificação em duas etapas"
            description="Sua conta ficará protegida somente pela senha."
            confirmLabel="Desativar"
            danger
            loading={busy}
            onConfirm={disable}
          >
            {codeInput}
          </ConfirmDialog>
        </div>
      ) : setup ? (
        <div className="space-y-4">
          <div className="text-center">
            <img src={setup.img} alt="QR Code para o aplicativo autenticador" className="mx-auto h-44 w-44" />
            <p className="mt-1 break-all font-mono text-xs text-ink-600">Chave: {setup.secret}</p>
          </div>
          {codeInput}
          <div className="flex gap-2">
            <Button loading={busy} disabled={code.length !== 6} onClick={enable}>
              Ativar
            </Button>
            <Button variant="ghost" onClick={() => setSetup(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <Button loading={busy} onClick={start}>
          Configurar
        </Button>
      )}
    </Card>
  );
}

function SessionsCard() {
  const q = useApi<SessionRow[]>(['my-sessions'], '/auth/sessions');
  const revoke = useAction((id: string) => api(`/auth/sessions/${id}`, { method: 'DELETE' }), { success: 'Aparelho desconectado', invalidate: [['my-sessions']] });
  return (
    <Card title={<span className="flex items-center gap-2"><MonitorSmartphone className="h-4 w-4 text-brand-600" /> Aparelhos conectados</span>}>
      <QueryState loading={q.isLoading} error={q.error} empty={!q.data?.length} emptyTitle="Nenhuma sessão ativa" retry={() => void q.refetch()}>
        <ul className="divide-y divide-line">
          {q.data?.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{deviceLabel(s.userAgent)}</p>
                <p className="text-xs text-ink-600/80">
                  Entrou em {dt(s.createdAt)} · último uso {dt(s.lastUsedAt ?? s.createdAt)}
                </p>
              </div>
              <Button size="sm" variant="ghost" loading={revoke.isPending && revoke.variables === s.id} onClick={() => revoke.mutate(s.id)}>
                Desconectar
              </Button>
            </li>
          ))}
        </ul>
      </QueryState>
    </Card>
  );
}
