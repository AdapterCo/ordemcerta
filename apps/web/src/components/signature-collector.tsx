import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { SignaturePad } from './signature-pad';
import { Alert, Button, Spinner } from './ui';

/** Como a assinatura foi coletada (enviada à API junto com o termo). */
export type SignatureValue = { kind: 'capture'; captureId: string; signerName: string } | { kind: 'screen'; png: string } | { kind: 'paper' };

type Mode = 'phone' | 'screen' | 'paper';

interface Capture {
  captureId: string;
  url: string;
  expiresAt: string;
}

/**
 * Coleta da assinatura do cliente:
 *  - no celular do próprio cliente (QR code, padrão — não depende de tela touch na loja);
 *  - nesta tela (mouse ou tela touch);
 *  - ficha impressa assinada à caneta.
 */
export function SignatureCollector({
  orderId,
  purpose,
  paperLabel,
  onChange,
}: {
  orderId: string;
  purpose: 'INTAKE' | 'PICKUP';
  /** Texto da opção "papel" (ex.: "Assinou a ficha impressa"). */
  paperLabel: string;
  onChange: (v: SignatureValue | null) => void;
}) {
  const [mode, setMode] = useState<Mode>('phone');
  const [capture, setCapture] = useState<Capture | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const create = async () => {
    setCreating(true);
    try {
      const c = await api<Capture>(`/service-orders/${orderId}/signature-captures`, { method: 'POST', body: { purpose } });
      setCapture(c);
      setQr(await QRCode.toDataURL(c.url, { margin: 1, width: 240 }));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setCreating(false);
    }
  };

  const status = useQuery({
    queryKey: ['signature-capture', capture?.captureId],
    queryFn: () => api<{ status: 'PENDING' | 'CAPTURED' | 'EXPIRED' | 'USED'; signerName: string | null; previewPng: string | null }>(`/service-orders/${orderId}/signature-captures/${capture!.captureId}`),
    enabled: Boolean(capture) && mode === 'phone',
    refetchInterval: (q) => (q.state.data && q.state.data.status !== 'PENDING' ? false : 2000),
  });

  // Ao escolher "celular", gera o QR automaticamente.
  useEffect(() => {
    if (mode === 'phone' && !capture && !creating) void create();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Informa o valor ao formulário conforme o modo/andamento.
  useEffect(() => {
    if (mode === 'paper') onChange({ kind: 'paper' });
    else if (mode === 'phone') {
      const s = status.data;
      onChange(s?.status === 'CAPTURED' && capture ? { kind: 'capture', captureId: capture.captureId, signerName: s.signerName ?? '' } : null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, status.data?.status, capture?.captureId]);

  const tabs: Array<[Mode, string]> = [
    ['phone', 'No celular do cliente'],
    ['screen', 'Nesta tela'],
    ['paper', 'Ficha impressa'],
  ];

  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Forma de assinatura" className="inline-flex flex-wrap overflow-hidden rounded-md border border-slate-300">
        {tabs.map(([m, label]) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            className={`border-l border-slate-300 px-3 py-1.5 text-sm first:border-l-0 ${mode === m ? 'bg-brand-700 font-medium text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
            onClick={() => {
              setMode(m);
              if (m === 'screen') onChange(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'phone' && (
        <div className="space-y-2 text-center">
          {!capture || !qr ? (
            <div className="py-6">
              <Spinner />
            </div>
          ) : status.data?.status === 'CAPTURED' ? (
            <div className="space-y-2">
              <Alert tone="green" title="Assinatura recebida do celular">
                Assinado por <strong>{status.data.signerName}</strong>.
              </Alert>
              {status.data.previewPng && <img src={status.data.previewPng} alt="Assinatura recebida" className="mx-auto max-h-28 rounded border border-slate-200 bg-white" />}
            </div>
          ) : status.data?.status === 'EXPIRED' || status.data?.status === 'USED' ? (
            <div className="space-y-2">
              <Alert tone="yellow">{status.data.status === 'EXPIRED' ? 'O QR code expirou.' : 'Esta assinatura já foi usada.'}</Alert>
              <Button size="sm" loading={creating} onClick={() => void create()}>
                Gerar novo QR code
              </Button>
            </div>
          ) : (
            <>
              <img src={qr} alt="QR code para o cliente assinar no celular" className="mx-auto h-56 w-56" />
              <p className="text-sm font-medium">Peça para o cliente apontar a câmera do celular para o QR code.</p>
              <p className="text-xs text-slate-500">Ele lê o termo, assina com o dedo e confirma. Esta tela atualiza sozinha. Válido por 15 minutos.</p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => void navigator.clipboard.writeText(capture.url).then(() => toast.success('Link copiado (envie pelo WhatsApp do cliente)'))}>
                  Copiar link
                </Button>
                <Button size="sm" variant="ghost" loading={creating} onClick={() => void create()}>
                  Gerar novo
                </Button>
              </div>
              <p className="flex items-center justify-center gap-2 text-xs text-slate-500">
                <Spinner /> Aguardando a assinatura…
              </p>
            </>
          )}
        </div>
      )}

      {mode === 'screen' && (
        <div className="space-y-1">
          <SignaturePad onChange={(png) => onChange(png ? { kind: 'screen', png } : null)} />
          <p className="text-xs text-slate-500">Funciona com mouse ou tela touch. Para assinar com o dedo, prefira o celular do cliente.</p>
        </div>
      )}

      {mode === 'paper' && (
        <Alert tone="blue" title={paperLabel}>
          Imprima o documento, colha a assinatura à caneta e guarde a via assinada. O sistema registra que a assinatura foi feita em papel.
        </Alert>
      )}
    </div>
  );
}
