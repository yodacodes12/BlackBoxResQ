import type { RecoveryTest } from '../lib/reports';
import { fmtPct, fmtTime } from '../lib/status';

const Row = ({ k, v }: { k: string; v: string | number }) => (
  <tr className="border-b border-slate-200"><th className="w-1/2 py-1 pr-3 text-left font-normal text-slate-600">{k}</th><td className="num py-1 text-right font-medium">{v}</td></tr>
);
const H = ({ children }: { children: string }) => <h3 className="mb-1 mt-5 border-b border-slate-400 pb-0.5 text-[11px] font-bold uppercase tracking-wider text-slate-700">{children}</h3>;

/** Light-on-white "paper" rendering of a recovery test. This exact element is what window.print() outputs. */
export function ReportDocument({ t }: { t: RecoveryTest }) {
  const r = t.result;
  const ranges = (xs: { start: number; end: number }[]) => (xs.length ? xs.slice(0, 20).map((x) => (x.start === x.end ? `${x.start}` : `${x.start}–${x.end}`)).join(', ') + (xs.length > 20 ? ` … (+${xs.length - 20} more)` : '') : 'none');
  return (
    <article className="paper mx-auto max-w-3xl rounded border border-line bg-white p-8 text-[13px] leading-snug text-slate-900 print:max-w-none print:rounded-none print:border-0 print:p-0" aria-label={`Investigation report ${t.id}`}>
      <div className="mb-3 border border-slate-400 bg-slate-100 px-3 py-1.5 text-center text-[11px] font-bold tracking-wide text-slate-800">
        SIMULATED DATA — RESEARCH PROTOTYPE — NOT CERTIFIED AVIATION EQUIPMENT
      </div>
      <header className="flex items-end justify-between gap-4 border-b-2 border-slate-800 pb-2">
        <div>
          <div className="font-brand text-lg font-bold">BlackBoxResQ</div>
          <div className="text-sm text-slate-600">Investigation report — recovery test</div>
        </div>
        <div className="text-right"><div className="font-brand text-xl font-bold">{t.id}</div><div className="num text-xs text-slate-600">{t.createdAt ? `Stored ${t.createdAt}` : 'Not persisted'}</div></div>
      </header>

      <H>1. Test identification</H>
      <table className="w-full"><tbody>
        <Row k="Scenario" v={t.scenarioName} />
        <Row k="Flight identifier" v={t.flightId} />
        <Row k="Synthetic dataset seed" v={t.seed} />
        <Row k="Simulated flight time at recovery" v={`${fmtTime(t.flightTimeSec)} (${t.flightTimeSec} s)`} />
      </tbody></table>

      <H>2. Recovery results</H>
      <table className="w-full"><tbody>
        <Row k="Expected record count" v={r.expected} />
        <Row k="Recovered and validated" v={r.counts.validated} />
        <Row k="Recovered but inconsistent (valid copies disagree)" v={r.counts.inconsistent} />
        <Row k="Missing (no surviving copy)" v={r.counts.missing} />
        <Row k="Corrupted (all copies failed CRC)" v={r.counts.corrupted} />
        <Row k="Recovery percentage (validated ÷ expected)" v={fmtPct(r.recoveryPct, 2)} />
        <Row k="Recovery incl. inconsistent" v={fmtPct(r.recoveryInclInconsistentPct, 2)} />
        <Row k="Data-loss percentage (missing + corrupted ÷ expected)" v={fmtPct(r.lossPct, 2)} />
        <Row k="Recovery time (measured processing time)" v={`${r.durationMs.toFixed(2)} ms`} />
      </tbody></table>

      <H>3. Recording sources</H>
      <p className="mb-1">Surviving sources used: <b>{t.sourcesIncluded.length ? t.sourcesIncluded.join(', ') : 'none'}</b></p>
      {t.sourcesUnavailable.length > 0 && <p className="mb-1">Unavailable / excluded: {t.sourcesUnavailable.map((u) => `${u.source} (${u.reason})`).join('; ')}</p>}
      <table className="num mt-1 w-full text-xs">
        <thead><tr className="border-b border-slate-400 text-left text-slate-600"><th className="py-1">Source</th><th>Stored</th><th>Valid</th><th>CRC fail</th><th>Malformed</th><th>Duplicates</th><th>Missing</th></tr></thead>
        <tbody>{r.sourceStats.map((s) => <tr key={s.sourceId} className="border-b border-slate-200"><td className="py-1 font-brand">{s.sourceId}</td><td>{s.total}</td><td>{s.valid}</td><td>{s.crcFailures}</td><td>{s.malformed}</td><td>{s.duplicates}</td><td>{s.missing}</td></tr>)}</tbody>
      </table>

      <H>4. Gaps, conflicts and anomalies</H>
      <p>Missing sequence ranges: {ranges(r.missingRanges)}</p>
      <p>Corrupted sequence ranges: {ranges(r.corruptedRanges)}</p>
      <p>Duplicate records removed: {r.duplicatesTotal} · Malformed records rejected: {r.malformedTotal} · Chronology warnings: {r.chronologyWarnings}</p>
      <p>Conflicting-copy records: {r.conflicts.length}{r.conflicts.length > 0 && ` (first ${Math.min(10, r.conflicts.length)}: ${r.conflicts.slice(0, 10).map((c) => `#${c.sequence_id} [${c.fields.join('/')}]`).join(', ')})`}</p>

      <H>5. Scenario and assumptions</H>
      <ul className="list-disc space-y-0.5 pl-5">{t.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>

      <H>6. Known limitations</H>
      <ul className="list-disc space-y-0.5 pl-5">{t.limitations.map((a, i) => <li key={i}>{a}</li>)}</ul>
      <p className="mt-6 border-t border-slate-300 pt-2 text-[10px] text-slate-500">Generated by BlackBoxResQ (research prototype). Statistics above are computed from the stored record sets listed in section 3, not entered by hand.</p>
    </article>
  );
}
