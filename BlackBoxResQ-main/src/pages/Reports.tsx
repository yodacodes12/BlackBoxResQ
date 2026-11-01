import { Database, Download, Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ReportDocument } from '../components/ReportDocument';
import { Button, Card, EmptyState, HealthBadge, PageHeader, SimNotice, cx } from '../components/ui';
import { api, type PersistedEvent } from '../lib/api';
import { downloadText, reconstructedCsv, toCsv } from '../lib/csv';
import type { RecoveryTest } from '../lib/reports';
import { fmtPct } from '../lib/status';
import { useSim } from '../state/SimContext';

export const summaryCsv = (t: RecoveryTest): string => {
  const r = t.result;
  return toCsv(['field', 'value'], [
    ['test_id', t.id], ['scenario', t.scenarioName], ['run_id', t.runId ?? t.flightId], ['flight_id', t.flightId], ['seed', t.seed],
    ['expected_records', r.expected], ['validated', r.counts.validated], ['inconsistent', r.counts.inconsistent],
    ['missing', r.counts.missing], ['corrupted', r.counts.corrupted],
    ['recovery_pct', r.recoveryPct?.toFixed(2)], ['data_loss_pct', r.lossPct?.toFixed(2)],
    ['recovery_time_ms', r.durationMs.toFixed(2)], ['sources_included', t.sourcesIncluded.join('|')],
    ['sources_unavailable', t.sourcesUnavailable.map((u) => `${u.source}: ${u.reason}`).join('|')],
  ]);
};

export const historyCsv = (tests: RecoveryTest[]): string =>
  toCsv(
    ['test_id', 'scenario', 'run_id', 'flight_id', 'seed', 'expected', 'validated', 'inconsistent', 'missing', 'corrupted', 'recovery_pct', 'data_loss_pct', 'recovery_time_ms', 'sources_included'],
    tests.map((t) => [t.id, t.scenarioName, t.runId ?? t.flightId, t.flightId, t.seed, t.result.expected, t.result.counts.validated, t.result.counts.inconsistent, t.result.counts.missing, t.result.counts.corrupted, t.result.recoveryPct?.toFixed(2), t.result.lossPct?.toFixed(2), t.result.durationMs.toFixed(2), t.sourcesIncluded.join('|')]),
  );

function AuditHistory() {
  const [rows, setRows] = useState<PersistedEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => api<PersistedEvent[]>('/events?limit=200').then((r) => { setRows(r); setErr(null); }).catch((e) => setErr(String(e)));
  useEffect(() => { load(); }, []);
  return (
    <Card title="Persisted audit trail (SQLite, latest 200 events across runs)" actions={<Button onClick={load}>Refresh</Button>} className="print:hidden">
      {err ? <p className="text-sm text-bad">Could not load: {err}</p> : !rows ? <p className="text-sm text-muted">Loading…</p> : rows.length === 0 ? <p className="text-sm text-muted">No events stored yet.</p> : (
        <div className="max-h-72 overflow-auto"><table className="num w-full text-left text-xs">
          <thead className="text-muted"><tr><th className="py-1">Stored (UTC)</th><th>Run</th><th>T+s</th><th>Kind</th><th>Message</th></tr></thead>
          <tbody className="divide-y divide-line">{rows.slice().reverse().map((e) => <tr key={e.id}><td className="py-1 pr-3">{e.created_at.slice(11, 19)}</td><td className="pr-3 font-brand">{e.run_id.slice(0, 6)}</td><td className="pr-3">{e.tick}</td><td className="pr-3">{e.kind}</td><td className="text-slate-300">{e.message}</td></tr>)}</tbody>
        </table></div>
      )}
    </Card>
  );
}

export function Reports() {
  const { sim, backend } = useSim();
  const [sel, setSel] = useState<string | null>(null);
  const tests = sim.tests;
  const t = tests.find((x) => x.id === sel) ?? tests[tests.length - 1];
  const online = backend.status === 'online';

  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <PageHeader title="Investigation reports" subtitle="One report per completed recovery test. Print it, or use your browser's “Save as PDF” destination in the print dialog.">
          <div className="flex items-center gap-2 text-xs text-muted"><Database size={14} aria-hidden />
            <HealthBadge health={online ? 'online' : backend.status === 'checking' ? 'offline' : 'degraded'} label={online ? 'Backend connected — saving to SQLite' : backend.status === 'checking' ? 'Checking backend…' : 'Backend offline — memory only'} />
          </div>
        </PageHeader>
        <SimNotice />
        {backend.status === 'offline' && <div className="mb-4 rounded border border-line bg-panel px-3 py-2 text-xs text-muted">Results stay in this browser session only. To persist them, start the API: <code className="text-slate-200">cd backend &amp;&amp; .venv/bin/uvicorn app.main:app --port 8000</code>. Unsaved results are uploaded automatically once it is reachable.</div>}
      </div>
      {!t ? <EmptyState title="No recovery tests yet">Run recovery in the Failure Simulation lab, or save a result from the Recovery Lab.</EmptyState> : (
        <>
          <Card title={`Recovery history (${tests.length})`} actions={<Button icon={Download} onClick={() => downloadText('recovery-history.csv', historyCsv(tests))}>History CSV</Button>} className="print:hidden">
            <div className="overflow-x-auto"><table className="num w-full text-left text-sm">
              <thead className="text-xs uppercase text-muted"><tr><th className="py-1 pr-3">Test</th><th className="pr-3">Scenario</th><th className="pr-3">Sources</th><th className="pr-3">Expected</th><th className="pr-3">Validated</th><th className="pr-3">Recovery</th><th className="pr-3">Loss</th></tr></thead>
              <tbody className="divide-y divide-line">
                {tests.slice().reverse().map((x, i) => (
                  <tr key={`${x.id}-${i}`} onClick={() => setSel(x.id)} className={cx('cursor-pointer hover:bg-panel2', x.id === t.id && 'bg-accent/10')}>
                    <td className="py-1.5 pr-3 font-medium"><button className="text-left text-accent hover:underline" onClick={() => setSel(x.id)}>{x.id}</button></td>
                    <td className="pr-3">{x.scenarioName}</td><td className="pr-3 font-brand text-xs">{x.sourcesIncluded.join(', ') || '—'}</td>
                    <td className="pr-3">{x.result.expected}</td><td className="pr-3">{x.result.counts.validated}</td><td className="pr-3">{fmtPct(x.result.recoveryPct)}</td><td className="pr-3">{fmtPct(x.result.lossPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </Card>
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button variant="primary" icon={Printer} onClick={() => window.print()}>Print / Save as PDF</Button>
            <Button icon={Download} onClick={() => downloadText(`${t.id}-summary.csv`, summaryCsv(t))}>Summary CSV</Button>
            <Button icon={Download} onClick={() => downloadText(`${t.id}-reconstructed.csv`, reconstructedCsv(t.result.rows))}>Reconstructed dataset CSV</Button>
          </div>
          <ReportDocument t={t} />
        </>
      )}
      {online && <AuditHistory />}
    </div>
  );
}
