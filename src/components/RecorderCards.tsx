import { Database, HardDrive, Radio, ShieldCheck, type LucideIcon } from 'lucide-react';
import { fmtClock, integrityView, recorderViews, type RecorderView } from '../lib/status';
import { SOURCE_LABEL } from '../lib/types';
import { useSim } from '../state/SimContext';
import { Card, HealthBadge } from './ui';

const ICON: Record<string, LucideIcon> = { PRIMARY: HardDrive, BACKUP: Database, REMOTE: Radio };

function Row({ k, v }: { k: string; v: string | number }) {
  return <div className="flex justify-between gap-2 text-xs"><dt className="text-muted">{k}</dt><dd className="num text-slate-200">{v}</dd></div>;
}

function RecorderCard({ v }: { v: RecorderView }) {
  const Icon = ICON[v.id];
  return (
    <Card>
      <div className="mb-2 flex min-h-11 items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-white"><Icon size={16} className="text-accent" aria-hidden />{SOURCE_LABEL[v.id]}</div>
        <HealthBadge health={v.health} />
      </div>
      <p className="mb-3 min-h-8 text-xs text-muted">{v.detail}</p>
      <dl className="space-y-1">
        <Row k="Last valid record" v={fmtClock(v.lastValidTimestamp)} />
        <Row k="Valid records" v={v.valid} />
        <Row k="Invalid (CRC failed)" v={v.invalid} />
        <Row k={v.id === 'REMOTE' ? 'Missing (not in transit)' : 'Missing'} v={v.missing} />
        {v.duplicates > 0 && <Row k="Duplicates" v={v.duplicates} />}
        {v.extra?.map((e) => <Row key={e.label} k={e.label} v={e.value} />)}
      </dl>
    </Card>
  );
}

export function RecorderCards() {
  const { sim, live } = useSim();
  const views = recorderViews(sim);
  const ig = integrityView(live, sim.status);
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {views.map((v) => <RecorderCard key={v.id} v={v} />)}
      <Card>
        <div className="mb-2 flex min-h-11 items-start justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium text-white"><ShieldCheck size={16} className="text-accent" aria-hidden />Data integrity</div>
          <HealthBadge health={ig.health} label={{ online: 'Verified', degraded: 'Warnings', failed: 'Faults', offline: 'No data' }[ig.health]} />
        </div>
        <p className="mb-3 min-h-8 text-xs text-muted">{ig.detail}</p>
        <dl className="space-y-1">
          <Row k="Validated (merged)" v={live.counts.validated} />
          <Row k="Conflicting copies" v={live.counts.inconsistent} />
          <Row k="Corrupted (no good copy)" v={live.counts.corrupted} />
          <Row k="Missing (no copy)" v={live.counts.missing} />
          <Row k="Malformed rejected" v={live.malformedTotal} />
        </dl>
      </Card>
    </div>
  );
}
