import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { toast } from 'sonner';
import { PublicLayout } from '@/components/layout';
import { Alert, Button, Card, Field, Input, Spinner, Textarea } from '@/components/ui';
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

function PortalContent({ token, view, reload }: { token: string; view: PortalView; reload: () => void }) {
  const o = view.order;
  return (
    <div className="space-y-4">
      <Card title={`${view.company.name} — ${view.company.branch}`}>
        <p className="text-sm text-slate-500">Olá, {o.customerFirstName}!</p>
        <p className="mt-1 text-lg font-semibold">
          OS nº {o.number} · {o.device}
        </p>
        <p className="mt-2 inline-block rounded-full bg-brand-50 px-3 py-1 text-sm font-semibold text-brand-800">{o.status}</p>
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
