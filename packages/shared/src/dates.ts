/**
 * Datas: o banco guarda UTC; a renderização usa o fuso da filial
 * (padrão America/Sao_Paulo). Funções sem dependências externas.
 */
export const DEFAULT_TZ = 'America/Sao_Paulo';

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

export function zonedParts(date: Date, tz: string = DEFAULT_TZ): ZonedParts {
  const parts: Record<string, string> = {};
  for (const p of dtf(tz).formatToParts(date)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function offsetMs(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Converte data/hora "de parede" em um fuso para o instante UTC correspondente. */
export function zonedToUtc(year: number, month: number, day: number, hour = 0, minute = 0, second = 0, tz: string = DEFAULT_TZ): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const off1 = offsetMs(new Date(guess), tz);
  let ts = guess - off1;
  const off2 = offsetMs(new Date(ts), tz);
  if (off2 !== off1) ts = guess - off2;
  return new Date(ts);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function startOfZonedDay(date: Date, tz: string = DEFAULT_TZ): Date {
  const p = zonedParts(date, tz);
  return zonedToUtc(p.year, p.month, p.day, 0, 0, 0, tz);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export function formatDateBR(date: Date | string | null | undefined, tz: string = DEFAULT_TZ): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, dateStyle: 'short' }).format(new Date(date));
}

export function formatDateTimeBR(date: Date | string | null | undefined, tz: string = DEFAULT_TZ): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' }).format(new Date(date));
}
