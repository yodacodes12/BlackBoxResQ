import { isCrcValid } from './record';
import type { RecoveryResult } from './recovery';
import type { SimState } from './simulation';
import type { FlightRecord, SourceId } from './types';

export type Health = 'online' | 'offline' | 'degraded' | 'failed';

export interface RecorderView {
  id: SourceId;
  health: Health;
  detail: string;
  lastValidTimestamp: string | null;
  valid: number;
  invalid: number;
  missing: number;
  duplicates: number;
  extra?: { label: string; value: string }[];
}

function tally(records: FlightRecord[], expected: number) {
  const seen = new Set<number>();
  let invalid = 0, duplicates = 0, last: string | null = null, lastSeq = -1;
  for (const r of records) {
    if (!isCrcValid(r)) { invalid++; continue; }
    if (r.sequence_id >= expected) continue;
    if (seen.has(r.sequence_id)) duplicates++;
    else seen.add(r.sequence_id);
    if (r.sequence_id > lastSeq) { lastSeq = r.sequence_id; last = r.timestamp; }
  }
  return { valid: seen.size, invalid, duplicates, last };
}

export function recorderViews(s: SimState): RecorderView[] {
  const idle = s.status === 'idle';
  const local = (id: 'PRIMARY' | 'BACKUP'): RecorderView => {
    const r = id === 'PRIMARY' ? s.primary : s.backup;
    const t = tally(r.records, s.tick);
    const missing = s.tick - t.valid;
    let health: Health, detail: string;
    if (r.state === 'failed') { health = 'failed'; detail = `${r.failReason} at t=${r.failedAtTick}s`; }
    else if (idle) { health = 'offline'; detail = 'Standby — not recording'; }
    else if (t.invalid > 0 || missing > 0) { health = 'degraded'; detail = 'Recording; invalid or missing records present'; }
    else { health = 'online'; detail = 'Recording normally'; }
    if (r.media === 'destroyed') { health = 'failed'; detail = 'Media unrecoverable (simulated hazard)'; }
    else if (r.media === 'degraded' && health !== 'failed') { health = 'degraded'; detail = 'Media degraded (simulated hazard)'; }
    return { id, health, detail, lastValidTimestamp: t.last, valid: t.valid, invalid: t.invalid, missing, duplicates: t.duplicates };
  };
  const rt = tally(s.remote.records, s.tick);
  const queued = s.remote.pending.length;
  let rh: Health, rd: string;
  if (s.power === 'lost') { rh = 'failed'; rd = 'Comms unit unpowered'; }
  else if (idle) { rh = 'offline'; rd = 'Standby'; }
  else if (!s.network.connected) { rh = 'offline'; rd = 'Link down — queueing for retransmission'; }
  else if (rt.invalid > 0) { rh = 'degraded'; rd = 'Invalid records in remote store'; }
  else { rh = 'online'; rd = 'Link up — transmitting batches'; }
  if (s.remote.media === 'destroyed') { rh = 'failed'; rd = 'Remote store unavailable'; }
  const remote: RecorderView = {
    id: 'REMOTE', health: rh, detail: rd, lastValidTimestamp: rt.last, valid: rt.valid, invalid: rt.invalid,
    missing: Math.max(0, s.tick - rt.valid - queued), duplicates: rt.duplicates,
    extra: [
      { label: 'Queued for transmission', value: String(queued) },
      { label: 'Batches acknowledged', value: String(s.remote.ackedBatches.length) },
    ],
  };
  return [local('PRIMARY'), local('BACKUP'), remote];
}

export interface IntegrityView { health: Health; detail: string }
export function integrityView(r: RecoveryResult, status: SimState['status']): IntegrityView {
  if (r.expected === 0 || status === 'idle') return { health: 'offline', detail: 'No records to verify yet' };
  const bad = r.counts.corrupted + r.counts.inconsistent;
  const crc = r.sourceStats.reduce((a, x) => a + x.crcFailures, 0);
  if (bad > 0) return { health: 'failed', detail: `${r.counts.corrupted} unrecoverable corrupted, ${r.counts.inconsistent} conflicting` };
  if (crc > 0 || r.duplicatesTotal > 0) return { health: 'degraded', detail: `${crc} CRC failure(s), ${r.duplicatesTotal} duplicate(s) — resolved by other copies` };
  return { health: 'online', detail: 'All stored copies pass CRC and agree' };
}

export function systemHealth(s: SimState): { health: Health; label: string } {
  if (s.status === 'idle') return { health: 'offline', label: 'Standby' };
  const views = recorderViews(s);
  const local = views.filter((v) => v.id !== 'REMOTE');
  if (local.every((v) => v.health === 'failed')) return { health: 'failed', label: 'Critical — no local recorder' };
  if (views.some((v) => v.health !== 'online')) return { health: 'degraded', label: 'Degraded' };
  return { health: 'online', label: 'Nominal' };
}

export const fmtTime = (sec: number) => {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = sec % 60;
  return [h, m, x].map((n) => String(n).padStart(2, '0')).join(':');
};
export const fmtPct = (v: number | null, d = 1) => (v === null ? '—' : `${v.toFixed(d)}%`);
export const fmtClock = (iso: string | null) => (iso ? iso.slice(11, 19) + 'Z' : '—');
