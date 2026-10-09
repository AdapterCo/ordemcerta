import { CheckCircle2, ClipboardCheck, PackageCheck, Wrench } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { toast } from 'sonner';
import { PublicLayout } from '@/components/layout';
import { SignaturePad } from '@/components/signature-pad';
import { Alert, Button, Card, Checkbox, Field, Input, Spinner, Textarea } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { formatBRL, formatDateBR, formatDateTimeBR, fragmentParam } from '@/lib/utils';

interface PortalView {
  company: { name: string; branch: string; phone: string | null };
  order: {
    number: number;
    customerFirstName: string;
    device: string;
    status: string;
    statusCode: string;
    delivery: string;
    deliveryCode: string;
    deliveredAt: string | null;
    receivedAt: string;
    estimatedDeliveryAt: string | null;
    warrantyUntil: string | null;
    messages: Array<{ text: string; createdAt: string }>;
  };
  quote: null | {
    id: string;
    version: number;
    status: string;
    expiresAt: string;
    estimatedDays: number | null;
    subtotalCents: number;
    discountCents: number;
    totalCents: number;
    lines: Array<{ description: string; qty: number; totalCents: number; warrantyDays: number }>;
    canDecide: boolean;
    acceptText: string;
    requiresOtp: boolean;
    otpChannelAvailable: boolean;
  };
}

function QuoteDecision({ token, view, onDone }: { token: string; view: PortalView; onDone: () => void }) {
  const q = view.quote!;
  const [name, setName] = useState('');
  const [otp, setOtp] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [otpSent, setOtpSent] = useState<string | null>(null);

  const requestOtp = async () => {
    try {
      const r = await api<{ sentTo: string }>('/public/status/otp/request', { method: 'POST', body: { token, quoteId: q.id } });
      setOtpSent(r.sentTo);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const decide = async (decision: 'approve' | 'reject') => {
    setBusy(true);
    try {
      await api(`/public/status/quotes/${q.id}/${decision}`, {
        method: 'POST',
        body: { token, signerName: name, acceptText: q.acceptText, otpCode: q.requiresOtp ? otp : undefined, reason: reason || undefined },
      });
      toast.success(decision === 'approve' ? 'Orçamento aprovado!' : 'Recusa registrada.');
      onDone();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 space-y-3 border-t border-slate-200 pt-4">
      <Field label="Seu nome completo" htmlFor="signer">
        <Input id="signer" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      {q.requiresOtp && (
        <div className="space-y-2">
          {!q.otpChannelAvailable ? (
            <Alert tone="yellow">Verificação adicional indisponível para este cadastro. Entre em contato com a loja para aprovar.</Alert>
          ) : (
            <>
              <Button size="sm" variant="secondary" onClick={requestOtp}>
                {otpSent ? 'Reenviar código' : 'Receber código por e-mail'}
              </Button>
              {otpSent && <p className="text-xs text-slate-500">Código enviado para {otpSent}</p>}
              <Field label="Código de confirmação" htmlFor="otp">
                <Input id="otp" inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} />
              </Field>
            </>
          )}
        </div>
      )}
      <p className="rounded bg-slate-50 p-3 text-sm text-slate-700">{q.acceptText}</p>
      <div className="flex flex-wrap gap-2">
        <Button loading={busy} disabled={name.trim().length < 3 || (q.requiresOtp && otp.length !== 6)} onClick={() => decide('approve')}>
          Aprovar orçamento
        </Button>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-slate-600">Não desejo aprovar</summary>
        <div className="mt-2 space-y-2">
          <Textarea placeholder="Motivo (opcional)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button variant="secondary" loading={busy} disabled={name.trim().length < 3 || (q.requiresOtp && otp.length !== 6)} onClick={() => decide('reject')}>
            Recusar orçamento
          </Button>
        </div>
      </details>
    </div>
  );
}

const STEPS = ['Recebido', 'Avaliação', 'Aprovação', 'Reparo', 'Pronto', 'Entregue'] as const;

/** Etapa atual na barra de progresso (null = fluxo encerrado sem reparo). */
function currentStep(statusCode: string, deliveryCode: string): number | null {
  if (deliveryCode === 'DELIVERED') return 5;
  if (['REJECTED', 'CANCELED', 'RETURNED_UNREPAIRED'].includes(statusCode)) return null;
  if (statusCode === 'READY') return 4;
  if (['APPROVED', 'WAITING_PARTS', 'IN_REPAIR', 'TESTING'].includes(statusCode)) return 3;
  if (statusCode === 'WAITING_QUOTE_APPROVAL') return 2;
  if (['DIAGNOSING', 'REOPENED'].includes(statusCode)) return 1;
  return 0;
}

function ProgressSteps({ step }: { step: number }) {
  return (
    <ol className="mt-4 grid grid-cols-6 gap-1" aria-label="Andamento do serviço">
      {STEPS.map((label, i) => (
        <li key={label} className="text-center">
          <div className={`h-2 rounded-full ${i < step ? 'bg-brand-600' : i === step ? 'animate-pulse bg-brand-600' : 'bg-slate-200'}`} />
          <span className={`mt-1 block text-[11px] leading-tight sm:text-xs ${i === step ? 'font-semibold text-brand-800' : i < step ? 'text-slate-700' : 'text-slate-400'}`}>{label}</span>
        </li>
      ))}
    </ol>
  );
}

/** Destaque do momento que o cliente quer ver: reparo em andamento e pronto para retirada. */
function StageHighlight({ view }: { view: PortalView }) {
  const o = view.order;
  if (o.deliveryCode === 'READY_FOR_PICKUP') {
    const repaired = o.statusCode === 'READY';
    return (
      <div className="rounded-xl border-2 border-emerald-500 bg-emerald-50 p-5 text-center shadow-sm">
        <PackageCheck className="mx-auto h-12 w-12 text-emerald-600" aria-hidden />
        <p className="mt-2 text-2xl font-bold text-emerald-800">{repaired ? 'Seu aparelho está pronto!' : 'Seu aparelho está disponível para retirada'}</p>
        <p className="mt-1 text-emerald-900">
          Pode retirar na <strong>{view.company.branch}</strong>
          {view.company.phone ? ` · ${view.company.phone}` : ''}.
        </p>
        <p className="mt-1 text-sm text-emerald-800">Leve este comprovante (ou o número da OS {o.number}) no momento da retirada.</p>
      </div>
    );
  }
  if (['IN_REPAIR', 'TESTING'].includes(o.statusCode)) {
    return (
      <div className="rounded-xl border-2 border-blue-500 bg-blue-50 p-5 text-center shadow-sm">
        <Wrench className="mx-auto h-12 w-12 animate-pulse text-blue-600" aria-hidden />
        <p className="mt-2 text-2xl font-bold text-blue-800">{o.statusCode === 'TESTING' ? 'Reparo feito, em testes finais' : 'Seu aparelho está em reparo'}</p>
        <p className="mt-1 text-blue-900">Nosso técnico está trabalhando no seu aparelho agora. Avisaremos quando estiver pronto.</p>
        {o.estimatedDeliveryAt && <p className="mt-1 text-sm text-blue-800">Previsão: {formatDateBR(o.estimatedDeliveryAt)}</p>}
      </div>
    );
  }
  if (o.statusCode === 'WAITING_QUOTE_APPROVAL') {
    return (
      <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-5 text-center">
        <ClipboardCheck className="mx-auto h-10 w-10 text-amber-600" aria-hidden />
        <p className="mt-2 text-xl font-bold text-amber-900">Precisamos da sua aprovação</p>
        <p className="mt-1 text-amber-900">Confira o orçamento abaixo para liberarmos o reparo.</p>
      </div>
    );
  }
  if (o.deliveryCode === 'DELIVERED') {
    return (
      <div className="rounded-xl border border-slate-300 bg-slate-50 p-4 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-slate-600" aria-hidden />
        <p className="mt-2 text-lg font-semibold">Aparelho entregue{o.deliveredAt ? ` em ${formatDateBR(o.deliveredAt)}` : ''}</p>
        {o.warrantyUntil && <p className="text-sm text-slate-600">Garantia até {formatDateBR(o.warrantyUntil)}</p>}
      </div>
    );
  }
  return null;
}

function PortalContent({ token, view, reload }: { token: string; view: PortalView; reload: () => void }) {
  const o = view.order;
  const step = currentStep(o.statusCode, o.deliveryCode);
  return (
    <div className="space-y-4">
      <StageHighlight view={view} />
      <Card title={`${view.company.name} — ${view.company.branch}`}>
        <p className="text-sm text-slate-500">Olá, {o.customerFirstName}!</p>
        <p className="mt-1 text-lg font-semibold">
          OS nº {o.number} · {o.device}
        </p>
        <p className="mt-2 inline-block rounded-full bg-brand-50 px-3 py-1 text-sm font-semibold text-brand-800">{o.status}</p>
        {step !== null && <ProgressSteps step={step} />}
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <dt className="text-slate-500">Recebido em</dt>
          <dd>{formatDateTimeBR(o.receivedAt)}</dd>
          <dt className="text-slate-500">Previsão</dt>
          <dd>{o.estimatedDeliveryAt ? formatDateBR(o.estimatedDeliveryAt) : 'A confirmar'}</dd>
          <dt className="text-slate-500">Entrega</dt>
          <dd>{o.delivery}</dd>
          {o.warrantyUntil && (
            <>
              <dt className="text-slate-500">Garantia até</dt>
              <dd>{formatDateBR(o.warrantyUntil)}</dd>
            </>
          )}
        </dl>
        {view.company.phone && <p className="mt-3 text-sm text-slate-600">Dúvidas: {view.company.phone}</p>}
      </Card>
      {o.messages.length > 0 && (
        <Card title="Mensagens da assistência">
          <ul className="space-y-2 text-sm">
            {o.messages.map((m, i) => (
              <li key={i}>
                <span className="text-slate-500">{formatDateTimeBR(m.createdAt)}:</span> {m.text}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {view.quote && (
        <Card title={`Orçamento (versão ${view.quote.version})`}>
          <ul className="divide-y divide-slate-100 text-sm">
            {view.quote.lines.map((l, i) => (
              <li key={i} className="flex justify-between py-2">
                <span>
                  {l.qty}x {l.description} <span className="text-xs text-slate-500">· garantia {l.warrantyDays} dias</span>
                </span>
                <span className="tabular-nums">{formatBRL(l.totalCents)}</span>
              </li>
            ))}
          </ul>
          {view.quote.discountCents > 0 && <p className="mt-2 text-right text-sm text-slate-600">Descontos: {formatBRL(view.quote.discountCents)}</p>}
          <p className="mt-1 text-right text-lg font-semibold">Total: {formatBRL(view.quote.totalCents)}</p>
          <p className="text-right text-xs text-slate-500">Válido até {formatDateTimeBR(view.quote.expiresAt)}</p>
          {view.quote.canDecide && <QuoteDecision token={token} view={view} onDone={reload} />}
        </Card>
      )}
    </div>
  );
}

/** /status, /status/:numero (#token=…) e /track/:token — token nunca é enviado em URL ao servidor. */
export function StatusPage() {
  const params = useParams();
  const initialToken = params.token ?? fragmentParam('token') ?? '';
  const [numero, setNumero] = useState(params.numero ?? '');
  const [token, setToken] = useState(initialToken);
  const [view, setView] = useState<PortalView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookup = async (t = token, n = numero) => {
    setLoading(true);
    setError(null);
    try {
      const v = n
        ? await api<PortalView>('/public/status/lookup', { method: 'POST', body: { orderNumber: Number(n), token: t } })
        : await api<PortalView>('/public/quote/view', { method: 'POST', body: { token: t } });
      setView(v);
      if (window.location.hash) history.replaceState(null, '', window.location.pathname);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const auto = useRef(false);
  useEffect(() => {
    if (initialToken && !auto.current) {
      auto.current = true;
      void lookup(initialToken, params.numero ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialToken]);

  return (
    <PublicLayout>
      <h1 className="mb-4 text-xl font-semibold">Acompanhar serviço</h1>
      {!view && (
        <Card>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void lookup();
            }}
          >
            <Field label="Número da OS" htmlFor="numero">
              <Input id="numero" inputMode="numeric" value={numero} onChange={(e) => setNumero(e.target.value.replace(/\D/g, ''))} />
            </Field>
            <Field label="Código do comprovante" htmlFor="token" hint="Impresso no comprovante ou enviado pelo link da loja">
              <Input id="token" value={token} onChange={(e) => setToken(e.target.value.trim())} autoComplete="off" />
            </Field>
            <Button type="submit" loading={loading} disabled={!token}>
              Consultar
            </Button>
          </form>
        </Card>
      )}
      {loading && !view && <Spinner />}
      {error && (
        <div className="mt-3">
          <Alert tone="red">{error}</Alert>
        </div>
      )}
      {view && <PortalContent token={token || initialToken} view={view} reload={() => void lookup(token || initialToken, String(view.order.number))} />}
    </PublicLayout>
  );
}

/** /quote#token=… ou /quote/:token — link de uso limitado para decidir o orçamento. */
export function QuotePage() {
  const params = useParams();
  const token = params.token ?? fragmentParam('token') ?? '';
  const [view, setView] = useState<PortalView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const load = async () => {
    try {
      setView(await api<PortalView>('/public/quote/view', { method: 'POST', body: { token } }));
      if (window.location.hash) history.replaceState(null, '', window.location.pathname);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  useEffect(() => {
    if (token && !started.current) {
      started.current = true;
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <PublicLayout>
      <h1 className="mb-4 text-xl font-semibold">Orçamento</h1>
      {!token && <Alert tone="red">Link inválido.</Alert>}
      {error && <Alert tone="red">{error}</Alert>}
      {!view && !error && token && <Spinner />}
      {view && <PortalContent token={token} view={view} reload={() => void load()} />}
    </PublicLayout>
  );
}

interface SignView {
  company: string;
  branch: string;
  orderNumber: number;
  device: string;
  purpose: 'INTAKE' | 'PICKUP';
  title: string;
  text: string;
  suggestedName: string;
  alreadySigned: boolean;
}

/** Assinatura no celular do cliente (aberta pelo QR code da loja; token no fragmento #). */
export function SignPage() {
  const token = fragmentParam('token');
  const [view, setView] = useState<SignView | null>(null);
  const [error, setError] = useState<string | null>(token ? null : 'Link inválido. Peça à loja um novo QR code.');
  const [name, setName] = useState('');
  const [agree, setAgree] = useState(false);
  const [png, setPng] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    api<SignView>('/public/signature/view', { method: 'POST', body: { token } })
      .then((v) => {
        setView(v);
        setName(v.suggestedName);
        if (v.alreadySigned) setDone(true);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [token]);

  const submit = async () => {
    setBusy(true);
    try {
      await api('/public/signature/submit', { method: 'POST', body: { token, signerName: name, signaturePng: png } });
      setDone(true);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PublicLayout>
      <div className="mx-auto max-w-lg space-y-4 py-4">
        {error && <Alert tone="red">{error}</Alert>}
        {!view && !error && <Spinner />}
        {view && done && (
          <div className="rounded-xl border-2 border-emerald-500 bg-emerald-50 p-6 text-center">
            <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-600" aria-hidden />
            <p className="mt-2 text-2xl font-bold text-emerald-800">Assinatura enviada!</p>
            <p className="mt-1 text-emerald-900">A loja já recebeu. Obrigado, pode fechar esta página.</p>
          </div>
        )}
        {view && !done && (
          <>
            <Card title={view.title}>
              <p className="text-sm text-slate-500">
                {view.company} · {view.branch}
              </p>
              <p className="mt-1 font-semibold">
                OS nº {view.orderNumber} · {view.device}
              </p>
              <div className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">{view.text}</div>
            </Card>
            <Card title="Sua assinatura">
              <div className="space-y-3">
                <Field label="Seu nome completo" htmlFor="sn">
                  <Input id="sn" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <SignaturePad height={200} onChange={setPng} />
                <Checkbox id="agree" label="Li e concordo com o documento acima" checked={agree} onChange={setAgree} />
                <Button className="w-full" size="lg" loading={busy} disabled={!png || !agree || name.trim().length < 3} onClick={() => void submit()}>
                  Assinar e enviar
                </Button>
                <p className="text-xs text-slate-500">Assinatura eletrônica simples: registramos data, hora e o documento assinado.</p>
              </div>
            </Card>
          </>
        )}
      </div>
    </PublicLayout>
  );
}
