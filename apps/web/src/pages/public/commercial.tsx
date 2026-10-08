import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { signupSchema } from '@ordemcerta/shared';
import { Check } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import type { z } from 'zod';
import { PublicLayout } from '@/components/layout';
import { Alert, Button, Card, Checkbox, Field, Input, Select, Spinner } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatBRL } from '@/lib/utils';

interface PlanDto {
  code: string;
  name: string;
  priceCents: number;
  maxBranches: number;
  maxTechniciansPerBranch: number;
  maxCashRegistersPerBranch: number;
}

function usePlans() {
  return useQuery({ queryKey: ['public-plans'], queryFn: () => api<PlanDto[]>('/billing/plans') });
}

export function PricingPage() {
  const { data, isLoading, error } = usePlans();
  return (
    <PublicLayout>
      <h1 className="mb-1 text-2xl font-bold">Planos OrdemCerta</h1>
      <p className="mb-6 text-sm text-slate-600">Todos os módulos incluídos em todos os planos. Cobrança mensal, uma assinatura por empresa cobrindo todas as filiais.</p>
      {isLoading && <Spinner />}
      {error && <Alert tone="red">{errorMessage(error)}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        {data?.map((p) => (
          <Card key={p.code} title={p.name}>
            <p className="text-3xl font-bold">
              {formatBRL(p.priceCents)}
              <span className="text-sm font-normal text-slate-500">/mês</span>
            </p>
            <ul className="my-4 space-y-1 text-sm">
              {[
                `Até ${p.maxBranches} filia${p.maxBranches > 1 ? 'is' : 'l'} ativa${p.maxBranches > 1 ? 's' : ''}`,
                `${p.maxTechniciansPerBranch} técnicos ativos por filial (até ${p.maxTechniciansPerBranch * p.maxBranches} no total)`,
                `${p.maxCashRegistersPerBranch} caixa por filial (até ${p.maxCashRegistersPerBranch * p.maxBranches} no total)`,
                'OS, orçamentos, estoque, PDV, caixa, garantias e relatórios',
                'WhatsApp oficial com sua própria conta Meta (tarifas cobradas pela Meta)',
              ].map((t) => (
                <li key={t} className="flex gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
            <Link to={`/cadastro?plano=${p.code}`}>
              <Button className="w-full">Contratar {p.name}</Button>
            </Link>
          </Card>
        ))}
      </div>
    </PublicLayout>
  );
}

export function SignupPage() {
  const [params] = useSearchParams();
  const { completeSession } = useAuth();
  const navigate = useNavigate();
  const plans = usePlans();
  const form = useForm<z.input<typeof signupSchema>>({
    resolver: zodResolver(signupSchema),
    defaultValues: { planCode: (params.get('plano') as 'ESSENCIAL') ?? 'ESSENCIAL', paymentMode: 'PIX_MANUAL' },
  });
  const e = form.formState.errors;
  const selected = plans.data?.find((p) => p.code === form.watch('planCode'));

  const submit = form.handleSubmit(async (v) => {
    try {
      const r = await api<{ accessToken: string; paymentMode: string; resumed: boolean }>('/billing/signup', { method: 'POST', body: v });
      await completeSession(r.accessToken);
      if (r.resumed) toast.info('Retomamos o seu cadastro pendente.');
      navigate('/app/billing');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  });

  return (
    <PublicLayout>
      <h1 className="mb-4 text-2xl font-bold">Cadastro</h1>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Card title="Plano">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Plano" htmlFor="plan" error={e.planCode?.message}>
              <Select id="plan" {...form.register('planCode')}>
                {plans.data?.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name} — {formatBRL(p.priceCents)}/mês
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Forma de pagamento" htmlFor="mode">
              <Select id="mode" {...form.register('paymentMode')}>
                <option value="PIX_MANUAL">Pix manual (pagamento mensal, sem renovação automática)</option>
                <option value="CARD_RECURRING">Cartão de crédito recorrente</option>
              </Select>
            </Field>
          </div>
          {selected && <p className="mt-2 text-sm text-slate-600">Valor confirmado pelo servidor: {formatBRL(selected.priceCents)} por mês.</p>}
        </Card>
        <Card title="Empresa e responsável">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome da empresa" htmlFor="company" error={e.companyName?.message}>
              <Input id="company" {...form.register('companyName')} />
            </Field>
            <Field label="CNPJ ou CPF" htmlFor="doc" error={e.companyDocument?.message}>
              <Input id="doc" {...form.register('companyDocument')} />
            </Field>
            <Field label="Seu nome" htmlFor="owner" error={e.ownerName?.message}>
              <Input id="owner" autoComplete="name" {...form.register('ownerName')} />
            </Field>
            <Field label="Telefone" htmlFor="phone" error={e.phone?.message}>
              <Input id="phone" type="tel" autoComplete="tel" {...form.register('phone')} />
            </Field>
            <Field label="E-mail" htmlFor="email" error={e.email?.message}>
              <Input id="email" type="email" autoComplete="email" {...form.register('email')} />
            </Field>
            <Field label="Senha" htmlFor="password" error={e.password?.message} hint="Mínimo de 10 caracteres, com letras e números">
              <Input id="password" type="password" autoComplete="new-password" {...form.register('password')} />
            </Field>
          </div>
          <div className="mt-4 space-y-2">
            <Checkbox id="terms" label="Li e aceito os Termos de Uso" checked={Boolean(form.watch('acceptTerms'))} onChange={(v) => form.setValue('acceptTerms', v as true, { shouldValidate: true })} />
            {e.acceptTerms && <p className="text-xs text-red-600">{e.acceptTerms.message}</p>}
            <Checkbox id="privacy" label="Li e aceito a Política de Privacidade" checked={Boolean(form.watch('acceptPrivacy'))} onChange={(v) => form.setValue('acceptPrivacy', v as true, { shouldValidate: true })} />
            {e.acceptPrivacy && <p className="text-xs text-red-600">{e.acceptPrivacy.message}</p>}
          </div>
        </Card>
        <Alert tone="blue">A operação (OS, PDV, filiais) é liberada somente após a confirmação do pagamento pelo Mercado Pago.</Alert>
        <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
          Criar conta e ir para o pagamento
        </Button>
      </form>
    </PublicLayout>
  );
}

/** Retorno do checkout: informativo. A ativação depende exclusivamente da confirmação do provedor. */
export function CheckoutPendingPage() {
  return (
    <PublicLayout>
      <Card title="Aguardando confirmação">
        <p className="text-sm text-slate-700">Estamos aguardando a confirmação do pagamento pelo Mercado Pago. Isso pode levar alguns minutos.</p>
        <Link to="/app/billing" className="mt-4 inline-block">
          <Button>Acompanhar na área de assinatura</Button>
        </Link>
      </Card>
    </PublicLayout>
  );
}

export function CheckoutResultPage() {
  return (
    <PublicLayout>
      <Card title="Retorno do checkout">
        <Alert tone="blue" title="Aguardando confirmação">
          O retorno do navegador não confirma o pagamento. Sua assinatura será ativada assim que o Mercado Pago confirmar a cobrança.
        </Alert>
        <Link to="/app/billing" className="mt-4 inline-block">
          <Button>Ver situação da assinatura</Button>
        </Link>
      </Card>
    </PublicLayout>
  );
}
