import { zodResolver } from '@hookform/resolvers/zod';
import { forgotPasswordSchema, loginSchema, passwordSchema } from '@ordemcerta/shared';
import QRCode from 'qrcode';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { AuthLayout } from '@/components/layout';
import { Alert, Button, Field, Input } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth, type LoginStep } from '@/lib/auth';
import { fragmentParam } from '@/lib/utils';

function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null;
}

const newPasswordForm = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: 'As senhas não conferem', path: ['confirm'] });

export function LoginPage() {
  const { login, completeSession, me } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [mfa, setMfa] = useState<{ token: string; setup: boolean } | null>(null);
  const [setupQr, setSetupQr] = useState<{ img: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [pwToken, setPwToken] = useState<string | null>(null);
  const pwForm = useForm<z.infer<typeof newPasswordForm>>({ resolver: zodResolver(newPasswordForm) });
  const [busy, setBusy] = useState(false);
  const form = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema) });

  const go = () => {
    const next = safeNext(params.get('next'));
    navigate(next ?? '/app/dashboard', { replace: true });
  };

  if (me && !mfa && !pwToken) return <Navigate to={me.user.platformRole && !me.current ? '/platform/dashboard' : (safeNext(params.get('next')) ?? '/app/dashboard')} replace />;

  const submit = form.handleSubmit(async (v) => {
    setBusy(true);
    try {
      const r = await login(v.email, v.password);
      if (r.status === 'authenticated') return go();
      await nextStep(r.status, r.mfaToken);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  });

  /** Etapas após a senha: troca obrigatória da senha provisória ou MFA. */
  const nextStep = async (status: LoginStep, token: string) => {
    if (status === 'password_change_required') return setPwToken(token);
    setPwToken(null);
    setMfa({ token, setup: status === 'mfa_setup_required' });
    if (status === 'mfa_setup_required') {
      const s = await api<{ otpauthUrl: string; secret: string }>('/auth/mfa/setup-required/start', { method: 'POST', body: { mfaToken: token } });
      setSetupQr({ img: await QRCode.toDataURL(s.otpauthUrl), secret: s.secret });
    }
  };

  const changeProvisional = pwForm.handleSubmit(async (v) => {
    setBusy(true);
    try {
      const r = await api<{ status: string; accessToken?: string; mfaToken?: string }>('/auth/first-password', {
        method: 'POST',
        body: { mfaToken: pwToken, newPassword: v.password },
      });
      if (r.status === 'authenticated' && r.accessToken) {
        await completeSession(r.accessToken);
        toast.success('Senha definida. Bem-vindo!');
        return go();
      }
      await nextStep(r.status as LoginStep, r.mfaToken!);
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
    <AuthLayout
      title={pwToken ? 'Defina sua senha' : mfa ? 'Verificação em duas etapas' : 'Bem-vindo de volta'}
      subtitle={pwToken ? 'Primeiro acesso: crie a sua senha pessoal.' : mfa ? 'Digite o código do seu aplicativo autenticador.' : 'Entre com seu e-mail e senha para acessar a sua assistência.'}
    >
      <div>
          {pwToken ? (
            <form onSubmit={changeProvisional} className="space-y-4" noValidate>
              <Alert tone="blue" title="Primeiro acesso">
                Você entrou com uma senha provisória. Crie agora a sua senha pessoal para continuar.
              </Alert>
              <Field label="Nova senha" htmlFor="newpw" error={pwForm.formState.errors.password?.message} hint="Mínimo de 10 caracteres, com letras e números">
                <Input id="newpw" type="password" autoComplete="new-password" autoFocus {...pwForm.register('password')} />
              </Field>
              <Field label="Confirmar senha" htmlFor="newpw2" error={pwForm.formState.errors.confirm?.message}>
                <Input id="newpw2" type="password" autoComplete="new-password" {...pwForm.register('confirm')} />
              </Field>
              <Button type="submit" className="w-full" loading={busy}>
                Salvar e entrar
              </Button>
            </form>
          ) : !mfa ? (
            <form onSubmit={submit} className="space-y-4" noValidate>
              <Field label="E-mail" htmlFor="email" error={form.formState.errors.email?.message}>
                <Input id="email" type="email" autoComplete="username" {...form.register('email')} />
              </Field>
              <Field label="Senha" htmlFor="password" error={form.formState.errors.password?.message}>
                <Input id="password" type="password" autoComplete="current-password" {...form.register('password')} />
              </Field>
              <Button type="submit" size="lg" className="w-full" loading={busy}>
                Entrar
              </Button>
              <div className="flex justify-between text-sm">
                <Link to="/forgot-password" className="font-medium text-brand-700 hover:text-brand-800 hover:underline">
                  Esqueci a senha
                </Link>
                <Link to="/pricing" className="font-medium text-ink-700 hover:text-ink-900 hover:underline">
                  Conhecer os planos →
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
      </div>
    </AuthLayout>
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
    <AuthLayout title="Recuperar senha" subtitle="Enviaremos um link para você criar uma nova senha.">
      <div>
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
      </div>
    </AuthLayout>
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
    <AuthLayout title="Definir nova senha" subtitle="Escolha uma senha com letras e números.">
      <div>
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
      </div>
    </AuthLayout>
  );
}
