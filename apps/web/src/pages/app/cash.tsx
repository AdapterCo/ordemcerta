import { PAYMENT_METHODS } from '@ordemcerta/shared';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { QueryState, useAction, useApi } from '@/components/data';
import { Alert, Badge, Button, Card, ConfirmDialog, Dialog, Field, Input, MoneyInput, PageHeader, Select, Table, Td, Textarea, Th } from '@/components/ui';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatBRL, formatDateTimeBR, PAYMENT_METHOD_LABELS } from '@/lib/utils';

/* eslint-disable @typescript-eslint/no-explicit-any */

export function CashPage() {
  const { branchId, can } = useAuth();
  const registers = useApi<any[]>(['cash-registers', branchId], '/cash-registers', { branchId: branchId ?? undefined });
  const current = useApi<any[]>(['cash-current'], '/cash-sessions/current');
  const history = useApi<Paginated<any>>(['cash-history', branchId], '/cash-sessions', { branchId: branchId ?? undefined });
  const [openReg, setOpenReg] = useState<string | null>(null);
  const [float, setFloat] = useState(0);
  const [newReg, setNewReg] = useState('');
  const open = useAction((_: void, key) => api('/cash-sessions/open', { method: 'POST', idempotencyKey: key, body: { registerId: openReg, openingFloatCents: float } }), {
    success: 'Caixa aberto',
    invalidate: [['cash-current'], ['cash-registers'], ['cash-history']],
    onSuccess: () => setOpenReg(null),
  });
  const create = useAction((_: void) => api('/cash-registers', { method: 'POST', body: { branchId, name: newReg } }), { success: 'Caixa cadastrado', invalidate: [['cash-registers']] });
  return (
    <div className="space-y-4">
      <PageHeader title="Caixa" />
      {current.data?.length ? (
        <Card title="Sessões abertas">
          <ul className="space-y-2">
            {current.data.map((s) => (
              <li key={s.id} className="flex items-center justify-between">
                <span>
                  {s.register.name} · aberto em {formatDateTimeBR(s.openedAt)}
                </span>
                <Link to={`/app/cash/sessions/${s.id}`}>
                  <Button size="sm">Gerenciar</Button>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Alert tone="blue">Nenhuma sessão aberta para você.</Alert>
      )}
      <Card title="Caixas da filial">
        <QueryState loading={registers.isLoading} error={registers.error}>
          <ul className="space-y-2">
            {registers.data?.map((r) => (
              <li key={r.id} className="flex items-center justify-between">
                <span>
                  {r.name} {!r.active && <Badge>inativo</Badge>} {r.sessions.length > 0 && <Badge tone="green">em uso</Badge>}
                </span>
                {r.active && r.sessions.length === 0 && (
                  <Button size="sm" onClick={() => setOpenReg(r.id)}>
                    Abrir
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </QueryState>
        {can('cash:register_manage') && (
          <div className="mt-3 flex gap-2">
            <Input aria-label="Nome do caixa" placeholder="Novo caixa (limite do plano)" value={newReg} onChange={(e) => setNewReg(e.target.value)} className="max-w-xs" />
            <Button variant="secondary" disabled={!newReg} loading={create.isPending} onClick={() => create.mutate()}>
              Cadastrar
            </Button>
          </div>
        )}
      </Card>
      <Card title="Histórico">
        <Table>
          <thead>
            <tr>
              <Th>Caixa</Th>
              <Th>Abertura</Th>
              <Th>Fechamento</Th>
              <Th>Diferença</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {history.data?.items.map((s) => (
              <tr key={s.id}>
                <Td>{s.register.name}</Td>
                <Td>{formatDateTimeBR(s.openedAt)}</Td>
                <Td>{s.closedAt ? formatDateTimeBR(s.closedAt) : <Badge tone="green">aberto</Badge>}</Td>
                <Td className={s.differenceCents ? 'font-semibold text-red-600' : ''}>{s.differenceCents === null ? '—' : formatBRL(s.differenceCents)}</Td>
                <Td>
                  <Link className="text-brand-700 underline-offset-2 hover:underline" to={`/app/cash/sessions/${s.id}`}>
                    Detalhes
                  </Link>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <Dialog open={Boolean(openReg)} onOpenChange={() => setOpenReg(null)} title="Abrir caixa" footer={<Button loading={open.isPending} onClick={() => open.mutate()}>Abrir</Button>}>
        <Field label="Fundo de troco" htmlFor="float">
          <MoneyInput id="float" value={float} onChange={setFloat} autoFocus />
        </Field>
      </Dialog>
    </div>
  );
}

export function CashSessionPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const q = useApi<any>(['cash-session', id], `/cash-sessions/${id}/summary`);
  const [mov, setMov] = useState<null | 'supply' | 'withdraw'>(null);
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState('');
  const [closing, setClosing] = useState(false);
  const [declared, setDeclared] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState('');
  const [result, setResult] = useState<any | null>(null);
  const move = useAction((_: void, key) => api(`/cash-sessions/${id}/${mov}`, { method: 'POST', idempotencyKey: key, body: { amountCents: amount, reason } }), {
    success: 'Movimento registrado',
    invalidate: [['cash-session', id!]],
    onSuccess: () => {
      setMov(null);
      setAmount(0);
      setReason('');
    },
  });
  const close = useAction((_: void, key) => api(`/cash-sessions/${id}/close`, { method: 'POST', idempotencyKey: key, body: { declared, notes: notes || null } }), {
    success: 'Caixa fechado',
    invalidate: [['cash-session', id!], ['cash-current']],
    onSuccess: (r) => {
      setClosing(false);
      setResult(r);
    },
  });
  const typeLabel: Record<string, string> = { OPENING: 'Abertura', PAYMENT_IN: 'Recebimento', SUPPLY: 'Suprimento', WITHDRAWAL: 'Sangria', REFUND_OUT: 'Estorno', CHANGE_OUT: 'Troco' };
  return (
    <QueryState loading={q.isLoading} error={q.error}>
      {q.data && (
        <div className="space-y-4">
          <PageHeader
            title={`Caixa ${q.data.session.register.name}`}
            description={`Aberto em ${formatDateTimeBR(q.data.session.openedAt)}`}
            actions={
              q.data.session.status === 'OPEN' && (
                <>
                  <Button variant="secondary" onClick={() => setMov('supply')}>
                    Suprimento
                  </Button>
                  <Button variant="secondary" onClick={() => setMov('withdraw')}>
                    Sangria
                  </Button>
                  {can('cash:close') && (
                    <Button
                      onClick={() => {
                        setDeclared({});
                        setClosing(true);
                      }}
                    >
                      Fechar caixa
                    </Button>
                  )}
                </>
              )
            }
          />
          {result && (
            <Alert tone={result.differenceCents === 0 ? 'green' : 'yellow'} title="Fechamento registrado">
              Diferença total: {formatBRL(result.differenceCents)} (lançada como ajuste compensatório)
            </Alert>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            {PAYMENT_METHODS.filter((m) => q.data.expected[m] || q.data.received[m]).map((m) => (
              <Card key={m} title={PAYMENT_METHOD_LABELS[m]}>
                <p className="text-2xl font-semibold tabular-nums">{formatBRL(q.data.expected[m])}</p>
                <p className="text-xs text-slate-500">esperado em caixa</p>
              </Card>
            ))}
          </div>
          <p className="text-sm text-slate-600">
            Suprimentos {formatBRL(q.data.supplies)} · Sangrias {formatBRL(q.data.withdrawals)} (sangria não é despesa)
          </p>
          <Table>
            <thead>
              <tr>
                <Th>Hora</Th>
                <Th>Tipo</Th>
                <Th>Meio</Th>
                <Th>Valor</Th>
                <Th>Motivo</Th>
              </tr>
            </thead>
            <tbody>
              {q.data.movements.map((m: any) => (
                <tr key={m.id}>
                  <Td>{formatDateTimeBR(m.createdAt)}</Td>
                  <Td>{typeLabel[m.type]}</Td>
                  <Td>{PAYMENT_METHOD_LABELS[m.method as keyof typeof PAYMENT_METHOD_LABELS]}</Td>
                  <Td className={['WITHDRAWAL', 'REFUND_OUT', 'CHANGE_OUT'].includes(m.type) ? 'text-red-600' : ''}>{formatBRL(m.amountCents)}</Td>
                  <Td>{m.reason ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <ConfirmDialog open={Boolean(mov)} onOpenChange={() => setMov(null)} title={mov === 'supply' ? 'Suprimento' : 'Sangria'} loading={move.isPending} onConfirm={() => move.mutate()}>
            <div className="space-y-2">
              <MoneyInput value={amount} onChange={setAmount} autoFocus />
              <Input aria-label="Motivo" placeholder="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          </ConfirmDialog>
          <ConfirmDialog open={closing} onOpenChange={setClosing} title="Fechamento — informe os valores conferidos" loading={close.isPending} onConfirm={() => close.mutate()}>
            <div className="space-y-2">
              {PAYMENT_METHODS.map((m) => (
                <Field key={m} label={PAYMENT_METHOD_LABELS[m]} htmlFor={`d-${m}`}>
                  <MoneyInput id={`d-${m}`} value={declared[m] ?? 0} onChange={(v) => setDeclared({ ...declared, [m]: v })} />
                </Field>
              ))}
              <Textarea aria-label="Observações" placeholder="Observações" value={notes} onChange={(e) => setNotes(e.target.value)} />
              <p className="text-xs text-slate-500">Conferência cega: os valores esperados são comparados após o envio.</p>
            </div>
          </ConfirmDialog>
          {q.data.session.status === 'CLOSED' && (
            <Card title="Conferência">
              <Table>
                <thead>
                  <tr>
                    <Th>Meio</Th>
                    <Th>Esperado</Th>
                    <Th>Declarado</Th>
                  </tr>
                </thead>
                <tbody>
                  {PAYMENT_METHODS.map((m) => (
                    <tr key={m}>
                      <Td>{PAYMENT_METHOD_LABELS[m]}</Td>
                      <Td>{formatBRL(q.data.session.expectedTotalsJson?.[m] ?? 0)}</Td>
                      <Td>{formatBRL(q.data.session.declaredTotalsJson?.[m] ?? 0)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <p className="mt-2 text-sm">Diferença total: {formatBRL(q.data.session.differenceCents ?? 0)}</p>
            </Card>
          )}
          <Select className="hidden" aria-hidden />
        </div>
      )}
    </QueryState>
  );
}
