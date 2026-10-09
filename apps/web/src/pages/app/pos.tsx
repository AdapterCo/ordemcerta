import { PAYMENT_METHODS, computeTotals } from '@ordemcerta/shared';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Pagination, QueryState, useAction, useApi, useUrlFilters } from '@/components/data';
import { Alert, Badge, Button, Card, ConfirmDialog, Dialog, Field, Input, MoneyInput, PageHeader, Select, Table, Td, Th } from '@/components/ui';
import { api, errorMessage, newIdemKey, openPdf, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatBRL, formatDateTimeBR, PAYMENT_METHOD_LABELS } from '@/lib/utils';

interface Product {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  priceCents: number;
  promoPriceCents: number | null;
  kind: string;
}
interface CartItem {
  product: Product;
  qty: number;
  discountCents: number;
}

/** PDV: leitura de código de barras (Enter), atalhos F2 (busca) e F9 (finalizar). */
export function PosPage() {
  const { branchId, can } = useAuth();
  const [params] = useSearchParams();
  const orderId = params.get('orderId');
  const [term, setTerm] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState(0);
  const [checkout, setCheckout] = useState(false);
  const [parts, setParts] = useState<Array<{ method: string; amountCents: number; tenderedCents?: number }>>([]);
  const [session, setSession] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ id: string; number: number; changeCents: number } | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const idem = useRef({ create: newIdemKey(), confirm: newIdemKey() });
  const results = useApi<Paginated<Product>>(['pos-products', term], term.length >= 2 ? '/products' : null, { q: term, active: 'true', pageSize: 8 });
  const sessions = useApi<Array<{ id: string; branchId: string; register: { name: string } }>>(['cash-current'], '/cash-sessions/current');
  const mySession = sessions.data?.find((s) => s.branchId === branchId);

  useEffect(() => {
    if (mySession && !session) setSession(mySession.id);
  }, [mySession, session]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        search.current?.focus();
      }
      if (e.key === 'F9' && cart.length) {
        e.preventDefault();
        setCheckout(true);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [cart.length]);

  const add = (p: Product) => {
    setCart((c) => {
      const ex = c.find((x) => x.product.id === p.id);
      return ex ? c.map((x) => (x.product.id === p.id ? { ...x, qty: x.qty + 1 } : x)) : [...c, { product: p, qty: 1, discountCents: 0 }];
    });
    setTerm('');
    search.current?.focus();
  };

  const scan = async () => {
    try {
      const r = await api<Paginated<Product>>('/products', { query: { barcode: term, active: 'true', pageSize: 1 } });
      if (r.items[0]) add(r.items[0]);
      else if (results.data?.items.length === 1) add(results.data.items[0]!);
      else toast.error('Produto não encontrado');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  let totals = { subtotalCents: 0, discountCents: 0, totalCents: 0 };
  let totalsError: string | null = null;
  try {
    totals = computeTotals(
      cart.map((c) => ({ qty: c.qty, unitPriceCents: c.product.promoPriceCents ?? c.product.priceCents, discountCents: c.discountCents })),
      discount,
    );
  } catch (e) {
    totalsError = (e as Error).message;
  }
  const paid = parts.reduce((s, p) => s + p.amountCents, 0);

  const finish = async () => {
    setBusy(true);
    try {
      const sale = await api<{ id: string; number: number }>('/sales', {
        method: 'POST',
        idempotencyKey: idem.current.create,
        body: { branchId, orderId, items: cart.map((c) => ({ productId: c.product.id, qty: c.qty, discountCents: c.discountCents })), discountCents: discount },
      });
      const r = await api<{ changeCents: number }>(`/sales/${sale.id}/confirm`, {
        method: 'POST',
        idempotencyKey: idem.current.confirm,
        body: { cashSessionId: session, payments: parts.map((p) => ({ ...p, tenderedCents: p.method === 'CASH' ? p.tenderedCents : undefined })) },
      });
      idem.current = { create: newIdemKey(), confirm: newIdemKey() };
      setDone({ id: sale.id, number: sale.number, changeCents: r.changeCents });
      setCart([]);
      setDiscount(0);
      setParts([]);
      setCheckout(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!mySession && !sessions.isLoading) {
    return (
      <div>
        <PageHeader title="PDV" />
        <Alert tone="yellow" title="Caixa fechado">
          Abra uma sessão de caixa nesta filial para vender. <Link className="underline" to="/app/cash">Abrir caixa</Link>
        </Alert>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <PageHeader title="PDV" description={`${mySession?.register.name ?? ''} · F2 buscar · F9 finalizar`} />
        {orderId && (
          <div className="mb-3">
            <Alert tone="blue" title="Venda vinculada a uma ordem de serviço">
              Os itens desta venda ficam registrados na OS.{' '}
              <Link className="underline" to={`/app/service-orders/${orderId}`}>
                Voltar para a OS sem vender
              </Link>
            </Alert>
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void scan();
          }}
        >
          <Input ref={search} autoFocus aria-label="Código de barras ou busca" placeholder="Leia o código de barras ou digite o nome/SKU" value={term} onChange={(e) => setTerm(e.target.value)} />
        </form>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {results.data?.items.map((p) => (
            <button key={p.id} type="button" className="rounded border border-slate-200 bg-white p-2 text-left text-sm hover:bg-slate-50" onClick={() => add(p)}>
              <span className="font-medium">{p.name}</span>
              <span className="float-right tabular-nums">{formatBRL(p.promoPriceCents ?? p.priceCents)}</span>
              <span className="block text-xs text-slate-500">{p.sku}</span>
            </button>
          ))}
        </div>
        <Table className="mt-4">
          <thead>
            <tr>
              <Th>Item</Th>
              <Th>Qtd</Th>
              <Th>Unitário</Th>
              {can('sales:discount') && <Th>Desconto</Th>}
              <Th>Total</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {!cart.length && (
              <tr>
                <Td colSpan={6} className="py-14 text-center">
                  <p className="font-display text-base font-semibold text-ink-900">Carrinho vazio</p>
                  <p className="mt-1 text-sm text-ink-600/70">Leia o código de barras ou digite o nome do produto acima (atalho F2).</p>
                </Td>
              </tr>
            )}
            {cart.map((c, i) => {
              const unit = c.product.promoPriceCents ?? c.product.priceCents;
              return (
                <tr key={c.product.id}>
                  <Td>{c.product.name}</Td>
                  <Td>
                    <Input aria-label="Quantidade" type="number" min={1} className="w-20" value={c.qty} onChange={(e) => setCart(cart.map((x, j) => (j === i ? { ...x, qty: Math.max(1, Number(e.target.value)) } : x)))} />
                  </Td>
                  <Td>{formatBRL(unit)}</Td>
                  {can('sales:discount') && (
                    <Td>
                      <MoneyInput value={c.discountCents} onChange={(v) => setCart(cart.map((x, j) => (j === i ? { ...x, discountCents: v } : x)))} />
                    </Td>
                  )}
                  <Td className="tabular-nums">{formatBRL(c.qty * unit - c.discountCents)}</Td>
                  <Td>
                    <Button size="sm" variant="ghost" onClick={() => setCart(cart.filter((_, j) => j !== i))} aria-label="Remover">
                      ×
                    </Button>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </div>
      <Card title="Total">
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd>{formatBRL(totals.subtotalCents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Descontos</dt>
            <dd>{formatBRL(totals.discountCents)}</dd>
          </div>
          <div className="flex justify-between text-xl font-bold">
            <dt>Total</dt>
            <dd>{formatBRL(totals.totalCents)}</dd>
          </div>
        </dl>
        {can('sales:discount') && (
          <Field label="Desconto geral" htmlFor="disc" className="mt-3">
            <MoneyInput id="disc" value={discount} onChange={setDiscount} />
          </Field>
        )}
        {totalsError && <p className="mt-2 text-sm text-red-600">{totalsError}</p>}
        <Button
          size="lg"
          className="mt-4 w-full"
          disabled={!cart.length || Boolean(totalsError)}
          onClick={() => {
            setParts([{ method: 'CASH', amountCents: totals.totalCents, tenderedCents: totals.totalCents }]);
            setCheckout(true);
          }}
        >
          Finalizar (F9)
        </Button>
        <p className="mt-2 text-center text-xs text-slate-500">Comprovante NÃO FISCAL</p>
      </Card>

      <Dialog
        open={checkout}
        onOpenChange={setCheckout}
        title={`Pagamento — ${formatBRL(totals.totalCents)}`}
        wide
        footer={
          <Button size="lg" loading={busy} disabled={paid !== totals.totalCents || !session} onClick={() => void finish()}>
            Confirmar venda
          </Button>
        }
      >
        <div className="space-y-2">
          {parts.map((p, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Select aria-label="Meio" value={p.method} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, method: e.target.value } : x)))}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABELS[m]}
                  </option>
                ))}
              </Select>
              <MoneyInput value={p.amountCents} onChange={(v) => setParts(parts.map((x, j) => (j === i ? { ...x, amountCents: v } : x)))} />
              {p.method === 'CASH' && (
                <div>
                  <MoneyInput value={p.tenderedCents ?? p.amountCents} onChange={(v) => setParts(parts.map((x, j) => (j === i ? { ...x, tenderedCents: v } : x)))} />
                  <p className="text-xs text-slate-500">Troco: {formatBRL(Math.max((p.tenderedCents ?? p.amountCents) - p.amountCents, 0))}</p>
                </div>
              )}
              <Button variant="ghost" size="sm" onClick={() => setParts(parts.filter((_, j) => j !== i))}>
                Remover
              </Button>
            </div>
          ))}
          <Button size="sm" variant="secondary" onClick={() => setParts([...parts, { method: 'PIX', amountCents: Math.max(totals.totalCents - paid, 0) }])}>
            + Pagamento misto
          </Button>
          <p className={paid === totals.totalCents ? 'text-sm text-emerald-700' : 'text-sm text-red-600'}>
            Pago {formatBRL(paid)} de {formatBRL(totals.totalCents)}
          </p>
          <p className="text-xs text-slate-500">Recebimentos registrados manualmente (sem integração de adquirência). Pix/cartão devem ser conferidos na maquininha/banco.</p>
        </div>
      </Dialog>
      <Dialog open={Boolean(done)} onOpenChange={() => setDone(null)} title={`Venda nº ${done?.number} confirmada`}>
        {done && (
          <div className="space-y-3">
            {done.changeCents > 0 && <p className="text-2xl font-bold">Troco: {formatBRL(done.changeCents)}</p>}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void openPdf(`/sales/${done.id}/receipt`, { format: 'THERMAL' })}>Comprovante térmico</Button>
              <Button variant="secondary" onClick={() => void openPdf(`/sales/${done.id}/receipt`, { format: 'A4' })}>
                A4
              </Button>
              {orderId && (
                <Link to={`/app/service-orders/${orderId}`}>
                  <Button variant="secondary">Voltar para a OS</Button>
                </Link>
              )}
            </div>
            {orderId && <p className="text-xs text-slate-500">Esta venda ficou registrada na OS (aba Pagamento → Vendas vinculadas).</p>}
          </div>
        )}
      </Dialog>
    </div>
  );
}

interface SaleRow {
  id: string;
  number: number;
  status: string;
  totalCents: number;
  refundedCents: number;
  confirmedAt: string | null;
  createdAt: string;
  items: Array<{ id: string; description: string; qty: number; refundedQty: number }>;
}

export function SalesPage() {
  const { branchId, can } = useAuth();
  const [f, setF] = useUrlFilters({ status: '', page: '1' });
  const q = useApi<Paginated<SaleRow>>(['sales', branchId], '/sales', { branchId: branchId ?? undefined, status: f.status, page: f.page });
  const sessions = useApi<Array<{ id: string; branchId: string }>>(['cash-current'], '/cash-sessions/current');
  const [refund, setRefund] = useState<SaleRow | null>(null);
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const doRefund = useAction(
    (_: void, key) =>
      api(`/sales/${refund!.id}/refund`, {
        method: 'POST',
        idempotencyKey: key,
        body: {
          reason,
          cashSessionId: sessions.data?.find((s) => s.branchId === branchId)?.id,
          method: 'CASH',
          returnToStock: true,
          items: Object.entries(qtys)
            .filter(([, v]) => v > 0)
            .map(([saleItemId, qty]) => ({ saleItemId, qty })),
        },
      }),
    { success: 'Estorno registrado', invalidate: [['sales']], onSuccess: () => setRefund(null) },
  );
  const statusLabel: Record<string, string> = { DRAFT: 'Rascunho', CONFIRMED: 'Confirmada', CANCELED: 'Cancelada', REFUNDED: 'Estornada', PARTIALLY_REFUNDED: 'Estorno parcial' };
  return (
    <div>
      <PageHeader title="Vendas" actions={<Link to="/app/sales/pos"><Button>Abrir PDV</Button></Link>} />
      <Select aria-label="Status" className="mb-3 max-w-xs" value={f.status} onChange={(e) => setF({ status: e.target.value })}>
        <option value="">Todas</option>
        {Object.entries(statusLabel).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </Select>
      <QueryState loading={q.isLoading} error={q.error} empty={q.data?.items.length === 0}>
        <Table>
          <thead>
            <tr>
              <Th>Venda</Th>
              <Th>Data</Th>
              <Th>Status</Th>
              <Th>Total</Th>
              <Th>Estornado</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {q.data?.items.map((s) => (
              <tr key={s.id}>
                <Td>{s.number}</Td>
                <Td>{formatDateTimeBR(s.confirmedAt ?? s.createdAt)}</Td>
                <Td>
                  <Badge tone={s.status === 'CONFIRMED' ? 'green' : s.status.includes('REFUND') ? 'yellow' : 'gray'}>{statusLabel[s.status]}</Badge>
                </Td>
                <Td>{formatBRL(s.totalCents)}</Td>
                <Td>{formatBRL(s.refundedCents)}</Td>
                <Td>
                  <div className="flex gap-1">
                    {s.status !== 'DRAFT' && s.status !== 'CANCELED' && (
                      <Button size="sm" variant="secondary" onClick={() => void openPdf(`/sales/${s.id}/receipt`, { format: 'THERMAL' })}>
                        Comprovante
                      </Button>
                    )}
                    {can('sales:refund') && ['CONFIRMED', 'PARTIALLY_REFUNDED'].includes(s.status) && (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          setRefund(s);
                          setQtys({});
                        }}
                      >
                        Estornar
                      </Button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {q.data && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={(p) => setF({ page: String(p) })} />}
      </QueryState>
      <ConfirmDialog open={Boolean(refund)} onOpenChange={() => setRefund(null)} title={`Estornar venda ${refund?.number}`} danger loading={doRefund.isPending} onConfirm={() => doRefund.mutate()}>
        <div className="space-y-2">
          {refund?.items.map((it) => (
            <div key={it.id} className="flex items-center justify-between gap-2 text-sm">
              <span>
                {it.description} (disponível {it.qty - it.refundedQty})
              </span>
              <Input aria-label="Quantidade a estornar" type="number" min={0} max={it.qty - it.refundedQty} className="w-20" value={qtys[it.id] ?? 0} onChange={(e) => setQtys({ ...qtys, [it.id]: Number(e.target.value) })} />
            </div>
          ))}
          <Input aria-label="Motivo" placeholder="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} />
          <p className="text-xs text-slate-500">O valor volta pelo meio original; itens retornam ao estoque.</p>
        </div>
      </ConfirmDialog>
    </div>
  );
}
