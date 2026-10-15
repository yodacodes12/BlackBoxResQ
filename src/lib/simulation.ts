import { DEFAULT_CONFIG, generateTruth } from './generator';
import { corruptRecord, divergentRecord, withSource } from './record';
import { recover, type SourceInput } from './recovery';
import { STANDARD_LIMITATIONS, type RecoveryTest } from './reports';
import type { FlightConfig, FlightRecord, MediaState, SourceId } from './types';

export const BATCH_SIZE = 10;

export type RecorderRunState = 'standby' | 'recording' | 'failed';
export interface Recorder {
  state: RecorderRunState;
  failedAtTick: number | null;
  failReason: string | null;
  media: MediaState;
  records: FlightRecord[];
}
export interface Batch {
  id: number;
  seqs: number[];
  sentTick: number;
  ackTick: number;
}
export interface RemoteStore {
  media: MediaState;
  records: FlightRecord[]; // append-only log as received (duplicates from retransmission are kept)
  pending: number[]; // sequence ids queued on the aircraft awaiting (re)transmission
  inFlight: Batch[]; // delivered but not yet acknowledged
  ackedBatches: Batch[];
  nextBatchId: number;
  lastAckTick: number | null;
}
export type EventKind =
  | 'recording_started' | 'paused' | 'resumed' | 'reset' | 'ack' | 'network_interrupted' | 'network_restored'
  | 'recorder_failure' | 'power_loss' | 'corruption_injected' | 'conflict_injected' | 'records_dropped'
  | 'media_hazard' | 'recovery_completed' | 'flight_complete' | 'config' | 'info';
export type Severity = 'info' | 'success' | 'warning' | 'error';
export interface SimEvent {
  id: number;
  tick: number;
  kind: EventKind;
  severity: Severity;
  message: string;
}
export type SimStatus = 'idle' | 'running' | 'paused' | 'complete';

export interface SimState {
  config: FlightConfig;
  status: SimStatus;
  tick: number; // records generated so far == expected record count == elapsed flight seconds
  primary: Recorder;
  backup: Recorder;
  remote: RemoteStore;
  network: { connected: boolean };
  power: 'normal' | 'lost';
  events: SimEvent[];
  nextEventId: number;
  tests: RecoveryTest[];
}

export type Target = SourceId;
export type SimAction =
  | { type: 'START' } | { type: 'PAUSE' } | { type: 'RESUME' }
  | { type: 'RESET' } | { type: 'SET_CONFIG'; config: Partial<FlightConfig> }
  | { type: 'TICK'; n: number }
  | { type: 'DISABLE_RECORDER'; which: 'PRIMARY' | 'BACKUP' }
  | { type: 'DISCONNECT' } | { type: 'RESTORE' } | { type: 'POWER_LOSS' }
  | { type: 'INJECT_CORRUPT'; target: Target }
  | { type: 'INJECT_CONFLICT'; target: Target }
  | { type: 'DROP_RECORDS'; target: Target }
  | { type: 'APPLY_MEDIA'; target: Target; media: MediaState; reason: string }
  | { type: 'RUN_RECOVERY' }
  | { type: 'ADD_TEST'; test: Omit<RecoveryTest, 'id'> }
  | { type: 'REPLACE_TESTS'; tests: RecoveryTest[] };

const newRecorder = (): Recorder => ({ state: 'standby', failedAtTick: null, failReason: null, media: 'ok', records: [] });

export function initialState(config: FlightConfig = DEFAULT_CONFIG, tests: RecoveryTest[] = []): SimState {
  return {
    config,
    status: 'idle',
    tick: 0,
    primary: newRecorder(),
    backup: newRecorder(),
    remote: { media: 'ok', records: [], pending: [], inFlight: [], ackedBatches: [], nextBatchId: 1, lastAckTick: null },
    network: { connected: true },
    power: 'normal',
    events: [],
    nextEventId: 1,
    tests,
  };
}

function log(s: SimState, kind: EventKind, severity: Severity, message: string): SimState {
  const ev: SimEvent = { id: s.nextEventId, tick: s.tick, kind, severity, message };
  return { ...s, events: [...s.events, ev].slice(-1000), nextEventId: s.nextEventId + 1 };
}

function transmit(r: RemoteStore, seqs: number[], tick: number, cfg: FlightConfig): RemoteStore {
  if (seqs.length === 0) return r;
  const recs = seqs.map((q) => withSource(generateTruth(cfg, q), 'REMOTE'));
  const batch: Batch = { id: r.nextBatchId, seqs, sentTick: tick, ackTick: tick + 1 };
  return { ...r, records: [...r.records, ...recs], inFlight: [...r.inFlight, batch], nextBatchId: r.nextBatchId + 1 };
}

function step(s0: SimState): SimState {
  let s = s0;
  const seq = s.tick;
  const truth = generateTruth(s.config, seq);
  // Local recorders write independently of each other and of the network.
  if (s.primary.state === 'recording') s = { ...s, primary: { ...s.primary, records: [...s.primary.records, withSource(truth, 'PRIMARY')] } };
  if (s.backup.state === 'recording') s = { ...s, backup: { ...s.backup, records: [...s.backup.records, withSource(truth, 'BACKUP')] } };

  let remote = s.remote;
  const acks: Batch[] = [];
  if (s.power === 'normal') {
    remote = { ...remote, pending: [...remote.pending, seq] };
    if (s.network.connected) {
      const due = remote.inFlight.filter((b) => b.ackTick <= seq);
      if (due.length) {
        acks.push(...due);
        remote = { ...remote, inFlight: remote.inFlight.filter((b) => b.ackTick > seq), ackedBatches: [...remote.ackedBatches, ...due], lastAckTick: seq };
      }
      while (remote.pending.length >= BATCH_SIZE) {
        const seqs = remote.pending.slice(0, BATCH_SIZE);
        remote = { ...transmit(remote, seqs, seq, s.config), pending: remote.pending.slice(BATCH_SIZE) };
      }
    }
  }
  s = { ...s, remote, tick: seq + 1 };
  for (const b of acks)
    s = log({ ...s, tick: seq }, 'ack', 'success', `Remote copy acknowledged batch #${b.id} (seq ${b.seqs[0]}–${b.seqs[b.seqs.length - 1]})`);
  s = { ...s, tick: seq + 1 };
  if (s.tick >= s.config.durationSec) {
    s = log({ ...s, status: 'complete' }, 'flight_complete', 'info', `Simulated flight complete — ${s.tick} records generated`);
  }
  return s;
}

type Store = FlightRecord[];
function mapStore(s: SimState, t: Target, fn: (r: Store) => Store): SimState {
  if (t === 'PRIMARY') return { ...s, primary: { ...s.primary, records: fn(s.primary.records) } };
  if (t === 'BACKUP') return { ...s, backup: { ...s.backup, records: fn(s.backup.records) } };
  return { ...s, remote: { ...s.remote, records: fn(s.remote.records) } };
}
const storeOf = (s: SimState, t: Target): Store => (t === 'PRIMARY' ? s.primary.records : t === 'BACKUP' ? s.backup.records : s.remote.records);

/** Deterministic selection: within the last 60 records of a store, every 12th starting at `offset`. */
function pick(len: number, offset: number): Set<number> {
  const out = new Set<number>();
  for (let i = Math.max(0, len - 60) + offset; i < len; i += 12) out.add(i);
  return out;
}

export function sourcesOf(s: SimState): { id: SourceId; media: MediaState; records: FlightRecord[] }[] {
  return [
    { id: 'PRIMARY', media: s.primary.media, records: s.primary.records },
    { id: 'BACKUP', media: s.backup.media, records: s.backup.records },
    { id: 'REMOTE', media: s.remote.media, records: s.remote.records },
  ];
}

/** Builds a recovery input from the sources whose media is not destroyed (and optionally a user selection). */
export function datasetsFromState(s: SimState, include?: SourceId[]): SourceInput[] {
  return sourcesOf(s)
    .filter((x) => x.media !== 'destroyed' && (!include || include.includes(x.id)))
    .map((x) => ({ sourceId: x.id, records: x.records }));
}

export function buildTest(s: SimState, scenarioId: string, scenarioName: string, assumptions: string[], include?: SourceId[]): Omit<RecoveryTest, 'id'> {
  const inputs = datasetsFromState(s, include);
  const result = recover(inputs, s.tick, s.config.flightId);
  const used = inputs.map((i) => i.sourceId);
  const unavailable = sourcesOf(s)
    .filter((x) => !used.includes(x.id))
    .map((x) => ({ source: x.id, reason: x.media === 'destroyed' ? 'Media unrecoverable (simulated)' : 'Excluded by operator' }));
  return {
    scenarioId, scenarioName, flightId: s.config.flightId, seed: s.config.seed, flightTimeSec: s.tick,
    assumptions, sourcesIncluded: used, sourcesUnavailable: unavailable, result, limitations: STANDARD_LIMITATIONS,
  };
}

export const LIVE_ASSUMPTIONS = [
  'Disabling a recorder stops new writes; records already stored remain readable unless media is marked destroyed.',
  'Abrupt power loss fails the primary recorder (last 2 writes torn) and the main-bus comms unit (queued/unacknowledged data lost); the backup has independent power.',
  'The remote copy is an append-only log; retransmitted batches create duplicates that recovery detects.',
  'Remote batches of 10 records are sent when the link is up; a batch is acknowledged one tick after delivery.',
];

function addTest(s: SimState, t: Omit<RecoveryTest, 'id'>): SimState {
  const id = `RT-${String(s.tests.length + 1).padStart(3, '0')}`;
  return { ...s, tests: [...s.tests, { ...t, id }] };
}

export function simReducer(s: SimState, a: SimAction): SimState {
  switch (a.type) {
    case 'START': {
      if (s.status !== 'idle') return s;
      const rec = (r: Recorder): Recorder => (r.state === 'failed' ? r : { ...r, state: 'recording' });
      return log({ ...s, status: 'running', primary: rec(s.primary), backup: rec(s.backup) }, 'recording_started', 'info', `Recording started — flight ${s.config.flightId}`);
    }
    case 'PAUSE':
      return s.status === 'running' ? log({ ...s, status: 'paused' }, 'paused', 'info', 'Simulation paused') : s;
    case 'RESUME':
      return s.status === 'paused' ? log({ ...s, status: 'running' }, 'resumed', 'info', 'Simulation resumed') : s;
    case 'RESET':
      return log(initialState(s.config, s.tests), 'reset', 'info', `Simulation reset to seed ${s.config.seed}`);
    case 'SET_CONFIG':
      if (s.status !== 'idle') return s;
      return log(initialState({ ...s.config, ...a.config }, s.tests), 'config', 'info', 'Flight configuration updated');
    case 'TICK': {
      let n = s;
      for (let i = 0; i < a.n && n.status === 'running'; i++) n = step(n);
      return n;
    }
    case 'DISABLE_RECORDER': {
      const key = a.which === 'PRIMARY' ? 'primary' : 'backup';
      const r = s[key];
      if (r.state === 'failed') return s;
      const label = a.which === 'PRIMARY' ? 'Primary' : 'Backup';
      return log({ ...s, [key]: { ...r, state: 'failed', failedAtTick: s.tick, failReason: 'Disabled by operator' } }, 'recorder_failure', 'error', `${label} recorder failure simulated at t=${s.tick}s — no further writes`);
    }
    case 'DISCONNECT':
      if (!s.network.connected) return s;
      return log({ ...s, network: { connected: false } }, 'network_interrupted', 'warning', 'Network interrupted — local recording continues; records queued for retransmission');
    case 'RESTORE': {
      if (s.network.connected) return s;
      let n: SimState = { ...s, network: { connected: true } };
      if (s.power === 'lost') return log(n, 'network_restored', 'warning', 'Link restored but comms unit has no power — nothing transmitted');
      const resend = n.remote.inFlight.flatMap((b) => b.seqs);
      const queue = [...resend, ...n.remote.pending];
      let remote: RemoteStore = { ...n.remote, inFlight: [], pending: [] };
      for (let i = 0; i < queue.length; i += BATCH_SIZE) remote = transmit(remote, queue.slice(i, i + BATCH_SIZE), n.tick, n.config);
      n = { ...n, remote };
      return log(n, 'network_restored', 'success', `Communications restored — ${queue.length} queued record(s) retransmitted${resend.length ? ` (${resend.length} previously unacknowledged)` : ''}`);
    }
    case 'POWER_LOSS': {
      if (s.power === 'lost') return s;
      let n: SimState = { ...s, power: 'lost', remote: { ...s.remote, pending: [], inFlight: [] } };
      if (n.primary.state !== 'failed') {
        const recs = n.primary.records.map((r, i, arr) => (i >= arr.length - 2 ? corruptRecord(r) : r));
        n = { ...n, primary: { ...n.primary, state: 'failed', failedAtTick: n.tick, failReason: 'Abrupt power loss', records: recs } };
      }
      return log(n, 'power_loss', 'error', 'Abrupt power loss — primary failed with torn tail writes; comms queue lost; backup unaffected');
    }
    case 'INJECT_CORRUPT': {
      const idx = pick(storeOf(s, a.target).length, 0);
      if (idx.size === 0) return log(s, 'info', 'warning', `Not enough ${a.target} records to inject corruption`);
      return log(mapStore(s, a.target, (r) => r.map((x, i) => (idx.has(i) ? corruptRecord(x) : x))), 'corruption_injected', 'warning', `Injected ${idx.size} CRC-failing record(s) into ${a.target}`);
    }
    case 'INJECT_CONFLICT': {
      const idx = pick(storeOf(s, a.target).length, 6);
      if (idx.size === 0) return log(s, 'info', 'warning', `Not enough ${a.target} records to inject a conflict`);
      return log(mapStore(s, a.target, (r) => r.map((x, i) => (idx.has(i) ? divergentRecord(x) : x))), 'conflict_injected', 'warning', `Injected ${idx.size} divergent CRC-valid record(s) into ${a.target}`);
    }
    case 'DROP_RECORDS': {
      const len = storeOf(s, a.target).length;
      if (len < 30) return log(s, 'info', 'warning', `Not enough ${a.target} records to simulate a gap (need 30)`);
      return log(mapStore(s, a.target, (r) => [...r.slice(0, len - 30), ...r.slice(len - 20)]), 'records_dropped', 'warning', `Removed 10 contiguous records from ${a.target}`);
    }
    case 'APPLY_MEDIA': {
      let n = s;
      if (a.media === 'degraded' && a.target !== 'REMOTE') {
        const mod = a.target === 'PRIMARY' ? 17 : 19;
        const rem = a.target === 'PRIMARY' ? 3 : 5;
        n = mapStore(n, a.target, (r) => r.map((x) => (x.sequence_id % mod === rem ? corruptRecord(x) : x)));
      }
      n = a.target === 'PRIMARY' ? { ...n, primary: { ...n.primary, media: a.media } } : a.target === 'BACKUP' ? { ...n, backup: { ...n.backup, media: a.media } } : { ...n, remote: { ...n.remote, media: a.media } };
      return log(n, 'media_hazard', a.media === 'ok' ? 'info' : 'error', `${a.target} media ${a.media}: ${a.reason}`);
    }
    case 'RUN_RECOVERY': {
      const t = buildTest(s, 'live', 'Live Failure Lab session', LIVE_ASSUMPTIONS);
      const n = addTest(s, t);
      return log(n, 'recovery_completed', 'success', `Recovery completed (${n.tests[n.tests.length - 1].id}): ${t.result.counts.validated}/${t.result.expected} validated`);
    }
    case 'ADD_TEST':
      return addTest(s, a.test);
    case 'REPLACE_TESTS':
      return { ...s, tests: a.tests };
  }
}
