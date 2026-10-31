export type SignalKey = 'altitude_ft' | 'speed_kt' | 'pitch_deg' | 'roll_deg' | 'yaw_deg';
export type SensorFault = 'bias' | 'drift' | 'spike' | 'noise' | 'frozen' | 'dropout' | 'multiple' | 'message_disorder' | 'delayed' | 'normal_disturbance';
export type DetectorState = 'NORMAL' | 'SUSPECTED_FAULT' | 'FAULT_INDICATED' | 'UNKNOWN_DEGRADED';
export interface TelemetryRecord {
  schema_version: '1.0'; run_id: string; sequence: number; timestamp_utc: string; monotonic_ms: number;
  source: string; units: Record<SignalKey, string>;
  signals: Record<SignalKey, number | null>;
  quality: { missing_channels: SignalKey[]; stale: boolean; simulated: boolean; injected: boolean; ordering: 'in_order' | 'gap' | 'duplicate' | 'out_of_order' };
}
export interface MonitorRow { telemetry: TelemetryRecord; truth: Record<SignalKey, number>; state: DetectorState; reasons: string[]; cusumState: DetectorState; cusumReasons: string[]; injectedFault: boolean; processingMs: number }
export interface AlertRecord { alert_id: string; run_id: string; start_time_utc: string; end_time_utc: string; affected_channels: SignalKey[]; detector_id: string; detector_version: string; state: DetectorState; fault_label: string; simulation_only: true; score: number; confidence: null; uncertainty: string; reason_codes: string[]; sample_range: { start: number; end: number }; raw_samples: TelemetryRecord[] }

export const SIGNALS: SignalKey[] = ['altitude_ft', 'speed_kt', 'pitch_deg', 'roll_deg', 'yaw_deg'];
export const UNITS: Record<SignalKey, string> = { altitude_ft: 'ft', speed_kt: 'kt (synthetic)', pitch_deg: 'deg', roll_deg: 'deg', yaw_deg: 'deg' };
export const LIMITS: Record<SignalKey, number> = { altitude_ft: 1200, speed_kt: 60, pitch_deg: 6, roll_deg: 12, yaw_deg: 40 };
/** Broad payload sanity bounds for synthetic data, not operational aircraft limits. */
export const PAYLOAD_BOUNDS: Record<SignalKey, [number, number]> = { altitude_ft: [-2000, 100000], speed_kt: [-100, 1000], pitch_deg: [-360, 360], roll_deg: [-360, 360], yaw_deg: [-360, 720] };
export const FAULT_WINDOW = 30;

export function parseTelemetry(value: unknown): { ok: true; value: TelemetryRecord } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!value || typeof value !== 'object') return { ok: false, errors: ['payload_not_object'] };
  const x = value as Partial<TelemetryRecord>;
  if (x.schema_version !== '1.0') errors.push('unsupported_schema_version');
  if (typeof x.run_id !== 'string' || !x.run_id.trim()) errors.push('missing_run_id');
  if (!Number.isInteger(x.sequence) || (x.sequence ?? -1) < 0) errors.push('invalid_sequence');
  if (typeof x.timestamp_utc !== 'string' || !Number.isFinite(Date.parse(x.timestamp_utc)) || !/Z$/.test(x.timestamp_utc)) errors.push('invalid_utc_timestamp');
  if (!Number.isFinite(x.monotonic_ms) || (x.monotonic_ms ?? -1) < 0) errors.push('invalid_monotonic_time');
  if (typeof x.source !== 'string' || !x.source.trim()) errors.push('invalid_source');
  if (!x.signals || typeof x.signals !== 'object') errors.push('missing_signals');
  else for (const key of SIGNALS) {
    const v = x.signals[key];
    if (v !== null && (typeof v !== 'number' || !Number.isFinite(v))) errors.push(`invalid_${key}`);
    else if (typeof v === 'number' && (v < PAYLOAD_BOUNDS[key][0] || v > PAYLOAD_BOUNDS[key][1])) errors.push(`out_of_range_${key}`);
  }
  if (!x.units || typeof x.units !== 'object') errors.push('missing_units');
  else for (const key of SIGNALS) if (x.units[key] !== UNITS[key]) errors.push(`invalid_unit_${key}`);
  if (!x.quality || typeof x.quality !== 'object') errors.push('missing_quality');
  else {
    if (!Array.isArray(x.quality.missing_channels) || typeof x.quality.stale !== 'boolean' || typeof x.quality.simulated !== 'boolean' || typeof x.quality.injected !== 'boolean' || !['in_order', 'gap', 'duplicate', 'out_of_order'].includes(x.quality.ordering)) errors.push('invalid_quality');
    else for (const key of SIGNALS) if (x.signals?.[key] === null && !x.quality.missing_channels.includes(key)) errors.push(`missing_channel_unflagged_${key}`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: x as TelemetryRecord };
}

export function validateTelemetryBatch(values: unknown[]): { accepted: TelemetryRecord[]; issues: { index: number; sequence: number | null; codes: string[] }[] } {
  const accepted: TelemetryRecord[] = [];
  const issues: { index: number; sequence: number | null; codes: string[] }[] = [];
  let previous: number | null = null;
  let previousMonotonic: number | null = null;
  let previousTimestamp: number | null = null;
  let batchRunId: string | null = null;
  const seen = new Set<number>();
  values.forEach((value, index) => {
    const parsed = parseTelemetry(value);
    if (!parsed.ok) { issues.push({ index, sequence: null, codes: parsed.errors }); return; }
    const record = parsed.value;
    const codes: string[] = [];
    if (batchRunId !== null && record.run_id !== batchRunId) codes.push('mixed_run_ids');
    batchRunId ??= record.run_id;
    if (seen.has(record.sequence)) codes.push('duplicate_sequence');
    if (previous !== null && record.sequence < previous) codes.push('out_of_order_sequence');
    if (previous !== null && record.sequence > previous + 1) codes.push(`sequence_gap_${previous + 1}_${record.sequence - 1}`);
    if (previousMonotonic !== null && record.monotonic_ms <= previousMonotonic) codes.push('non_increasing_monotonic_time');
    if (previousTimestamp !== null && Date.parse(record.timestamp_utc) < previousTimestamp) codes.push('out_of_order_timestamp');
    seen.add(record.sequence);
    previous = record.sequence;
    previousMonotonic = record.monotonic_ms;
    previousTimestamp = Date.parse(record.timestamp_utc);
    accepted.push(record);
    if (codes.length) issues.push({ index, sequence: record.sequence, codes });
  });
  return { accepted, issues };
}

export function injectFault(truth: Record<SignalKey, number>, seq: number, fault: SensorFault, seed: number, selected: SignalKey = 'altitude_ft'): { signals: TelemetryRecord['signals']; affected: SignalKey[] } {
  const signals: TelemetryRecord['signals'] = { ...truth };
  const affected: SignalKey[] = [];
  const active = seq >= Math.max(0, seed - FAULT_WINDOW);
  if (!active) return { signals, affected };
  const apply = (key: SignalKey, kind: Exclude<SensorFault, 'multiple'>) => {
    const v = truth[key]; affected.push(key);
    if (kind === 'dropout') signals[key] = null;
    else if (kind === 'bias') signals[key] = v + (key === 'altitude_ft' ? 2500 : key === 'speed_kt' ? 120 : 18);
    else if (kind === 'drift') signals[key] = v + (seq - Math.max(0, seed - FAULT_WINDOW) + 1) * (key === 'altitude_ft' ? 80 : key === 'speed_kt' ? 5 : 0.8);
    else if (kind === 'spike') signals[key] = v + (key === 'altitude_ft' ? 5000 : key === 'speed_kt' ? 250 : 35);
    else if (kind === 'noise') signals[key] = v + ((seq * 9301 + 49297) % 233 / 233 - 0.5) * (key === 'altitude_ft' ? 5000 : key === 'speed_kt' ? 240 : 35);
    else if (kind === 'normal_disturbance') signals[key] = v + Math.sin(seq * 0.71) * (key === 'altitude_ft' ? 120 : key === 'speed_kt' ? 4 : 0.4);
    else if (kind === 'frozen' && seq > Math.max(0, seed - FAULT_WINDOW)) signals[key] = truth[key];
  };
  if (fault === 'multiple') { apply('altitude_ft', 'drift'); apply('speed_kt', 'dropout'); }
  else if (fault !== 'message_disorder' && fault !== 'delayed') apply(selected, fault);
  return { signals, affected: [...new Set(affected)] };
}

export function classifyRows(rows: Omit<MonitorRow, 'state' | 'reasons' | 'cusumState' | 'cusumReasons' | 'processingMs'>[]): MonitorRow[] {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const frozenCounts: Record<SignalKey, number> = { altitude_ft: 0, speed_kt: 0, pitch_deg: 0, roll_deg: 0, yaw_deg: 0 };
  const positive: Record<SignalKey, number> = { altitude_ft: 0, speed_kt: 0, pitch_deg: 0, roll_deg: 0, yaw_deg: 0 };
  const negative: Record<SignalKey, number> = { altitude_ft: 0, speed_kt: 0, pitch_deg: 0, roll_deg: 0, yaw_deg: 0 };
  let persistence = 0;
  const classified = rows.map((r, i) => {
    const reasons: string[] = [];
    let unknown = r.telemetry.quality.missing_channels.length > 0 || r.telemetry.quality.stale || r.telemetry.quality.ordering !== 'in_order';
    let over = false;
    for (const key of SIGNALS) {
      const value = r.telemetry.signals[key];
      if (value === null) { unknown = true; reasons.push(`${key}:missing`); frozenCounts[key] = 0; continue; }
      const prev = i > 0 ? rows[i - 1].telemetry.signals[key] : null;
      frozenCounts[key] = prev === value ? frozenCounts[key] + 1 : 0;
      if (frozenCounts[key] >= 5) { over = true; reasons.push(`${key}:frozen_persistence`); }
      if (prev !== null && prev !== undefined && Math.abs(value - prev) > LIMITS[key]) { over = true; reasons.push(`${key}:step_threshold`); }
    }
    persistence = over ? persistence + 1 : 0;
    const state: DetectorState = unknown ? 'UNKNOWN_DEGRADED' : persistence >= 3 ? 'FAULT_INDICATED' : over ? 'SUSPECTED_FAULT' : 'NORMAL';
    if (unknown && !reasons.length) reasons.push('input_quality_invalid');
    const cusumReasons: string[] = [];
    let cusumUnknown = unknown;
    let cusumOver = false;
    for (const key of SIGNALS) {
      const value = r.telemetry.signals[key];
      if (value === null) { cusumUnknown = true; positive[key] = 0; negative[key] = 0; continue; }
      const history = rows.slice(Math.max(0, i - 5), i).map((x) => x.telemetry.signals[key]).filter((x): x is number => x !== null);
      if (history.length < 3) continue;
      const ordered = [...history].sort((a, b) => a - b);
      const baseline = ordered[Math.floor(ordered.length / 2)];
      const residual = value - baseline;
      const slack = LIMITS[key] * 0.25;
      positive[key] = Math.max(0, positive[key] + residual - slack);
      negative[key] = Math.max(0, negative[key] - residual - slack);
      if (positive[key] > LIMITS[key] * 2 || negative[key] > LIMITS[key] * 2) { cusumOver = true; cusumReasons.push(`${key}:cusum_residual`); }
    }
    const cusumState: DetectorState = cusumUnknown ? 'UNKNOWN_DEGRADED' : cusumOver ? 'FAULT_INDICATED' : 'NORMAL';
    return { ...r, state, reasons, cusumState, cusumReasons };
  });
  const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;
  return classified.map((r) => ({ ...r, processingMs: elapsed }));
}

export function makeAlerts(rows: MonitorRow[], runId: string): AlertRecord[] {
  const out: AlertRecord[] = [];
  rows.forEach((r, index) => {
    for (const detector of [
      { id: 'threshold-persistence', state: r.state, reasons: r.reasons },
      { id: 'median-residual-cusum', state: r.cusumState, reasons: r.cusumReasons },
    ]) {
      if (detector.state === 'NORMAL' || (detector.state === 'UNKNOWN_DEGRADED' && detector.reasons.length === 0)) continue;
      out.push({
        alert_id: `${runId}-${detector.id}-${r.telemetry.sequence}-${index}`, run_id: runId,
        start_time_utc: r.telemetry.timestamp_utc, end_time_utc: r.telemetry.timestamp_utc,
        affected_channels: SIGNALS.filter((k) => detector.reasons.some((reason) => reason.startsWith(k))),
        detector_id: detector.id, detector_version: '1.0', state: detector.state,
        fault_label: r.injectedFault ? 'SIMULATED_FAULT' : 'UNKNOWN', simulation_only: true, score: Math.min(1, detector.reasons.length / SIGNALS.length),
        confidence: null, uncertainty: detector.state === 'UNKNOWN_DEGRADED' ? 'INPUT_INVALID_OR_INCOMPLETE' : 'UNCALIBRATED_SCORE',
        reason_codes: detector.reasons, sample_range: { start: r.telemetry.sequence, end: r.telemetry.sequence }, raw_samples: [r.telemetry],
      });
    }
  });
  return out;
}

export function evaluate(rows: MonitorRow[], detector: 'threshold' | 'cusum' = 'threshold') {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const r of rows) {
    const expected = r.injectedFault;
    const state = detector === 'threshold' ? r.state : r.cusumState;
    const actual = state === 'SUSPECTED_FAULT' || state === 'FAULT_INDICATED';
    if (expected && actual) tp++; else if (!expected && actual) fp++; else if (expected) fn++; else tn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0;
  const elapsedHours = rows.length > 1 ? Math.max(0, (rows[rows.length - 1].telemetry.monotonic_ms - rows[0].telemetry.monotonic_ms) / 3_600_000) : 0;
  const onset = rows.findIndex((r) => r.injectedFault);
  const detected = rows.findIndex((r) => r.injectedFault && ((detector === 'threshold' ? r.state : r.cusumState) === 'SUSPECTED_FAULT' || (detector === 'threshold' ? r.state : r.cusumState) === 'FAULT_INDICATED'));
  const delay = onset >= 0 && detected >= 0 ? rows[detected].telemetry.monotonic_ms - rows[onset].telemetry.monotonic_ms : null;
  return { tp, fp, fn, tn, precision, recall, f1, falseAlarmsPerHour: fp / Math.max(elapsedHours, 1 / 3600), detectionDelayMs: delay, abstentionRate: rows.length ? rows.filter((r) => (detector === 'threshold' ? r.state : r.cusumState) === 'UNKNOWN_DEGRADED').length / rows.length : 0 };
}

