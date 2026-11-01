import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { useState } from 'react';
import { fmtTime } from '../lib/status';
import type { SimEvent } from '../lib/simulation';
import { Card, EmptyState, cx } from './ui';

const ICON = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: XCircle };
const TONE = { info: 'text-accent', success: 'text-ok', warning: 'text-warn', error: 'text-bad' };

export function ActivityFeed({ events, limit = 14, scroll = false }: { events: SimEvent[]; limit?: number; scroll?: boolean }) {
  const [hideAcks, setHideAcks] = useState(false);
  const list = events.filter((e) => !(hideAcks && e.kind === 'ack'));
  const shown = (scroll ? list : list.slice(-limit)).slice().reverse();
  return (
    <Card
      title="Activity feed / audit trail"
      actions={<label className="flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" checked={hideAcks} onChange={(e) => setHideAcks(e.target.checked)} /> Hide routine acks</label>}
    >
      {shown.length === 0 ? <EmptyState title="No events yet" /> : (
        <ol className={cx('space-y-1.5', scroll && 'max-h-96 overflow-y-auto pr-1')}>
          {shown.map((e) => {
            const I = ICON[e.severity];
            return (
              <li key={e.id} className="flex items-start gap-2 text-sm">
                <I size={14} className={cx('mt-0.5 shrink-0', TONE[e.severity])} aria-hidden />
                <span className="num w-16 shrink-0 text-xs text-muted">T+{fmtTime(e.tick).slice(3)}</span>
                <span className="text-slate-300">{e.message}</span>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
