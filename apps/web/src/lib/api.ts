/**
 * Cliente da API /api/v1. Access token somente em memória; refresh por cookie
 * HttpOnly + token CSRF double-submit. Erros no formato {code,message,details,requestId}.
 */
let accessToken: string | null = null;
let onSessionLost: (() => void) | null = null;

export function setAccessToken(t: string | null) {
  accessToken = t;
}
export function getAccessToken() {
  return accessToken;
}
export function setOnSessionLost(cb: () => void) {
  onSessionLost = cb;
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

function cookie(name: string): string | null {
  const c = document.cookie.split('; ').find((x) => x.startsWith(`${name}=`));
  return c ? decodeURIComponent(c.slice(name.length + 1)) : null;
}

let refreshing: Promise<boolean> | null = null;

export function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      const csrf = cookie('oc_csrf');
      if (!csrf) return false;
      try {
        const r = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include', headers: { 'X-CSRF-Token': csrf } });
        if (!r.ok) {
          accessToken = null;
          return false;
        }
        const j = (await r.json()) as { accessToken: string };
        accessToken = j.accessToken;
        return true;
      } catch {
        return false;
      }
    })().finally(() => setTimeout(() => (refreshing = null), 0));
  }
  return refreshing;
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined | string[]>;
  idempotencyKey?: string;
  headers?: Record<string, string>;
}

function buildUrl(path: string, query?: ApiOptions['query']) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, x));
    else qs.set(k, String(v));
  }
  const s = qs.toString();
  return `/api/v1${path}${s ? `?${s}` : ''}`;
}

async function raw(path: string, opts: ApiOptions = {}): Promise<Response> {
  const isForm = opts.body instanceof FormData;
  const doFetch = () =>
    fetch(buildUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      credentials: 'include',
      headers: {
        ...(opts.body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}),
        ...(opts.headers ?? {}),
      },
      body: isForm ? (opts.body as FormData) : opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  let res = await doFetch();
  if (res.status === 401 && !path.startsWith('/auth/')) {
    if (await refreshSession()) res = await doFetch();
    else onSessionLost?.();
  }
  if (!res.ok) {
    let j: { code?: string; message?: string; details?: unknown; requestId?: string } | undefined;
    try {
      j = await res.json();
    } catch {
      /* corpo não-JSON */
    }
    throw new ApiError(j?.code ?? `HTTP_${res.status}`, j?.message ?? 'Falha de comunicação com o servidor', res.status, j?.details, j?.requestId);
  }
  return res;
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const res = await raw(path, opts);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Abre PDF autenticado em nova aba (token nunca em URL). */
export async function openPdf(path: string, query?: ApiOptions['query'], headers?: Record<string, string>) {
  const res = await raw(path, { query, headers });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const newIdemKey = () => crypto.randomUUID();

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'VALIDATION_ERROR' && e.details && typeof e.details === 'object' && 'fieldErrors' in e.details) {
      const fe = (e.details as { fieldErrors: Record<string, string[]> }).fieldErrors;
      const first = Object.entries(fe)[0];
      if (first) return `${e.message}: ${first[0]} — ${first[1]?.[0] ?? ''}`;
    }
    if (e.code === 'PLAN_LIMIT_REACHED') return `${e.message}. Faça upgrade em Assinatura.`;
    return e.message;
  }
  return 'Erro inesperado';
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
