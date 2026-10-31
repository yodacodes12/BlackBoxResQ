import { AlertTriangle, CheckCircle2, MinusCircle, XCircle, type LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { Health } from '../lib/status';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

const HEALTH: Record<Health, { label: string; cls: string; Icon: LucideIcon }> = {
  online: { label: 'Online', cls: 'text-ok border-ok/40 bg-ok/10', Icon: CheckCircle2 },
  degraded: { label: 'Degraded', cls: 'text-warn border-warn/40 bg-warn/10', Icon: AlertTriangle },
  failed: { label: 'Failed', cls: 'text-bad border-bad/40 bg-bad/10', Icon: XCircle },
  offline: { label: 'Offline', cls: 'text-muted border-line bg-panel2', Icon: MinusCircle },
};

export function HealthBadge({ health, label }: { health: Health; label?: string }) {
  const { label: l, cls, Icon } = HEALTH[health];
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium', cls)}>
      <Icon size={13} aria-hidden /> {label ?? l}
    </span>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded border border-line bg-panel', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Metric({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className={cx('num text-xl font-semibold', tone === 'ok' && 'text-ok', tone === 'warn' && 'text-warn', tone === 'bad' && 'text-bad')}>{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'default' | 'danger'; icon?: LucideIcon };
export function Button({ variant = 'default', icon: Icon, className, children, ...p }: BtnProps) {
  return (
    <button
      {...p}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40',
        variant === 'primary' && 'border-accent bg-accent/15 text-accent enabled:hover:bg-accent/25',
        variant === 'default' && 'border-line bg-panel2 text-slate-200 enabled:hover:border-accent/60',
        variant === 'danger' && 'border-bad/50 bg-bad/10 text-bad enabled:hover:bg-bad/20',
        className,
      )}
    >
      {Icon && <Icon size={15} aria-hidden />}
      {children}
    </button>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold text-white">{title}</h1>
        {subtitle && <p className="max-w-3xl text-sm text-muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded border border-dashed border-line px-4 py-8 text-center">
      <div className="font-medium text-slate-300">{title}</div>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function SimNotice({ children }: { children?: ReactNode }) {
  return (
    <div className="mb-4 rounded border border-warn/30 bg-warn/5 px-3 py-2 text-xs text-warn/90">
      {children ?? 'SIMULATED DATA — all readings, scenarios and statistics are synthetic. Research prototype, not certified aviation equipment.'}
    </div>
  );
}

export function SourceChip({ source }: { source: string | null }) {
  if (!source) return <span className="text-muted">—</span>;
  const c = source === 'PRIMARY' ? 'text-accent' : source === 'BACKUP' ? 'text-violet-300' : 'text-teal-300';
  return <span className={cx('font-brand text-xs', c)}>{source}</span>;
}
