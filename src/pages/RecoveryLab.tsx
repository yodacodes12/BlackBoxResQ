import { Download, Save, ScanSearch } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { RecoverySummary } from '../components/RecoverySummary';
import { Button, Card, EmptyState, HealthBadge, PageHeader, SimNotice, SourceChip, cx } from '../components/ui';
import { downloadText, reconstructedCsv } from '../lib/csv';
import type { RecStatus } from '../lib/recovery';
import type { RecoveryTest } from '../lib/reports';
import { SCENARIOS, assessScenario, runScenario, scenarioById } from '../lib/scenarios';
import { LIVE_ASSUMPTIONS, buildTest, sourcesOf } from '../lib/simulation';
import { fmtClock } from '../lib/status';
import { SOURCE_LABEL, type SourceId } from '../lib/types';
import { useSim } from '../state/SimContext';

const STATUS_STYLE: Record<RecStatus, { label: string; cls: string }> = {
  validated: { label: 'Recovered & validated', cls: 'text-ok' },
  inconsistent: { label: 'Recovered, inconsistent', cls: 'text-warn' },
  missing: { label: 'Missing', cls: 'text-bad' },
  corrupted: { label: 'Corrupted', cls: 'text-bad' },
};
const PAGE = 50;

export function RecoveryLab() {
  const { sim, layout, dispatch, labScenarioId, setLabScenarioId } = useSim();
  const [include, setInclude] = useState<Record<SourceId, boolean>>({ PRIMARY: true, BACKUP: true, REMOTE: true });
  const [test, setTest] = useState<Omit<RecoveryTest, 'id'> | null>(null);
  const result = test?.result ?? null;
  const [saved, setSaved] = useState(false);
  const [filter, setFilter] = useState<RecStatus | 'all'>('all');
  const [page, setPage] = useState(0);

  const scenario = scenarioById(labScenarioId);
  const subject = useMemo(() => (scenario ? runScenario(scenario, layout) : sim), [scenario, layout, sim]);
  const sources = sourcesOf(subject);
  const av = scenario ? assessScenario(scenario, layout) : null;

  // Changing scenario/layout invalidates a previous result.
  useEffect(() => { setTest(null); setSaved(false); setPage(0); }, [labScenarioId, layout]);

  const chosen = sources.filter((s) => s.media !== 'destroyed' && include[s.id]).map((s) => s.id);
  const run = () => {
    const t = buildTest(subject, scenario?.id ?? 'live', scenario?.name ?? 'Live Failure Lab session', scenario ? [...scenario.assumptions, ...Object.entries(av!).map(([k, v]) => `${k}: ${v.reason}`)] : LIVE_ASSUMPTIONS, chosen);
    setTest(t);
    setSaved(false);
    setPage(0);
  };
  const save = () => {
    if (!test) return;
    dispatch({ type: 'ADD_TEST', test });
    setSaved(true);
  };

  const rows = result ? result.rows.filter((r) => filter === 'all' || r.status === filter) : [];
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));

  return (
    <div className="space-y-4">
      <PageHeader title="Recovery lab" subtitle="Merge surviving datasets by sequence number, verify CRC, detect gaps, duplicates and conflicts. Missing data is never invented." />
      <SimNotice />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="1 · Event">
          <select className="w-full rounded border border-line bg-panel2 px-2 py-1.5 text-sm" value={labScenarioId} onChange={(e) => setLabScenarioId(e.target.value)} aria-label="Accident or failure event">
            <option value="live">Live Failure Lab session (current state)</option>
            {SCENARIOS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <p className="mt-2 text-xs text-muted">{scenario ? scenario.description : `Uses the shared simulation as it is now: ${subject.tick} records generated, status ${subject.status}.`}</p>
          {scenario && <p className="mt-2 text-xs text-muted">Scenario is replayed deterministically ({scenario.timeline.length} scripted event(s)) with recorder layout P={layout.primary}, B={layout.backup}.</p>}
        </Card>
        <Card title="2 · Available datasets" className="lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-3">
            {sources.map((s) => {
              const gone = s.media === 'destroyed';
              return (
                <label key={s.id} className={cx('block rounded border border-line p-3 text-sm', gone ? 'opacity-60' : 'cursor-pointer hover:border-accent/60')}>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" disabled={gone} checked={!gone && include[s.id]} onChange={(e) => setInclude({ ...include, [s.id]: e.target.checked })} />
                    <span className="font-medium text-white">{SOURCE_LABEL[s.id]}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between"><span className="num text-xs text-muted">{s.records.length} stored</span><HealthBadge health={gone ? 'failed' : s.media === 'degraded' ? 'degraded' : 'online'} label={gone ? 'Unrecoverable' : s.media === 'degraded' ? 'Degraded' : 'Readable'} /></div>
                  {av && <div className="mt-1 text-[11px] text-muted">{av[s.id].reason}</div>}
                </label>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" icon={ScanSearch} onClick={run} disabled={subject.tick === 0}>Run recovery</Button>
            <Button icon={Download} disabled={!result} onClick={() => result && downloadText(`${result.flightId}-${scenario?.id ?? 'live'}-reconstructed.csv`, reconstructedCsv(result.rows))}>Export reconstructed CSV</Button>
            <Button icon={Save} disabled={!result || saved} onClick={save}>{saved ? 'Saved to reports' : 'Save to reports'}</Button>
          </div>
          {subject.tick === 0 && <p className="mt-2 text-xs text-warn">No records exist in the live session yet — start the simulation first.</p>}
        </Card>
      </div>

      {!result ? <EmptyState title="No recovery run yet">Select an event and datasets, then run recovery.</EmptyState> : (
        <>
          <RecoverySummary result={result} />
          <div className="grid gap-4 xl:grid-cols-2">
            <Card title="Per-source verification">
              <div className="overflow-x-auto"><table className="num w-full text-left text-sm">
                <thead className="text-xs uppercase text-muted"><tr><th className="py-1">Source</th><th>Stored</th><th>Valid</th><th>CRC fail</th><th>Malformed</th><th>Dupes</th><th>Missing</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {result.sourceStats.map((s) => <tr key={s.sourceId}><td className="py-1.5"><SourceChip source={s.sourceId} /></td><td>{s.total}</td><td>{s.valid}</td><td className={s.crcFailures ? 'text-warn' : ''}>{s.crcFailures}</td><td>{s.malformed}</td><td>{s.duplicates}</td><td className={s.missing ? 'text-bad' : ''}>{s.missing}</td></tr>)}
                </tbody>
              </table></div>
              <div className="mt-3 space-y-1 text-xs text-muted">
                <div>Recovery incl. inconsistent: <b className="num text-slate-200">{result.recoveryInclInconsistentPct?.toFixed(1) ?? '—'}%</b> · Data loss: <b className="num text-slate-200">{result.lossPct?.toFixed(1) ?? '—'}%</b> · Processing time <b className="num text-slate-200">{result.durationMs.toFixed(1)} ms</b></div>
                <div>Chronology warnings: {result.chronologyWarnings} · Duplicates dropped: {result.duplicatesTotal}</div>
                {result.malformedSamples.length > 0 && <div>Malformed samples: {result.malformedSamples.join('; ')}</div>}
                <div>Missing ranges: {result.missingRanges.length ? result.missingRanges.slice(0, 8).map((r) => `${r.start}–${r.end}`).join(', ') + (result.missingRanges.length > 8 ? ` … (+${result.missingRanges.length - 8})` : '') : 'none'}</div>
                <div>Corrupted ranges: {result.corruptedRanges.length ? result.corruptedRanges.slice(0, 8).map((r) => `${r.start}–${r.end}`).join(', ') : 'none'}</div>
              </div>
            </Card>
            <Card title={`Conflicts between copies (${result.conflicts.length})`}>
              {result.conflicts.length === 0 ? <p className="text-sm text-muted">No conflicting valid copies.</p> : (
                <div className="max-h-64 overflow-auto"><table className="num w-full text-left text-xs">
                  <thead className="text-muted"><tr><th className="py-1">Seq</th><th>Field(s)</th><th>Values by source</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {result.conflicts.slice(0, 100).map((c) => <tr key={c.sequence_id} className="align-top"><td className="py-1">{c.sequence_id}</td><td>{c.fields.join(', ')}</td><td>{c.variants.map((v) => <div key={v.sources.join()}><SourceChip source={v.sources.join('+')} /> {c.fields.map((f) => String(v.record[f as 'altitude'])).join(' / ')}</div>)}</td></tr>)}
                  </tbody>
                </table></div>
              )}
              <p className="mt-2 text-xs text-muted">Conflicts are never silently overwritten: the row is flagged inconsistent and all variants are listed here.</p>
            </Card>
          </div>
          <Card title="Reconstructed dataset" actions={
            <select className="rounded border border-line bg-panel2 px-2 py-1 text-xs" value={filter} onChange={(e) => { setFilter(e.target.value as RecStatus | 'all'); setPage(0); }} aria-label="Filter by status">
              <option value="all">All statuses</option>{(Object.keys(STATUS_STYLE) as RecStatus[]).map((k) => <option key={k} value={k}>{STATUS_STYLE[k].label}</option>)}
            </select>}>
            <div className="overflow-x-auto"><table className="num w-full text-left text-xs">
              <thead className="uppercase text-muted"><tr><th className="py-1 pr-3">Seq</th><th className="pr-3">Time</th><th className="pr-3">Status</th><th className="pr-3">Source used</th><th className="pr-3">Alt ft</th><th className="pr-3">Spd kt</th><th className="pr-3">Pitch</th><th className="pr-3">Roll</th><th className="pr-3">Yaw</th><th>Note</th></tr></thead>
              <tbody className="divide-y divide-line">
                {rows.slice(page * PAGE, (page + 1) * PAGE).map((r) => (
                  <tr key={r.sequence_id}>
                    <td className="py-1 pr-3">{r.sequence_id}</td><td className="pr-3">{fmtClock(r.record?.timestamp ?? null)}</td>
                    <td className={cx('pr-3 whitespace-nowrap', STATUS_STYLE[r.status].cls)}>{STATUS_STYLE[r.status].label}</td>
                    <td className="pr-3"><SourceChip source={r.source_used} /></td>
                    <td className="pr-3">{r.record?.altitude ?? '—'}</td><td className="pr-3">{r.record?.speed ?? '—'}</td><td className="pr-3">{r.record?.pitch ?? '—'}</td><td className="pr-3">{r.record?.roll ?? '—'}</td><td className="pr-3">{r.record?.yaw ?? '—'}</td>
                    <td className="max-w-md text-muted">{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <div className="mt-3 flex items-center gap-3 text-xs text-muted">
              <Button disabled={page === 0} onClick={() => setPage(page - 1)}>Prev</Button>
              <span className="num">Page {page + 1} / {pages} · {rows.length} rows</span>
              <Button disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
