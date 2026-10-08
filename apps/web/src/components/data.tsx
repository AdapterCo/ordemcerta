import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { DeliveryStatus, TechnicalStatus } from '@ordemcerta/shared';
import { useRef, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { api, errorMessage, newIdemKey, type ApiOptions } from '@/lib/api';
import { DELIVERY_STATUS_LABELS, TECHNICAL_STATUS_LABELS } from '@/lib/utils';
import { Alert, Badge, Button, EmptyState, Spinner, type BadgeTone } from './ui';

export function useApi<T>(key: QueryKey, path: string | null, query?: ApiOptions['query'], opts: { refetchInterval?: number } = {}) {
  return useQuery({
    queryKey: [...key, query ?? {}],
    queryFn: () => api<T>(path!, { query }),
    enabled: Boolean(path),
    refetchInterval: opts.refetchInterval,
  });
}

/**
 * Mutação com proteção contra dupla submissão e Idempotency-Key estável
 * entre tentativas (reutilizada até o sucesso).
 */
export function useAction<TVars, TRes = unknown>(
  fn: (vars: TVars, idempotencyKey: string) => Promise<TRes>,
  opts: { success?: string; invalidate?: QueryKey[]; onSuccess?: (r: TRes) => void } = {},
) {
  const qc = useQueryClient();
  const key = useRef<string>(newIdemKey());
  return useMutation({
    mutationFn: (vars: TVars) => fn(vars, key.current),
    onSuccess: (r) => {
      key.current = newIdemKey();
      if (opts.success) toast.success(opts.success);
      for (const k of opts.invalidate ?? []) void qc.invalidateQueries({ queryKey: k });
      opts.onSuccess?.(r);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function QueryState({ loading, error, empty, emptyTitle = 'Nada encontrado', children, retry }: {
  loading: boolean;
  error: unknown;
  empty?: boolean;
  emptyTitle?: string;
  children: ReactNode;
  retry?: () => void;
}) {
  if (loading) return <Spinner />;
  if (error)
    return (
      <Alert tone="red" title="Não foi possível carregar">
        <p>{errorMessage(error)}</p>
        {retry && (
          <Button size="sm" variant="secondary" className="mt-2" onClick={retry}>
            Tentar novamente
          </Button>
        )}
      </Alert>
    );
  if (empty) return <EmptyState title={emptyTitle} />;
  return <>{children}</>;
}

/** Filtros persistidos na URL. */
export function useUrlFilters<T extends Record<string, string>>(defaults: T) {
  const [params, setParams] = useSearchParams();
  const values = Object.fromEntries(Object.keys(defaults).map((k) => [k, params.get(k) ?? defaults[k]!])) as T;
  const set = (patch: Partial<T>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '' || v === defaults[k]) next.delete(k);
      else next.set(k, String(v));
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };
  return [values, set] as const;
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="mt-3 flex items-center justify-between text-sm text-slate-600" aria-label="Paginação">
      <span>
        {total} registro(s) — página {page} de {pages}
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Anterior
        </Button>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Próxima
        </Button>
      </div>
    </nav>
  );
}

const STATUS_TONE: Record<TechnicalStatus, BadgeTone> = {
  RECEIVED: 'gray',
  WAITING_DIAGNOSIS: 'gray',
  DIAGNOSING: 'blue',
  WAITING_QUOTE_APPROVAL: 'yellow',
  APPROVED: 'purple',
  WAITING_PARTS: 'yellow',
  IN_REPAIR: 'blue',
  TESTING: 'blue',
  READY: 'green',
  REJECTED: 'red',
  CANCELED: 'red',
  RETURNED_UNREPAIRED: 'gray',
  REOPENED: 'yellow',
};

export function StatusBadge({ status }: { status: TechnicalStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{TECHNICAL_STATUS_LABELS[status]}</Badge>;
}

export function DeliveryBadge({ status }: { status: DeliveryStatus }) {
  return <Badge tone={status === 'DELIVERED' ? 'green' : status === 'READY_FOR_PICKUP' ? 'yellow' : 'gray'}>{DELIVERY_STATUS_LABELS[status]}</Badge>;
}

export const PRIORITY_TONE: Record<string, BadgeTone> = { LOW: 'gray', NORMAL: 'blue', HIGH: 'yellow', URGENT: 'red' };
