import { PRODUCT_KINDS } from '@ordemcerta/shared';
import { useState } from 'react';
import { Pagination, QueryState, useAction, useApi, useUrlFilters } from '@/components/data';
import { Badge, Button, Checkbox, Dialog, Field, Input, MoneyInput, PageHeader, Select, Table, Tabs, Td, Th } from '@/components/ui';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatBRL, formatDateTimeBR } from '@/lib/utils';

/* eslint-disable @typescript-eslint/no-explicit-any */
const KIND_LABEL: Record<string, string> = { PRODUCT: 'Produto', PART: 'Peça', SERVICE: 'Serviço' };

export function ProductsPage() {
  const { can } = useAuth();
  const [f, setF] = useUrlFilters({ q: '', kind: '', page: '1' });
  const q = useApi<Paginated<any>>(['products'], '/products', { q: f.q, kind: f.kind, page: f.page });
  const categories = useApi<Array<{ id: string; name: string }>>(['categories'], '/categories');
  const [edit, setEdit] = useState<any | null>(null);
  const empty = { sku: '', barcode: '', name: '', kind: 'PRODUCT', unit: 'UN', costCents: 0, priceCents: 0, promoPriceCents: null, minStock: 0, active: true, categoryId: '', location: '', compatibility: [] as Array<{ brand: string; model: string }> };
  const [compat, setCompat] = useState('');
  const save = useAction(
    (_: void) => {
      const body = { ...edit, barcode: edit.barcode || null, categoryId: edit.categoryId || null, location: edit.location || null, promoPriceCents: edit.promoPriceCents || null };
      const { id, balances: _b, tenantId: _t, createdAt: _c, updatedAt: _u, supplierId: _s, description: _d, ...rest } = body;
      return id ? api(`/products/${id}`, { method: 'PATCH', body: rest }) : api('/products', { method: 'POST', body: rest });
    },
    { success: 'Produto salvo', invalidate: [['products']], onSuccess: () => setEdit(null) },
  );
  const newCategory = useAction((name: string) => api('/categories', { method: 'POST', body: { name } }), { success: 'Categoria criada', invalidate: [['categories']] });
  return (
    <div>
      <PageHeader title="Produtos, peças e serviços" actions={can('product:edit') && <Button onClick={() => setEdit(empty)}>Novo item</Button>} />
      <div className="mb-3 flex flex-wrap gap-2">
        <Input aria-label="Buscar" className="max-w-sm" placeholder="Nome, SKU, código de barras, modelo compatível" defaultValue={f.q} onKeyDown={(e) => e.key === 'Enter' && setF({ q: (e.target as HTMLInputElement).value })} />
        <Select aria-label="Tipo" className="w-auto" value={f.kind} onChange={(e) => setF({ kind: e.target.value })}>
          <option value="">Todos</option>
          {PRODUCT_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </Select>
      </div>
      <QueryState loading={q.isLoading} error={q.error} empty={q.data?.items.length === 0}>
        <Table>
          <thead>
            <tr>
              <Th>SKU</Th>
              <Th>Nome</Th>
              <Th>Tipo</Th>
              <Th>Custo</Th>
              <Th>Preço</Th>
              <Th>Saldo</Th>
              <Th>Mín.</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {q.data?.items.map((p) => {
              const onHand = p.balances.reduce((s: number, b: any) => s + b.onHand - b.reserved, 0);
              return (
                <tr key={p.id}>
                  <Td>{p.sku}</Td>
                  <Td>
                    {p.name} {!p.active && <Badge>inativo</Badge>}
                  </Td>
                  <Td>{KIND_LABEL[p.kind]}</Td>
                  <Td>{formatBRL(p.costCents)}</Td>
                  <Td>
                    {formatBRL(p.priceCents)}
                    {p.promoPriceCents && <span className="block text-xs text-emerald-700">promo {formatBRL(p.promoPriceCents)}</span>}
                  </Td>
                  <Td className={p.kind !== 'SERVICE' && onHand < p.minStock ? 'font-semibold text-red-600' : ''}>{p.kind === 'SERVICE' ? '—' : onHand}</Td>
                  <Td>{p.minStock}</Td>
                  <Td>
                    {can('product:edit') && (
                      <Button size="sm" variant="secondary" onClick={() => setEdit({ ...p, categoryId: p.categoryId ?? '', barcode: p.barcode ?? '', location: p.location ?? '' })}>
                        Editar
                      </Button>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        {q.data && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={(p) => setF({ page: String(p) })} />}
      </QueryState>
      <Dialog open={Boolean(edit)} onOpenChange={() => setEdit(null)} title={edit?.id ? 'Editar item' : 'Novo item'} wide footer={<Button loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button>}>
        {edit && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="SKU" htmlFor="sku">
              <Input id="sku" value={edit.sku} onChange={(e) => setEdit({ ...edit, sku: e.target.value })} />
            </Field>
            <Field label="Código de barras" htmlFor="bc">
              <Input id="bc" value={edit.barcode} onChange={(e) => setEdit({ ...edit, barcode: e.target.value })} />
            </Field>
            <Field label="Tipo" htmlFor="kind">
              <Select id="kind" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>
                {PRODUCT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Nome" htmlFor="pname" className="sm:col-span-2">
              <Input id="pname" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </Field>
            <Field label="Categoria" htmlFor="cat">
              <div className="flex gap-1">
                <Select id="cat" value={edit.categoryId} onChange={(e) => setEdit({ ...edit, categoryId: e.target.value })}>
                  <option value="">—</option>
                  {categories.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
                <Button type="button" size="sm" variant="ghost" onClick={() => { const n = prompt('Nova categoria'); if (n) newCategory.mutate(n); }}>
                  +
                </Button>
              </div>
            </Field>
            <Field label="Custo" htmlFor="cost">
              <MoneyInput id="cost" value={edit.costCents} onChange={(v) => setEdit({ ...edit, costCents: v })} />
            </Field>
            <Field label="Preço" htmlFor="price">
              <MoneyInput id="price" value={edit.priceCents} onChange={(v) => setEdit({ ...edit, priceCents: v })} />
            </Field>
            <Field label="Preço promocional" htmlFor="promo">
              <MoneyInput id="promo" value={edit.promoPriceCents ?? 0} onChange={(v) => setEdit({ ...edit, promoPriceCents: v || null })} />
            </Field>
            <Field label="Estoque mínimo" htmlFor="min">
              <Input id="min" type="number" min={0} value={edit.minStock} onChange={(e) => setEdit({ ...edit, minStock: Number(e.target.value) })} />
            </Field>
            <Field label="Localização física" htmlFor="loc">
              <Input id="loc" value={edit.location} onChange={(e) => setEdit({ ...edit, location: e.target.value })} />
            </Field>
            <div className="flex items-end">
              <Checkbox label="Ativo" checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} />
            </div>
            <Field label="Compatibilidade (marca/modelo)" htmlFor="compat" className="sm:col-span-3" hint="Ex.: Samsung A54 — Enter para adicionar">
              <Input
                id="compat"
                value={compat}
                onChange={(e) => setCompat(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && compat.includes(' ')) {
                    e.preventDefault();
                    const [brand, ...model] = compat.split(' ');
                    setEdit({ ...edit, compatibility: [...(edit.compatibility ?? []), { brand, model: model.join(' ') }] });
                    setCompat('');
                  }
                }}
              />
              <div className="mt-1 flex flex-wrap gap-1">
                {(edit.compatibility ?? []).map((c: any, i: number) => (
                  <Badge key={i}>
                    {c.brand} {c.model}
                  </Badge>
                ))}
              </div>
            </Field>
          </div>
        )}
      </Dialog>
    </div>
  );
}

export function StockPage() {
  const { branchId, can } = useAuth();
  const [f, setF] = useUrlFilters({ q: '', belowMin: '', page: '1' });
  const balances = useApi<Paginated<any>>(['stock-balances', branchId], '/stock/balances', { branchId: branchId ?? undefined, q: f.q, belowMin: f.belowMin, page: f.page });
  const movements = useApi<Paginated<any>>(['stock-movements', branchId], '/stock/movements', { branchId: branchId ?? undefined, pageSize: 50 });
  const [op, setOp] = useState<null | 'receive' | 'adjust'>(null);
  const [term, setTerm] = useState('');
  const products = useApi<Paginated<any>>(['stock-products', term], term.length >= 2 ? '/products' : null, { q: term, pageSize: 6 });
  const [product, setProduct] = useState<any | null>(null);
  const [form, setForm] = useState({ quantity: 1, unitCostCents: 0, type: 'ADJUSTMENT', reason: '', overrideNegative: false, reference: '' });
  const submit = useAction(
    (_: void, key) =>
      op === 'receive'
        ? api('/stock/receive', { method: 'POST', idempotencyKey: key, body: { branchId, reference: form.reference || null, items: [{ productId: product.id, quantity: form.quantity, unitCostCents: form.unitCostCents }] } })
        : api('/stock/adjust', { method: 'POST', idempotencyKey: key, body: { branchId, productId: product.id, quantityDelta: form.quantity, type: form.type, reason: form.reason, overrideNegative: form.overrideNegative } }),
    { success: 'Estoque atualizado', invalidate: [['stock-balances'], ['stock-movements']], onSuccess: () => setOp(null) },
  );
  const typeLabel: Record<string, string> = {
    RECEIPT: 'Entrada', SALE: 'Venda', SALE_CANCEL: 'Devolução de venda', OS_CONSUMPTION: 'Consumo OS', OS_CONSUMPTION_REVERSAL: 'Estorno OS', RETURN: 'Devolução',
    TRANSFER_OUT: 'Transferência (saída)', TRANSFER_IN: 'Transferência (entrada)', ADJUSTMENT: 'Ajuste', LOSS: 'Perda', RESERVE: 'Reserva', RELEASE: 'Liberação',
  };
  return (
    <div>
      <PageHeader
        title="Estoque"
        actions={
          <>
            {can('stock:receive') && <Button onClick={() => setOp('receive')}>Entrada</Button>}
            {can('stock:adjust') && (
              <Button variant="secondary" onClick={() => setOp('adjust')}>
                Ajuste/perda
              </Button>
            )}
          </>
        }
      />
      <Tabs
        tabs={[
          {
            value: 'balances',
            label: 'Saldos',
            content: (
              <>
                <div className="mb-3 flex flex-wrap gap-3">
                  <Input aria-label="Buscar" className="max-w-sm" placeholder="Produto ou SKU" defaultValue={f.q} onKeyDown={(e) => e.key === 'Enter' && setF({ q: (e.target as HTMLInputElement).value })} />
                  <Checkbox label="Abaixo do mínimo" checked={f.belowMin === 'true'} onChange={(v) => setF({ belowMin: v ? 'true' : '' })} />
                </div>
                <QueryState loading={balances.isLoading} error={balances.error} empty={balances.data?.items.length === 0}>
                  <Table>
                    <thead>
                      <tr>
                        <Th>Produto</Th>
                        <Th>Local</Th>
                        <Th>Físico</Th>
                        <Th>Reservado</Th>
                        <Th>Disponível</Th>
                        <Th>Mínimo</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {balances.data?.items.map((b) => (
                        <tr key={b.id}>
                          <Td>
                            {b.product.name} <span className="text-xs text-slate-500">{b.product.sku}</span>
                          </Td>
                          <Td>{b.location.name}</Td>
                          <Td>{b.onHand}</Td>
                          <Td>{b.reserved}</Td>
                          <Td className={b.belowMin ? 'font-semibold text-red-600' : ''}>{b.available}</Td>
                          <Td>{b.product.minStock}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                  {balances.data && <Pagination page={balances.data.page} pageSize={balances.data.pageSize} total={balances.data.total} onPage={(p) => setF({ page: String(p) })} />}
                </QueryState>
              </>
            ),
          },
          {
            value: 'movements',
            label: 'Movimentações',
            content: (
              <QueryState loading={movements.isLoading} error={movements.error}>
                <Table>
                  <thead>
                    <tr>
                      <Th>Data</Th>
                      <Th>Produto</Th>
                      <Th>Tipo</Th>
                      <Th>Qtd</Th>
                      <Th>Custo</Th>
                      <Th>Motivo</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.data?.items.map((m) => (
                      <tr key={m.id}>
                        <Td>{formatDateTimeBR(m.createdAt)}</Td>
                        <Td>{m.product.name}</Td>
                        <Td>
                          {typeLabel[m.type]} {m.overrideNegative && <Badge tone="red">override</Badge>}
                        </Td>
                        <Td className={m.quantity < 0 ? 'text-red-600' : 'text-emerald-700'}>{m.quantity}</Td>
                        <Td>{formatBRL(m.unitCostCents)}</Td>
                        <Td>{m.reason ?? '—'}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </QueryState>
            ),
          },
        ]}
      />
      <Dialog
        open={Boolean(op)}
        onOpenChange={() => setOp(null)}
        title={op === 'receive' ? 'Entrada de mercadoria' : 'Ajuste de estoque'}
        footer={<Button loading={submit.isPending} disabled={!product || (op === 'adjust' && (form.reason.length < 3 || form.quantity === 0))} onClick={() => submit.mutate()}>Registrar</Button>}
      >
        <div className="space-y-3">
          {product ? (
            <div className="flex items-center justify-between rounded bg-slate-50 p-2 text-sm">
              {product.name}
              <Button size="sm" variant="ghost" onClick={() => setProduct(null)}>
                Trocar
              </Button>
            </div>
          ) : (
            <>
              <Input aria-label="Buscar produto" placeholder="Buscar produto" value={term} onChange={(e) => setTerm(e.target.value)} />
              {products.data?.items
                .filter((p) => p.kind !== 'SERVICE')
                .map((p) => (
                  <button key={p.id} type="button" className="block w-full rounded border p-2 text-left text-sm" onClick={() => { setProduct(p); setForm({ ...form, unitCostCents: p.costCents }); }}>
                    {p.name}
                  </button>
                ))}
            </>
          )}
          <Field label={op === 'adjust' ? 'Quantidade (+ entrada / − saída)' : 'Quantidade'} htmlFor="qty">
            <Input id="qty" type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} />
          </Field>
          {op === 'receive' ? (
            <>
              <Field label="Custo unitário" htmlFor="uc">
                <MoneyInput id="uc" value={form.unitCostCents} onChange={(v) => setForm({ ...form, unitCostCents: v })} />
              </Field>
              <Field label="Referência (NF/pedido)" htmlFor="ref">
                <Input id="ref" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
              </Field>
            </>
          ) : (
            <>
              <Field label="Tipo" htmlFor="atype">
                <Select id="atype" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  <option value="ADJUSTMENT">Ajuste</option>
                  <option value="LOSS">Perda</option>
                  <option value="RETURN">Devolução</option>
                </Select>
              </Field>
              <Field label="Motivo" htmlFor="reason">
                <Input id="reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
              </Field>
              {can('stock:override_negative') && <Checkbox label="Permitir saldo negativo (auditado)" checked={form.overrideNegative} onChange={(v) => setForm({ ...form, overrideNegative: v })} />}
            </>
          )}
        </div>
      </Dialog>
    </div>
  );
}

export function TransfersPage() {
  const { me, branchId, can } = useAuth();
  const q = useApi<Paginated<any>>(['transfers'], '/stock/transfers');
  const [open, setOpen] = useState(false);
  const [dest, setDest] = useState('');
  const [term, setTerm] = useState('');
  const [lines, setLines] = useState<Array<{ productId: string; name: string; quantity: number }>>([]);
  const products = useApi<Paginated<any>>(['tr-products', term], term.length >= 2 ? '/products' : null, { q: term, pageSize: 6 });
  const [receiving, setReceiving] = useState<any | null>(null);
  const [received, setReceived] = useState<Record<string, number>>({});
  const create = useAction((_: void, key) => api('/stock/transfers', { method: 'POST', idempotencyKey: key, body: { sourceBranchId: branchId, destBranchId: dest, lines: lines.map(({ productId, quantity }) => ({ productId, quantity })) } }), {
    success: 'Transferência enviada',
    invalidate: [['transfers']],
    onSuccess: () => {
      setOpen(false);
      setLines([]);
    },
  });
  const receive = useAction(
    (_: void, key) => api(`/stock/transfers/${receiving.id}/receive`, { method: 'POST', idempotencyKey: key, body: { lines: receiving.lines.map((l: any) => ({ lineId: l.id, quantityReceived: received[l.id] ?? l.quantitySent })) } }),
    { success: 'Recebimento confirmado', invalidate: [['transfers']], onSuccess: () => setReceiving(null) },
  );
  const status: Record<string, string> = { IN_TRANSIT: 'Em trânsito', RECEIVED: 'Recebida', RECEIVED_WITH_DIFF: 'Recebida com diferença', CANCELED: 'Cancelada' };
  const branches = me?.current?.branches ?? [];
  return (
    <div>
      <PageHeader title="Transferências entre filiais" actions={can('stock:transfer') && branches.length > 1 && <Button onClick={() => setOpen(true)}>Nova transferência</Button>} />
      <QueryState loading={q.isLoading} error={q.error} empty={q.data?.items.length === 0}>
        <Table>
          <thead>
            <tr>
              <Th>Nº</Th>
              <Th>Origem → destino</Th>
              <Th>Itens</Th>
              <Th>Status</Th>
              <Th>Enviada</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {q.data?.items.map((t) => (
              <tr key={t.id}>
                <Td>{t.number}</Td>
                <Td>
                  {t.sourceBranch.name} → {t.destBranch.name}
                </Td>
                <Td>{t.lines.map((l: any) => `${l.quantitySent}x ${l.product.name}`).join(', ')}</Td>
                <Td>
                  <Badge tone={t.status === 'RECEIVED' ? 'green' : t.status === 'IN_TRANSIT' ? 'yellow' : 'red'}>{status[t.status]}</Badge>
                </Td>
                <Td>{formatDateTimeBR(t.sentAt)}</Td>
                <Td>
                  {t.status === 'IN_TRANSIT' && can('stock:transfer') && branches.some((b) => b.id === t.destBranchId) && (
                    <Button size="sm" onClick={() => { setReceiving(t); setReceived({}); }}>
                      Receber
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </QueryState>
      <Dialog open={open} onOpenChange={setOpen} title="Nova transferência (sai da filial atual)" wide footer={<Button loading={create.isPending} disabled={!dest || !lines.length} onClick={() => create.mutate()}>Enviar</Button>}>
        <div className="space-y-3">
          <Field label="Filial de destino" htmlFor="dest">
            <Select id="dest" value={dest} onChange={(e) => setDest(e.target.value)}>
              <option value="">Selecione</option>
              {branches.filter((b) => b.id !== branchId).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Input aria-label="Buscar produto" placeholder="Adicionar produto" value={term} onChange={(e) => setTerm(e.target.value)} />
          {products.data?.items.filter((p) => p.kind !== 'SERVICE').map((p) => (
            <button key={p.id} type="button" className="block w-full rounded border p-2 text-left text-sm" onClick={() => { setLines([...lines, { productId: p.id, name: p.name, quantity: 1 }]); setTerm(''); }}>
              {p.name}
            </button>
          ))}
          {lines.map((l, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="flex-1">{l.name}</span>
              <Input aria-label="Quantidade" type="number" min={1} className="w-24" value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))} />
            </div>
          ))}
        </div>
      </Dialog>
      <Dialog open={Boolean(receiving)} onOpenChange={() => setReceiving(null)} title="Conferência de recebimento" footer={<Button loading={receive.isPending} onClick={() => receive.mutate()}>Confirmar recebimento</Button>}>
        {receiving?.lines.map((l: any) => (
          <div key={l.id} className="mb-2 flex items-center gap-2 text-sm">
            <span className="flex-1">
              {l.product.name} (enviado {l.quantitySent})
            </span>
            <Input aria-label="Recebido" type="number" min={0} max={l.quantitySent} className="w-24" value={received[l.id] ?? l.quantitySent} onChange={(e) => setReceived({ ...received, [l.id]: Number(e.target.value) })} />
          </div>
        ))}
      </Dialog>
    </div>
  );
}

