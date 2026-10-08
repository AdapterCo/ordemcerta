import { zodResolver } from '@hookform/resolvers/zod';
import { forgotPasswordSchema, loginSchema, passwordSchema } from '@ordemcerta/shared';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { PublicLayout } from '@/components/layout';
import { Alert, Button, Card, Field, Input } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fragmentParam } from '@/lib/utils';

function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null;
}

export function LoginPage() {
  const { login, completeSession, me } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [mfa, setMfa] = useState<{ token: string; setup: boolean } | null>(null);
  const [setupQr, setSetupQr] = useState<{ img: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const form = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema) });

  const go = () => {
    const next = safeNext(params.get('next'));
    navigate(next ?? '/app/dashboard', { replace: true });
  };

  if (me && !mfa) return <Navigate to={me.user.platformRole && !me.current ? '/platform/dashboard' : (safeNext(params.get('next')) ?? '/app/dashboard')} replace />;

  const submit = form.handleSubmit(async (v) => {
    setBusy(true);
    try {
      const r = await login(v.email, v.password);
      if (r.status === 'authenticated') return go();
      setMfa({ token: r.mfaToken, setup: r.status === 'mfa_setup_required' });
      if (r.status === 'mfa_setup_required') {
        const s = await api<{ otpauthUrl: string; secret: string }>('/auth/mfa/setup-required/start', { method: 'POST', body: { mfaToken: r.mfaToken } });
        setSetupQr({ img: await QRCode.toDataURL(s.otpauthUrl), secret: s.secret });
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  });

  const verify = async () => {
    setBusy(true);
    try {
      const path = mfa!.setup ? '/auth/mfa/setup-required/enable' : '/auth/mfa/verify';
      const r = await api<{ accessToken: string }>(path, { method: 'POST', body: { mfaToken: mfa!.token, code } });
      await completeSession(r.accessToken);
      go();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PublicLayout>
      <div className="mx-auto max-w-sm py-8">
        <Card title={mfa ? 'Verificação em duas etapas' : 'Entrar'}>
          {!mfa ? (
            <form onSubmit={submit} className="space-y-4" noValidate>
              <Field label="E-mail" htmlFor="email" error={form.formState.errors.email?.message}>
                <Input id="email" type="email" autoComplete="username" {...form.register('email')} />
              </Field>
              <Field label="Senha" htmlFor="password" error={form.formState.errors.password?.message}>
                <Input id="password" type="password" autoComplete="current-password" {...form.register('password')} />
              </Field>
              <Button type="submit" className="w-full" loading={busy}>
                Entrar
              </Button>
              <div className="flex justify-between text-sm">
                <Link to="/forgot-password" className="text-brand-700 underline">
                  Esqueci a senha
                </Link>
                <Link to="/pricing" className="text-brand-700 underline">
                  Contratar
                </Link>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              {mfa.setup && (
                <Alert tone="blue" title="MFA obrigatória para a administração da plataforma">
                  Escaneie o QR Code no seu aplicativo autenticador e digite o código gerado.
                </Alert>
              )}
              {setupQr && (
                <div className="text-center">
                  <img src={setupQr.img} alt="QR Code do autenticador" className="mx-auto h-44 w-44" />
                  <p className="mt-1 break-all text-xs text-slate-500">Chave: {setupQr.secret}</p>
                </div>
              )}
              <Field label="Código de 6 dígitos" htmlFor="code">
                <Input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              </Field>
              <Button className="w-full" loading={busy} disabled={code.length !== 6} onClick={verify}>
                Verificar
              </Button>
            </div>
          )}
        </Card>
      </div>
    </PublicLayout>
  );
}

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const form = useForm<z.infer<typeof forgotPasswordSchema>>({ resolver: zodResolver(forgotPasswordSchema) });
  const submit = form.handleSubmit(async (v) => {
    try {
      await api('/auth/forgot-password', { method: 'POST', body: v });
      setSent(true);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  });
  return (
    <PublicLayout>
      <div className="mx-auto max-w-sm py-8">
        <Card title="Recuperar senha">
          {sent ? (
            <Alert tone="green">Se o e-mail estiver cadastrado, você receberá um link de redefinição válido por 30 minutos.</Alert>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <Field label="E-mail" htmlFor="email" error={form.formState.errors.email?.message}>
                <Input id="email" type="email" {...form.register('email')} />
              </Field>
              <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
                Enviar link
              </Button>
            </form>
          )}
        </Card>
      </div>
    </PublicLayout>
  );
}

const resetForm = z.object({ password: passwordSchema, confirm: z.string() }).refine((v) => v.password === v.confirm, { message: 'As senhas não conferem', path: ['confirm'] });

export function ResetPasswordPage() {
  const token = fragmentParam('token');
  const navigate = useNavigate();
  const form = useForm<z.infer<typeof resetForm>>({ resolver: zodResolver(resetForm) });
  const submit = form.handleSubmit(async (v) => {
    try {
      await api('/auth/reset-password', { method: 'POST', body: { token, password: v.password } });
      toast.success('Senha alterada. Faça login.');
      navigate('/login');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  });
  return (
    <PublicLayout>
      <div className="mx-auto max-w-sm py-8">
        <Card title="Definir nova senha">
          {!token ? (
            <Alert tone="red">Link inválido. Solicite uma nova redefinição.</Alert>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <Field label="Nova senha" htmlFor="password" error={form.formState.errors.password?.message} hint="Mínimo de 10 caracteres, com letras e números">
                <Input id="password" type="password" autoComplete="new-password" {...form.register('password')} />
              </Field>
              <Field label="Confirmar senha" htmlFor="confirm" error={form.formState.errors.confirm?.message}>
                <Input id="confirm" type="password" autoComplete="new-password" {...form.register('confirm')} />
              </Field>
              <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
                Salvar
              </Button>
            </form>
          )}
        </Card>
      </div>
    </PublicLayout>
  );
}

export function InvitePage() {
  const token = fragmentParam('token');
  const { completeSession } = useAuth();
  const navigate = useNavigate();
  const [info, setInfo] = useState<{ tenantName: string; email: string; roleLabel: string; userExists: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return setError('Convite inválido');
    api<typeof info>('/auth/invitations/preview', { method: 'POST', body: { token } })
      .then(setInfo)
      .catch((e) => setError(errorMessage(e)));
  }, [token]);

  const accept = async () => {
    setBusy(true);
    try {
      const r = await api<{ accessToken: string }>('/auth/invitations/accept', { method: 'POST', body: { token, name, password: info?.userExists ? undefined : password } });
      await completeSession(r.accessToken);
      navigate('/app/dashboard');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PublicLayout>
      <div className="mx-auto max-w-sm py-8">
        <Card title="Convite">
          {error && <Alert tone="red">{error}</Alert>}
          {info && (
            <div className="space-y-4">
              <p className="text-sm">
                Você foi convidado para <strong>{info.tenantName}</strong> como <strong>{info.roleLabel}</strong> ({info.email}).
              </p>
              <Field label="Seu nome" htmlFor="name">
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              {!info.userExists && (
                <Field label="Crie uma senha" htmlFor="pw" hint="Mínimo de 10 caracteres, com letras e números">
                  <Input id="pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </Field>
              )}
              <Button className="w-full" loading={busy} disabled={!name || (!info.userExists && password.length < 10)} onClick={accept}>
                Aceitar convite
              </Button>
            </div>
          )}
        </Card>
      </div>
    </PublicLayout>
  );
}
