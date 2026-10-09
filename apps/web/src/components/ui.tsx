import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';
import { forwardRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ Button */

const variants = {
  primary:
    'bg-brand-700 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.15),0_1px_2px_rgb(16_48_47/0.25)] hover:bg-brand-800 active:translate-y-px disabled:bg-brand-700/45 disabled:shadow-none',
  secondary: 'bg-white text-ink-800 border border-line shadow-card hover:border-ink-600/30 hover:bg-paper active:translate-y-px disabled:opacity-50',
  danger: 'bg-red-600 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.15)] hover:bg-red-700 active:translate-y-px disabled:bg-red-600/45',
  ghost: 'text-ink-700 hover:bg-ink-900/[0.06] disabled:opacity-50',
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant = 'primary', size = 'md', loading, disabled, children, ...props }, ref) => (
  <button
    ref={ref}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    className={cn(
      'inline-flex select-none items-center justify-center gap-2 rounded-lg font-semibold transition-all duration-150 disabled:cursor-not-allowed',
      size === 'sm' ? 'h-8 px-3 text-[13px]' : size === 'lg' ? 'h-12 px-6 text-[15px]' : 'h-10 px-4 text-sm',
      variants[variant],
      className,
    )}
    {...props}
  >
    {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
    {children}
  </button>
));
Button.displayName = 'Button';

/* ------------------------------------------------------------------ Inputs */

const fieldBase =
  'w-full rounded-lg border border-line bg-white px-3 text-sm text-ink-900 shadow-[inset_0_1px_1px_rgb(16_48_47/0.04)] transition-colors placeholder:text-ink-600/45 hover:border-ink-600/30 focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-500/15 disabled:bg-paper-2 disabled:text-ink-600/60 aria-[invalid=true]:border-red-500';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn(fieldBase, 'h-10', className)} {...p} />
));
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn(fieldBase, 'min-h-20 py-2.5 leading-relaxed', className)} {...p} />
));
Textarea.displayName = 'Textarea';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...p }, ref) => (
  <select ref={ref} className={cn(fieldBase, 'h-10 cursor-pointer pr-8', className)} {...p}>
    {children}
  </select>
));
Select.displayName = 'Select';

export function Field({ label, error, hint, children, htmlFor, className }: { label: string; error?: string; hint?: string; children: ReactNode; htmlFor?: string; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-[13px] font-semibold text-ink-800">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs leading-snug text-ink-600/70">{hint}</p>}
      {error && (
        <p role="alert" className="text-xs font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

/** Entrada monetária em reais; valor em centavos inteiros. */
export function MoneyInput({ value, onChange, id, disabled, autoFocus }: { value: number; onChange: (cents: number) => void; id?: string; disabled?: boolean; autoFocus?: boolean }) {
  const [text, setText] = useState(() => (value / 100).toFixed(2).replace('.', ','));
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-ink-600/60">R$</span>
      <Input
        id={id}
        inputMode="decimal"
        autoFocus={autoFocus}
        disabled={disabled}
        className="num pl-9 text-right"
        value={text}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '');
          const cents = Number(digits || '0');
          setText((cents / 100).toFixed(2).replace('.', ','));
          onChange(cents);
        }}
      />
    </div>
  );
}

export function Checkbox({ label, checked, onChange, id }: { label: string; checked: boolean; onChange: (v: boolean) => void; id?: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm text-ink-800" htmlFor={id}>
      <input id={id} type="checkbox" className="h-4 w-4 cursor-pointer rounded border-line accent-brand-700" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/* ------------------------------------------------------------- Containers */

export function Card({ className, children, title, actions }: { className?: string; children: ReactNode; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cn('rounded-2xl border border-line bg-white shadow-card', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line/70 px-5 py-3.5">
          {title && <h2 className="font-display text-[15px] font-semibold text-ink-900">{title}</h2>}
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: string; actions?: ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-700">{eyebrow}</p>}
        <h1 className="font-display text-[28px] font-bold leading-tight text-ink-950 sm:text-[32px]">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-600/80">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const badgeTones = {
  gray: 'bg-ink-900/[0.06] text-ink-700 [--dot:var(--color-slate-400)]',
  green: 'bg-emerald-500/12 text-emerald-800 [--dot:var(--color-emerald-500)]',
  yellow: 'bg-amber-400/18 text-amber-900 [--dot:var(--color-amber-500)]',
  red: 'bg-red-500/12 text-red-800 [--dot:var(--color-red-500)]',
  blue: 'bg-sky-500/12 text-sky-800 [--dot:var(--color-sky-500)]',
  purple: 'bg-violet-500/12 text-violet-800 [--dot:var(--color-violet-500)]',
} as const;
export type BadgeTone = keyof typeof badgeTones;

/** Selo de status com ponto colorido (leitura rápida na bancada). */
export function Badge({ tone = 'gray', children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', badgeTones[tone], className)}>
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--dot)]" />
      {children}
    </span>
  );
}

const alertTones = {
  yellow: { box: 'border-amber-300/70 bg-amber-50 text-amber-950', icon: AlertTriangle, iconCls: 'text-amber-600' },
  red: { box: 'border-red-300/70 bg-red-50 text-red-950', icon: XCircle, iconCls: 'text-red-600' },
  blue: { box: 'border-sky-300/70 bg-sky-50 text-sky-950', icon: Info, iconCls: 'text-sky-600' },
  green: { box: 'border-emerald-300/70 bg-emerald-50 text-emerald-950', icon: CheckCircle2, iconCls: 'text-emerald-600' },
};

export function Alert({ tone = 'yellow', title, children }: { tone?: 'yellow' | 'red' | 'blue' | 'green'; title?: string; children?: ReactNode }) {
  const t = alertTones[tone];
  const Icon = t.icon;
  return (
    <div role="status" className={cn('flex gap-3 rounded-xl border px-4 py-3 text-sm leading-relaxed', t.box)}>
      <Icon className={cn('mt-0.5 h-[18px] w-[18px] shrink-0', t.iconCls)} aria-hidden />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children}
      </div>
    </div>
  );
}

export function Spinner({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2.5 p-6 text-sm text-ink-600/70" role="status">
      <Loader2 className="h-4 w-4 animate-spin text-brand-600" aria-hidden /> {label}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-ink-900/[0.07]', className)} />;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-white/60 px-6 py-12 text-center">
      <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-brand-700">
        <Info className="h-5 w-5" aria-hidden />
      </div>
      <p className="font-display font-semibold text-ink-900">{title}</p>
      {children && <div className="max-w-md text-sm text-ink-600/80">{children}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ Table */

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-white">
      <table className={cn('w-full text-left text-sm [&_tbody_tr:last-child_td]:border-b-0 [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-brand-50/40', className)}>
        {children}
      </table>
    </div>
  );
}
export const Th = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <th scope="col" className={cn('whitespace-nowrap border-b border-line bg-paper/70 px-3.5 py-2.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-600/80', className)}>
    {children}
  </th>
);
export const Td = ({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) => (
  <td colSpan={colSpan} className={cn('border-b border-line/60 px-3.5 py-3 align-middle text-ink-800', className)}>
    {children}
  </td>
);

/* ----------------------------------------------------------------- Dialog */

export function Dialog({ open, onOpenChange, title, description, children, footer, wide }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-ink-950/45 backdrop-blur-[2px] data-[state=open]:animate-fade" />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-line bg-white shadow-[0_30px_80px_-20px_rgb(6_26_25/0.45)] data-[state=open]:animate-pop',
            wide ? 'max-w-3xl' : 'max-w-lg',
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line/70 px-6 py-4">
            <div>
              <DialogPrimitive.Title className="font-display text-lg font-bold text-ink-950">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-0.5 text-sm text-ink-600/80">{description}</DialogPrimitive.Description>
              ) : (
                <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close className="rounded-lg p-1.5 text-ink-600/70 transition-colors hover:bg-ink-900/[0.06] hover:text-ink-900" aria-label="Fechar">
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>
          <div className="px-6 py-5">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line/70 bg-paper/60 px-6 py-3.5">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Confirmação para operações destrutivas/irreversíveis. */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = 'Confirmar', danger, loading, onConfirm, children }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Voltar
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}

/* ------------------------------------------------------------------- Tabs */

export function Tabs({ tabs, value, onValueChange }: { tabs: Array<{ value: string; label: string; content: ReactNode }>; value?: string; onValueChange?: (v: string) => void }) {
  return (
    <TabsPrimitive.Root value={value} defaultValue={tabs[0]?.value} onValueChange={onValueChange}>
      <TabsPrimitive.List className="mb-5 flex gap-1 overflow-x-auto rounded-xl border border-line bg-paper-2/70 p-1" aria-label="Seções">
        {tabs.map((t) => (
          <TabsPrimitive.Trigger
            key={t.value}
            value={t.value}
            className="whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-semibold text-ink-600/80 transition-all hover:text-ink-900 data-[state=active]:bg-white data-[state=active]:text-brand-800 data-[state=active]:shadow-card"
          >
            {t.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {tabs.map((t) => (
        <TabsPrimitive.Content key={t.value} value={t.value} className="data-[state=active]:animate-enter">
          {t.content}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}

const statTones = {
  red: { value: 'text-red-600', bar: 'bg-red-500' },
  green: { value: 'text-emerald-700', bar: 'bg-emerald-500' },
  yellow: { value: 'text-amber-600', bar: 'bg-signal-500' },
};

/** Indicador numérico: rótulo técnico, número grande em monoespaçada, faixa de cor quando há sinal. */
export function Stat({ label, value, tone, hint, icon }: { label: string; value: ReactNode; tone?: 'red' | 'green' | 'yellow'; hint?: string; icon?: ReactNode }) {
  const t = tone ? statTones[tone] : null;
  // valores longos (ex.: R$ 18.450,00) reduzem a fonte para nunca cortar
  const long = typeof value === 'string' && value.length > 9;
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-line bg-white p-4 shadow-card transition-shadow hover:shadow-lift">
      {t && <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1', t.bar)} />}
      <div className="flex items-start justify-between gap-2">
        <p className="font-mono text-[10.5px] font-semibold uppercase leading-tight tracking-[0.12em] text-ink-600/75">{label}</p>
        {icon && <span className="text-ink-600/40 transition-colors group-hover:text-brand-600">{icon}</span>}
      </div>
      <p className={cn('num mt-2 truncate font-semibold leading-none text-ink-950', long ? 'text-[21px]' : 'text-[26px]', t?.value)} title={typeof value === 'string' ? value : undefined}>
        {value}
      </p>
      {hint && <p className="mt-2 text-xs text-ink-600/70">{hint}</p>}
    </div>
  );
}
