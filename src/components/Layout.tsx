import { Activity, FileText, FlaskConical, Menu, Plane, Siren, X, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { fmtTime, systemHealth } from '../lib/status';
import { useSim } from '../state/SimContext';
import { cx, HealthBadge } from './ui';

export const NAV: { key: string; label: string; Icon: LucideIcon }[] = [
  { key: 'overview', label: 'Overview', Icon: Activity },
  { key: 'location', label: 'Recorder Location', Icon: Plane },
  { key: 'recovery', label: 'Recovery Lab', Icon: FlaskConical },
  { key: 'failure', label: 'Failure Simulation', Icon: Siren },
  { key: 'reports', label: 'Investigation Reports', Icon: FileText },
];

export function Layout({ route, children }: { route: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { sim } = useSim();
  const sys = systemHealth(sim);
  const statusText = { idle: 'Idle', running: 'Running', paused: 'Paused', complete: 'Complete' }[sim.status];

  const nav = (
    <nav aria-label="Primary" className="flex flex-col gap-1 p-3">
      {NAV.map(({ key, label, Icon }) => (
        <a
          key={key}
          href={`#/${key}`}
          onClick={() => setOpen(false)}
          aria-current={route === key ? 'page' : undefined}
          className={cx(
            'flex items-center gap-2.5 rounded px-3 py-2 text-sm transition-colors',
            route === key ? 'bg-accent/15 text-accent' : 'text-slate-300 hover:bg-panel2',
          )}
        >
          <Icon size={16} aria-hidden /> {label}
        </a>
      ))}
    </nav>
  );

  return (
    <div className="flex h-full flex-col print:block print:h-auto">
      <header className="flex flex-wrap items-center print:hidden gap-x-5 gap-y-2 border-b border-line bg-panel px-4 py-2.5">
        <button className="rounded p-1 text-slate-300 hover:bg-panel2 lg:hidden" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen(!open)}>
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
        <div className="font-brand text-lg font-bold tracking-tight text-white">
          BlackBox<span className="text-accent">ResQ</span>
        </div>
        <div className="num text-sm text-slate-300">
          <span className="text-muted">Flight </span>{sim.config.flightId}
        </div>
        <span className="rounded border border-warn/40 bg-warn/10 px-2 py-0.5 text-xs font-semibold tracking-wide text-warn">SIMULATION MODE</span>
        <div className="num text-sm text-slate-300">
          <span className="text-muted">T+ </span>{fmtTime(sim.tick)} <span className="text-muted">/ {fmtTime(sim.config.durationSec)} · {statusText}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted">System health</span>
          <HealthBadge health={sys.health} label={sys.label} />
        </div>
      </header>
      <div className="flex min-h-0 flex-1 print:block">
        <aside className="hidden print:hidden w-56 shrink-0 flex-col justify-between border-r border-line bg-panel lg:flex">
          {nav}
          <p className="p-4 text-[11px] leading-snug text-muted">Research prototype. Not certified aviation equipment. All data is synthetic.</p>
        </aside>
        {open && (
          <div className="absolute inset-x-0 top-[52px] z-20 border-b border-line bg-panel shadow-lg lg:hidden">{nav}</div>
        )}
        <main className="min-w-0 flex-1 overflow-y-auto p-4 lg:p-6 print:overflow-visible print:p-0">{children}</main>
      </div>
    </div>
  );
}
