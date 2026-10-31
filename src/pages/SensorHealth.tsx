import { Download, Play, Radio, RotateCcw, Square } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Brush, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, Metric, PageHeader, SimNotice } from '../components/ui';
import { downloadText, toCsv } from '../lib/csv';
import { generateTruth } from '../lib/generator';
import { evaluate, FAULT_WINDOW, injectFault, makeAlerts, SIGNALS, UNITS, validateTelemetryBatch, type MonitorRow, type SensorFault, type SignalKey, type TelemetryRecord, classifyRows } from '../lib/sensorMonitoring';
import { useSim } from '../state/SimContext';

const faultOptions: { key: SensorFault; label: string }[] = [
  { key: 'bias', label: 'Bias' }, { key: 'drift', label: 'Gradual drift' }, { key: 'spike', label: 'Spike' },
  { key: 'noise', label: 'Excess noise' }, { key: 'frozen', label: 'Frozen output' }, { key: 'dropout', label: 'Dropout' },
  { key: 'multiple', label: 'Multiple faults (drift + dropout)' }, { key: 'message_disorder', label: 'Out-of-order messages' }, { key: 'delayed', label: 'Delayed message' }, { key: 'normal_disturbance', label: 'Valid turbulence-like disturbance (no fault)' },
];
const baseSample = (runId: string, seq: number, truth: Record<SignalKey, number>, timestamp: string): TelemetryRecord => ({
  schema_version: '1.0', run_id: runId, sequence: seq,
  timestamp_utc: timestamp, monotonic_ms: seq * 1000,
  source: 'simulator', units: UNITS, signals: truth,
  quality: { missing_channels: [], stale: false, simulated: true, injected: false, ordering: 'in_order' },
});

export function SensorHealth() {
  const { sim, dispatch, localPersistenceError } = useSim();
  const fault = sim.sensorFault;
  const channel = sim.sensorChannel;
  const [payload, setPayload] = useState('');
  const [replayRecords, setReplayRecords] = useState<TelemetryRecord[] | null>(null);
  const [replayMetadata, setReplayMetadata] = useState<Record<string, unknown> | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [replayWarning, setReplayWarning] = useState<string | null>(null);
  const [repeatabilityResult, setRepeatabilityResult] = useState<string | null>(null);
  const [clockNow, setClockNow] = useState(Date.now());
  useEffect(() => { const t = window.setInterval(() => setClockNow(Date.now()), 500); return () => window.clearInterval(t); }, []);
  const lastReceivedAt = sim.lastReceivedAtUtc ? Date.parse(sim.lastReceivedAtUtc) : null;
  const dataAgeMs = lastReceivedAt === null ? null : Math.max(0, clockNow - lastReceivedAt);
  const streamStale = dataAgeMs !== null && dataAgeMs > 2000;
  const parsed = useMemo(() => { if (!payload) return null; if (payload.length > 100_000) return { accepted: [], issues: [{ index: 0, sequence: null, codes: ['payload_too_large'] }] }; try { const value = JSON.parse(payload); return validateTelemetryBatch(Array.isArray(value) ? value : [value]); } catch { return { accepted: [], issues: [{ index: 0, sequence: null, codes: ['invalid_json'] }] }; } }, [payload]);
  const runId = replayRecords?.[0]?.run_id ?? sim.runId;
  const rows = useMemo(() => {
    if (replayRecords) {
      return classifyRows(replayRecords.map((telemetry) => ({
        telemetry,
        truth: Object.fromEntries(SIGNALS.map((key) => [key, telemetry.signals[key] ?? 0])) as Record<SignalKey, number>,
        injectedFault: telemetry.quality.injected,
      })));
    }
    const bySeq = new Map<number, (typeof sim.primary.records)[number]>();
    for (const rec of [...sim.remote.records, ...sim.backup.records, ...sim.primary.records]) if (!bySeq.has(rec.sequence_id)) bySeq.set(rec.sequence_id, rec);
    const base: Omit<MonitorRow, 'state' | 'reasons' | 'cusumState' | 'cusumReasons' | 'processingMs'>[] = [];
    const start = Math.max(0, sim.config.durationSec - FAULT_WINDOW);
    let lastValue: number | null = null;
    for (let seq = 0; seq < sim.tick; seq++) {
      const rec = bySeq.get(seq);
      const generated = generateTruth(sim.config, seq);
      const truth: Record<SignalKey, number> = rec ? { altitude_ft: rec.altitude, speed_kt: rec.speed, pitch_deg: rec.pitch, roll_deg: rec.roll, yaw_deg: rec.yaw } : { altitude_ft: generated.altitude, speed_kt: generated.speed, pitch_deg: generated.pitch, roll_deg: generated.roll, yaw_deg: generated.yaw };
      const active = !!rec && fault !== 'none' && seq >= start;
      const changed = active && fault !== 'none' ? injectFault(truth, seq, fault, sim.config.durationSec, channel) : { signals: { ...truth }, affected: [] as SignalKey[] };
      let signals: TelemetryRecord['signals'] = missing ? { altitude_ft: null, speed_kt: null, pitch_deg: null, roll_deg: null, yaw_deg: null } : changed.signals;
      if (active && fault === 'frozen' && lastValue !== null) signals = { ...signals, [channel]: lastValue };
      const missing = !rec;
      const hasRemoteDuplicate = sim.remote.records.filter(r => r.sequence_id === seq).length > 1;
      const ordering = fault === 'message_disorder' && active ? 'out_of_order' : hasRemoteDuplicate ? 'duplicate' : missing ? 'gap' : 'in_order';
      const injected = active && fault !== 'normal_disturbance' && ((fault === 'delayed' || fault === 'message_disorder') ? seq === start + 2 : true);
      const telemetry = baseSample(runId, seq, signals, rec?.timestamp ?? generated.timestamp);
      telemetry.quality = { missing_channels: missing ? [...SIGNALS] : changed.affected.filter((k) => signals[k] === null), stale: seq === sim.tick - 1 && streamStale, simulated: true, injected, ordering };
      if (active && fault === 'dropout') { signals = { ...signals, [channel]: null }; telemetry.signals = signals; telemetry.quality.missing_channels = [channel]; }
      if (injected && fault === 'message_disorder') { telemetry.sequence = Math.max(0, seq - 2); telemetry.quality.ordering = 'out_of_order'; }
      if (injected && fault === 'delayed') { telemetry.monotonic_ms = Math.max(0, telemetry.monotonic_ms - 5000); telemetry.quality.stale = true; }
      base.push({ telemetry, truth, injectedFault: injected });
      lastValue = signals[channel];
    }
    return classifyRows(base);
  }, [sim.tick, sim.config, sim.primary.records, sim.backup.records, sim.remote.records, fault, channel, runId, streamStale, replayRecords]);
  const alerts = useMemo(() => makeAlerts(rows, runId), [rows, runId]);
  const metrics = useMemo(() => evaluate(rows), [rows]);
  const cusumMetrics = useMemo(() => evaluate(rows, 'cusum'), [rows]);
  const last = rows.slice(-1)[0];
  const handleJson = (v: string) => {
    setPayload(v);
  };
  const loadReplay = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('Replay file exceeds the 10 MB limit.');
      const data = JSON.parse(await file.text());
      const values = Array.isArray(data) ? data : data.telemetry;
      if (!Array.isArray(values)) throw new Error('Expected a record array or an exported telemetry JSON file.');
      if (values.length > 50_000) throw new Error('Replay contains more than 50,000 samples.');
      const result = validateTelemetryBatch(values);
      const orderIssue = /^(sequence_gap_|duplicate_sequence$|out_of_order_sequence$|non_increasing_monotonic_time$|out_of_order_timestamp$)/;
      const fatal = result.issues.filter(x => x.codes.some(code => !orderIssue.test(code)));
      if (fatal.length) throw new Error(`Replay contains invalid records: ${fatal.map(x => x.codes.join(',')).join('; ')}`);
      if (!result.accepted.length) throw new Error('No telemetry samples found.');
      setReplayRecords(result.accepted);
      setReplayMetadata(data && !Array.isArray(data) && data.configuration && typeof data.configuration === 'object' ? data.configuration as Record<string, unknown> : null);
      setReplayWarning(result.issues.length ? `Ordering/sequence issues preserved: ${result.issues.map(x => x.codes.join(',')).join('; ')}` : null);
      setReplayError(null);
      setRepeatabilityResult(null);
    } catch (e) { setReplayRecords(null); setReplayMetadata(null); setReplayWarning(null); setReplayError(String(e)); }
  };
  const reset = () => dispatch({ type: 'RESET' });

  return <div className="space-y-4">
    <PageHeader title="Sensor health and detector bench" subtitle="Versioned synthetic telemetry, channel quality, deterministic threshold/persistence monitor, alert evidence, and repeatable fault scenarios.">
      <div className="flex gap-2">
        {!replayRecords && sim.status === 'idle' && <button className="inline-flex items-center gap-1.5 rounded border border-accent bg-accent/15 px-3 py-1.5 text-sm text-accent" onClick={() => dispatch({ type: 'START', runId: crypto.randomUUID() })}><Play size={15}/> Start run</button>}
        {!replayRecords && (sim.status === 'running' || sim.status === 'paused') && <button className="inline-flex items-center gap-1.5 rounded border border-line bg-panel2 px-3 py-1.5 text-sm" onClick={() => dispatch({ type: 'STOP' })}><Square size={15}/> Stop and close</button>}
        <button className="inline-flex items-center gap-1.5 rounded border border-line bg-panel2 px-3 py-1.5 text-sm" onClick={reset}><RotateCcw size={15}/> Reset</button>
      </div>
    </PageHeader>
    <SimNotice>{replayRecords ? 'REPLAY FILE — measurements are imported and their provenance follows each record’s source/quality flags. This app does not verify whether a source is real aircraft data.' : 'SIMULATION / TEST ONLY — all measurements and injected faults are synthetic. These illustrative thresholds are not validated flight limits or a safety monitor.'}</SimNotice>
    <div className="grid gap-4 md:grid-cols-4">
      <Card><Metric label="Run ID" value={<span className="text-sm">{runId}</span>} sub={`${rows.length} samples · ${replayRecords ? 'replay' : sim.status}`} /></Card>
      <Card><Metric label="Deterministic monitor" value="Threshold + persistence" sub="version 1.0 · sample aligned" /></Card>
      <Card><Metric label="AI detector" value="Unavailable" sub="No model configured; recording continues" tone="warn" /></Card>
      <Card><Metric label="Latest state" value={last?.state ?? 'WAITING'} sub={last?.reasons.join(', ') || 'Start a synthetic run'} tone={last?.state === 'FAULT_INDICATED' ? 'bad' : undefined} /></Card>
    </div>
    <div className="grid gap-4 xl:grid-cols-2">
      <Card title="Simulation-only sensor fault injection">
        <div className="flex flex-wrap gap-3 text-sm">
          <label>Fault <select disabled={sim.status !== 'idle' || !!replayRecords} className="ml-2 rounded border border-line bg-panel2 px-2 py-1 disabled:opacity-50" value={fault} onChange={e => dispatch({ type: 'SET_SENSOR_BENCH', fault: e.target.value as SensorFault | 'none', channel })}><option value="none">No injected fault</option>{faultOptions.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}</select></label>
          <label>Channel <select disabled={sim.status !== 'idle' || !!replayRecords} className="ml-2 rounded border border-line bg-panel2 px-2 py-1 disabled:opacity-50" value={channel} onChange={e => dispatch({ type: 'SET_SENSOR_BENCH', fault, channel: e.target.value as SignalKey })}>{SIGNALS.map(x => <option key={x} value={x}>{x} ({UNITS[x]})</option>)}</select></label>
        </div>
        <p className="mt-3 text-xs text-muted">Selected scenario applies to the final {FAULT_WINDOW} samples of the configured run. The turbulence-like option is a normal no-fault disturbance. Multiple-fault case injects altitude drift and speed dropout together. Existing recorder corruption controls test storage integrity and are separate from these sensor faults.</p>
        <p className="mt-2 text-xs text-muted">Signal set is a synthetic dashboard fixture. It is not a validated physical sensor suite; speed is generated simulator data, and no pressure-only airspeed inference is made.</p>
      </Card>
      <Card title="Connection, quality and safe fallback">
        <div className="space-y-2 text-sm"><div className="flex items-center gap-2"><Radio size={15}/> {replayRecords ? `Replay source: ${replayRecords[0]?.source ?? 'unknown'} · ${replayRecords.length} samples` : `Simulator source: ${sim.status === 'running' ? 'connected' : 'not streaming'} · last message ${dataAgeMs === null ? '—' : `${(dataAgeMs / 1000).toFixed(1)} s ago`}${streamStale ? ' · STALE' : ''}`}</div><div>Recorder: {sim.primary.state} · backup: {sim.backup.state}</div><div>Bad/missing recorder samples: {rows.filter(r => r.state === 'UNKNOWN_DEGRADED').length}</div><div>AI failure policy: AI unavailable/uncertain; threshold/persistence and recording remain active. No stale AI output is reused.</div></div>
        <p className="mt-2 text-xs text-muted">Simulator session is checkpointed in this browser tab so a page refresh can restore the run. This is not durable recorder hardware or long-term storage.</p>
        {localPersistenceError && <p className="mt-2 text-xs text-bad" role="alert">{localPersistenceError}</p>}
      </Card>
    </div>
    <div className="grid gap-4 xl:grid-cols-2">
      <Card title="Per-channel health">
        {!last ? <p className="text-sm text-muted">No sample received yet.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs uppercase text-muted"><tr><th className="py-1">Channel</th><th>Latest value</th><th>Unit</th><th>Validity</th><th>Freshness</th></tr></thead><tbody className="divide-y divide-line">{SIGNALS.map(key => { const value = last.telemetry.signals[key]; const valid = value !== null && Number.isFinite(value); return <tr key={key}><td className="py-2">{key}</td><td>{value ?? '—'}</td><td>{UNITS[key]}</td><td>{valid ? 'Valid' : 'Missing/invalid'}</td><td>{last.telemetry.quality.stale ? 'Stale' : 'Fresh'}</td></tr>; })}</tbody></table><p className="mt-2 text-xs text-muted">Sequence quality: {last.telemetry.quality.ordering} · source: {last.telemetry.source} · simulated: {String(last.telemetry.quality.simulated)}</p></div>}
      </Card>
      <Card title={`Alert evidence (${alerts.length})`}>
        {!alerts.length ? <p className="text-sm text-muted">No alert or degraded-input event in the current run.</p> : <div className="max-h-72 space-y-2 overflow-auto">{alerts.slice(-12).reverse().map(alert => <details key={alert.alert_id} className="rounded border border-line p-2 text-xs"><summary className="cursor-pointer"><b>{alert.alert_id}</b> · {alert.detector_id} · {alert.state} · seq {alert.sample_range.start}</summary><div className="mt-2 space-y-1 text-muted"><div>{alert.start_time_utc} · channels: {alert.affected_channels.join(', ') || 'unknown'}</div><div>Label: {alert.fault_label} · score {alert.score.toFixed(2)} · confidence: not calibrated · uncertainty: {alert.uncertainty}</div><div>Reasons: {alert.reason_codes.join(', ') || 'input validity'}</div><pre className="max-h-32 overflow-auto rounded bg-panel2 p-2 text-[10px] text-slate-300">{JSON.stringify(alert.raw_samples[0], null, 2)}</pre></div></details>)}</div>}
      </Card>
    </div>
    <Card title="Replay and repeatability">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="cursor-pointer rounded border border-line bg-panel2 px-3 py-1.5">Load telemetry JSON replay<input className="sr-only" type="file" accept="application/json,.json" onChange={e => { void loadReplay(e.target.files?.[0]); }} /></label>
        {replayRecords && <>
          <button className="rounded border border-line bg-panel2 px-3 py-1.5" onClick={() => { setReplayRecords(null); setReplayMetadata(null); setReplayWarning(null); setRepeatabilityResult(null); }}>Return to live run</button>
          <button className="rounded border border-line bg-panel2 px-3 py-1.5" onClick={() => {
            const repeated = classifyRows(replayRecords.map(telemetry => ({ telemetry, truth: Object.fromEntries(SIGNALS.map(key => [key, telemetry.signals[key] ?? 0])) as Record<SignalKey, number>, injectedFault: telemetry.quality.injected })));
            const sameOutputs = JSON.stringify(rows.map(r => [r.state, r.reasons, r.cusumState, r.cusumReasons])) === JSON.stringify(repeated.map(r => [r.state, r.reasons, r.cusumState, r.cusumReasons]));
            const sameEvents = JSON.stringify(alerts.map(a => a.alert_id)) === JSON.stringify(makeAlerts(repeated, runId).map(a => a.alert_id));
            setRepeatabilityResult(sameOutputs && sameEvents ? 'PASS — detector outputs and event IDs match' : 'FAIL — replay outputs differ');
          }}>Replay and compare again</button>
          <span className="text-muted">Replaying {replayRecords.length} samples from {runId}</span>
        </>}
        {!replayRecords && <span className="text-muted">Replay an exported run; deterministic baselines reprocess the supplied samples.</span>}
      </div>
      {replayError && <p className="mt-2 text-xs text-bad">Replay rejected: {replayError}</p>}
      {replayWarning && <p className="mt-2 text-xs text-warn">{replayWarning}</p>}
      {repeatabilityResult && <p className="mt-2 text-xs text-accent">{repeatabilityResult}</p>}
    </Card>
    <Card title="Time-series telemetry — zoom and pan with the brush">
      {!rows.length ? <p className="text-sm text-muted">Start a run to plot telemetry.</p> : <div className="h-72"><ResponsiveContainer width="100%" height="100%"><LineChart data={rows.slice(-300).map(r => ({ sequence: r.telemetry.sequence, altitude: r.telemetry.signals.altitude_ft, speed: r.telemetry.signals.speed_kt }))} margin={{ top: 8, right: 12, bottom: 8, left: 4 }}><CartesianGrid stroke="#22324d" strokeDasharray="3 3"/><XAxis dataKey="sequence" stroke="#8aa0bf" tick={{ fontSize: 11 }}/><YAxis yAxisId="altitude" stroke="#3b9eff" tick={{ fontSize: 11 }}/><YAxis yAxisId="speed" orientation="right" stroke="#34d399" tick={{ fontSize: 11 }}/><Tooltip labelFormatter={v => `Sequence ${v}`} contentStyle={{ background: '#0f1b2e', border: '1px solid #22324d' }}/><Legend/><Line yAxisId="altitude" dataKey="altitude" name="Altitude (ft)" stroke="#3b9eff" dot={false} connectNulls={false} isAnimationActive={false}/><Line yAxisId="speed" dataKey="speed" name="Speed (kt, synthetic)" stroke="#34d399" dot={false} connectNulls={false} isAnimationActive={false}/>{rows.some(r => r.injectedFault) && <ReferenceLine x={rows.find(r => r.injectedFault)?.telemetry.sequence} stroke="#f87171" strokeDasharray="4 4" label="Injected fault"/>}<Brush dataKey="sequence" height={22} stroke="#3b9eff"/></LineChart></ResponsiveContainer></div>}
    </Card>
    <Card title="Evaluation on synthetic run">
      <p className="mb-3 text-xs text-muted">Metrics are calculated against this run's injected-fault labels only. They are not held-out research results. Calibration is omitted because the detector score is not calibrated confidence.</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs uppercase text-muted"><tr><th className="py-1 pr-3">Detector</th><th>TP / FP / FN / TN</th><th>Precision</th><th>Recall</th><th>F1</th><th>False alarms/hour</th><th>Detection delay</th><th>Unknown rate</th></tr></thead><tbody className="divide-y divide-line"><tr><td className="py-2 pr-3">Threshold + persistence v1.0</td><td>{metrics.tp}/{metrics.fp}/{metrics.fn}/{metrics.tn}</td><td>{metrics.precision.toFixed(2)}</td><td>{metrics.recall.toFixed(2)}</td><td>{metrics.f1.toFixed(2)}</td><td>{metrics.falseAlarmsPerHour.toFixed(1)}</td><td>{metrics.detectionDelayMs === null ? 'N/A' : `${metrics.detectionDelayMs} ms`}</td><td>{(metrics.abstentionRate * 100).toFixed(1)}%</td></tr><tr><td className="py-2 pr-3">Median residual CUSUM v1.0</td><td>{cusumMetrics.tp}/{cusumMetrics.fp}/{cusumMetrics.fn}/{cusumMetrics.tn}</td><td>{cusumMetrics.precision.toFixed(2)}</td><td>{cusumMetrics.recall.toFixed(2)}</td><td>{cusumMetrics.f1.toFixed(2)}</td><td>{cusumMetrics.falseAlarmsPerHour.toFixed(1)}</td><td>{cusumMetrics.detectionDelayMs === null ? 'N/A' : `${cusumMetrics.detectionDelayMs} ms`}</td><td>{(cusumMetrics.abstentionRate * 100).toFixed(1)}%</td></tr><tr><td className="py-2 pr-3">Optional AI</td><td colSpan={7}>Unavailable — no model configured; no score/confidence is shown.</td></tr></tbody></table><p className="mt-2 text-xs text-muted">Detector batch processing: {last?.processingMs.toFixed(3) ?? '—'} ms for {rows.length} samples on this browser. This is local processing time, not ingestion-to-display latency under load.</p></div>
    </Card>
    <div className="flex flex-wrap gap-2"><button className="inline-flex items-center gap-1.5 rounded border border-line bg-panel2 px-3 py-1.5 text-sm disabled:opacity-40" disabled={!rows.length} onClick={() => downloadText(`${runId}-telemetry-alerts.json`, JSON.stringify({ schema_version: '1.0', software_version: '0.1.0', run_id: runId, source: replayRecords ? 'replay' : 'simulator', ai_status: 'unavailable_no_model_configured', configuration: replayMetadata ?? { seed: sim.config.seed, duration_seconds: sim.config.durationSec, injected_fault: fault, channel }, detector_versions: ['threshold-persistence/1.0','median-residual-cusum/1.0'], telemetry: rows.map(r => r.telemetry), detector_outputs: rows.map(r => ({ sequence: r.telemetry.sequence, threshold_persistence: { state: r.state, reasons: r.reasons }, median_residual_cusum: { state: r.cusumState, reasons: r.cusumReasons } })), alerts, evaluation: { threshold_persistence: metrics, median_residual_cusum: cusumMetrics, detector_batch_processing_ms: last?.processingMs ?? null } }, null, 2), 'application/json') }><Download size={15}/> Export telemetry + alerts JSON</button><button className="rounded border border-line bg-panel2 px-3 py-1.5 text-sm disabled:opacity-40" disabled={!rows.length} onClick={() => downloadText(`${runId}-telemetry-alerts.csv`, toCsv(['schema_version','run_id','sequence','timestamp_utc','monotonic_ms','source','altitude_ft','speed_kt','pitch_deg','roll_deg','yaw_deg','altitude_unit','speed_unit','angle_unit','quality_missing_channels','stale','simulated','injected','ordering','threshold_detector_id','threshold_version','threshold_state','threshold_reasons','cusum_detector_id','cusum_version','cusum_state','cusum_reasons','alert_ids','alert_details_json'], rows.map(r => [r.telemetry.schema_version,r.telemetry.run_id,r.telemetry.sequence,r.telemetry.timestamp_utc,r.telemetry.monotonic_ms,r.telemetry.source,...SIGNALS.map(k => r.telemetry.signals[k]),UNITS.altitude_ft,UNITS.speed_kt,UNITS.pitch_deg,r.telemetry.quality.missing_channels.join('|'),r.telemetry.quality.stale,r.telemetry.quality.simulated,r.telemetry.quality.injected,r.telemetry.quality.ordering,'threshold-persistence','1.0',r.state,r.reasons.join('|'),'median-residual-cusum','1.0',r.cusumState,r.cusumReasons.join('|'),alerts.filter(a => a.sample_range.start === r.telemetry.sequence).map(a => a.alert_id).join('|'),JSON.stringify(alerts.filter(a => a.sample_range.start === r.telemetry.sequence))]))) }><Download size={15}/> Export telemetry + alerts CSV</button><button className="rounded border border-line bg-panel2 px-3 py-1.5 text-sm disabled:opacity-40" disabled={!rows.length} onClick={() => downloadText(`${runId}-evaluation.json`, JSON.stringify({ run_id: runId, software_version: '0.1.0', configuration: replayMetadata ?? { seed: sim.config.seed, duration_seconds: sim.config.durationSec, injected_fault: fault, channel }, metrics: { threshold_persistence: metrics, median_residual_cusum: cusumMetrics, detector_batch_processing_ms: last?.processingMs ?? null }, limitations: ['synthetic injected-fault run', 'no held-out scenarios', 'not calibrated', 'not aircraft validated'] }, null, 2), 'application/json')}>Export evaluation JSON</button></div>
    <Card title={`Time-aligned samples and alert evidence (${alerts.length} alert records)`}>
      {!rows.length ? <p className="text-sm text-muted">Start a run to stream deterministic synthetic samples.</p> : <div className="max-h-96 overflow-auto"><table className="num w-full text-left text-xs"><thead className="sticky top-0 bg-panel text-muted"><tr><th>Seq</th><th>UTC</th><th>Altitude ft</th><th>Speed kt</th><th>Pitch deg</th><th>Threshold</th><th>CUSUM</th><th>Evidence</th></tr></thead><tbody className="divide-y divide-line">{rows.slice(-300).map((r, index) => <tr key={`${runId}-${r.telemetry.sequence}-${index}`} className="align-top"><td>{r.telemetry.sequence}</td><td>{r.telemetry.timestamp_utc.slice(11,23)}Z</td><td>{r.telemetry.signals.altitude_ft ?? '—'}</td><td>{r.telemetry.signals.speed_kt ?? '—'}</td><td>{r.telemetry.signals.pitch_deg ?? '—'}</td><td>{r.state}</td><td>{r.cusumState}</td><td>{r.reasons.concat(r.cusumReasons).join(', ') || '—'}</td></tr>)}</tbody></table></div>}
    </Card>
    <Card title="Telemetry contract validation">
      <p className="mb-2 text-xs text-muted">Paste one schema 1.0 JSON sample. Invalid schema, units, timestamps, sequence, missing channels, and non-finite values are rejected visibly. Interchange timestamps must be UTC.</p>
      <textarea className="h-24 w-full rounded border border-line bg-panel2 p-2 font-mono text-xs" placeholder="Paste a telemetry JSON record" value={payload} onChange={e => handleJson(e.target.value)} />
      {payload && parsed && <div className="mt-2 text-xs">{parsed.accepted.length ? `${parsed.accepted.length} valid record(s) parsed` : 'No valid records'}{parsed.issues.length ? <ul className="mt-1 list-disc pl-5 text-warn">{parsed.issues.map((x, i) => <li key={i}>Index {x.index}{x.sequence === null ? '' : ` · sequence ${x.sequence}`}: {x.codes.join(', ')}</li>)}</ul> : <span className="text-ok"> · schema and ordering valid</span>}</div>}
    </Card>
  </div>;
}


