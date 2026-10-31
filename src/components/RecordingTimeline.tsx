import { useMemo } from 'react';
import { isCrcValid } from '../lib/record';
import type { SimState } from '../lib/simulation';
import { SOURCE_LABEL, type SourceId } from '../lib/types';
import { Card, cx } from './ui';

const BUCKETS = 60;

export function RecordingTimeline({ sim }: { sim: SimState }) {
  const dur = sim.config.durationSec;
  const size = Math.ceil(dur / BUCKETS);
  const rows = useMemo(() => {
    const stores: [SourceId, typeof sim.primary.records][] = [['PRIMARY', sim.primary.records], ['BACKUP', sim.backup.records], ['REMOTE', sim.remote.records]];
    return stores.map(([id, recs]) => {
      const ok = new Uint8Array(dur), bad = new Uint8Array(dur);
      for (const r of recs) {
        if (r.sequence_id >= dur) continue;
        if (isCrcValid(r)) ok[r.sequence_id] = 1; else if (!ok[r.sequence_id]) bad[r.sequence_id] = 1;
      }
      const cells = Array.from({ length: Math.ceil(dur / size) }, (_, b) => {
        const from = b * size, elapsed = Math.min(size, Math.max(0, sim.tick - from));
        let v = 0, x = 0;
        for (let i = from; i < from + elapsed; i++) { v += ok[i]; x += bad[i] && !ok[i] ? 1 : 0; }
        const state = elapsed === 0 ? 'future' : v === elapsed ? 'full' : v === 0 ? 'none' : 'partial';
        return { state, title: `${id} t=${from}–${from + size - 1}s: ${elapsed === 0 ? 'not yet recorded' : `${v}/${elapsed} valid${x ? `, ${x} failed CRC` : ''}`}` };
      });
      return { id, cells };
    });
  }, [sim.primary.records, sim.backup.records, sim.remote.records, sim.tick, dur, size]);

  const cls = { full: 'bg-ok/80', partial: 'bg-warn/80', none: 'bg-bad/80', future: 'bg-panel2' } as const;
  return (
    <Card title="Flight-data recording timeline">
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-3">
            <div className="w-28 shrink-0 text-xs text-muted sm:w-44">{SOURCE_LABEL[r.id]}</div>
            <div className="flex h-5 flex-1 gap-px" role="img" aria-label={`${SOURCE_LABEL[r.id]} coverage timeline`}>
              {r.cells.map((c, i) => <div key={i} title={c.title} className={cx('flex-1 rounded-[1px]', cls[c.state as keyof typeof cls])} />)}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span><i className="mr-1 inline-block h-2 w-2 bg-ok/80" />Complete</span>
        <span><i className="mr-1 inline-block h-2 w-2 bg-warn/80" />Partial (gaps / CRC failures)</span>
        <span><i className="mr-1 inline-block h-2 w-2 bg-bad/80" />No valid records</span>
        <span><i className="mr-1 inline-block h-2 w-2 bg-panel2" />Not yet recorded</span>
        <span className="ml-auto">Each cell = {size} s. Hover for counts.</span>
      </div>
    </Card>
  );
}
