import type { TechnicalStatus } from '@ordemcerta/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { PRIORITY_TONE, QueryState, StatusBadge, useAction, useApi } from '@/components/data';
import { Badge, Button, Checkbox, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { setSoundEnabled, soundEnabled } from '@/lib/realtime';
import { cn, formatDateTimeBR, PRIORITY_LABELS } from '@/lib/utils';

interface QueueItem {
  id: string;
  number: number;
  technicalStatus: TechnicalStatus;
  priority: string;
  receivedAt: string;
  slaDueAt: string | null;
  slaBreached: boolean;
  version: number;
  assignedTechnicianId: string | null;
  customer: { name: string };
  device: { brand: string; model: string };
  branch: { name: string };
}

const COLUMNS: Array<{ title: string; statuses: TechnicalStatus[] }> = [
  { title: 'Na fila', statuses: ['RECEIVED', 'WAITING_DIAGNOSIS', 'REOPENED'] },
  { title: 'Diagnóstico', statuses: ['DIAGNOSING', 'WAITING_QUOTE_APPROVAL'] },
  { title: 'Peças/aprovadas', statuses: ['APPROVED', 'WAITING_PARTS'] },
  { title: 'Em reparo/testes', statuses: ['IN_REPAIR', 'TESTING'] },
];

/** Fila técnica em tempo real (Socket.IO) com alerta sonoro opcional. */
export function TechnicianQueuePage() {
  const { branchId, me, can } = useAuth();
  const [mine, setMine] = useState(false);
  const [sound, setSound] = useState(soundEnabled());
  const q = useApi<QueueItem[]>(['queue', branchId, mine], '/service-orders/queue', { branchId: branchId ?? undefined, mine: mine || undefined }, { refetchInterval: 60_000 });
  const accept = useAction((o: QueueItem) => api(`/service-orders/${o.id}/accept`, { method: 'POST', body: { version: o.version } }), { success: 'OS aceita', invalidate: [['queue']] });
  const myId = me?.user.id;
  return (
    <div>
      <PageHeader
        title="Fila técnica"
        description="Atualização em tempo real; ordenada por prioridade e SLA"
        actions={
          <div className="flex flex-wrap items-center gap-4">
            <Checkbox label="Somente minhas" checked={mine} onChange={setMine} />
            <Checkbox
              label="Alerta sonoro de nova OS"
              checked={sound}
              onChange={(v) => {
                setSound(v);
                setSoundEnabled(v);
              }}
            />
          </div>
        }
      />
      <QueryState loading={q.isLoading} error={q.error}>
        <div className="grid gap-3 lg:grid-cols-4">
          {COLUMNS.map((col) => {
            const items = (q.data ?? []).filter((o) => col.statuses.includes(o.technicalStatus));
            return (
              <section key={col.title} className="rounded-lg bg-slate-100 p-2" aria-label={col.title}>
                <h2 className="mb-2 px-1 text-sm font-semibold text-slate-700">
                  {col.title} <span className="text-slate-500">({items.length})</span>
                </h2>
                <div className="space-y-2">
                  {items.map((o) => (
                    <article key={o.id} className={cn('rounded-md border bg-white p-3 shadow-sm', o.slaBreached ? 'border-red-400' : 'border-slate-200')}>
                      <div className="flex items-center justify-between">
                        <Link to={`/app/technician/orders/${o.id}`} className="font-semibold text-brand-800 underline">
                          OS {o.number}
                        </Link>
                        <Badge tone={PRIORITY_TONE[o.priority]}>{PRIORITY_LABELS[o.priority as keyof typeof PRIORITY_LABELS]}</Badge>
                      </div>
                      <p className="text-sm">
                        {o.device.brand} {o.device.model}
                      </p>
                      <p className="text-xs text-slate-500">{o.customer.name}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        <StatusBadge status={o.technicalStatus} />
                        {o.slaBreached && <Badge tone="red">SLA</Badge>}
                        {o.assignedTechnicianId === myId && <Badge tone="purple">Minha</Badge>}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">Entrada {formatDateTimeBR(o.receivedAt)}</p>
                      {o.technicalStatus === 'RECEIVED' && !o.assignedTechnicianId && can('os:accept') && (
                        <Button size="sm" className="mt-2 w-full" loading={accept.isPending} onClick={() => accept.mutate(o)}>
                          Aceitar
                        </Button>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </QueryState>
    </div>
  );
}
