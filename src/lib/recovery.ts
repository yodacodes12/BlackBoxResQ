import { isCrcValid, parseRecord, payloadString } from './record';
import type { FlightRecord } from './types';

export interface SourceInput {
  sourceId: string;
  records: unknown[];
}

export type RecStatus = 'validated' | 'inconsistent' | 'missing' | 'corrupted';

export interface SourceStats {
  sourceId: string;
  total: number;
  valid: number; // distinct sequence ids with at least one CRC-valid record in range
  crcFailures: number;
  malformed: number;
  duplicates: number;
  outOfRange: number;
  missing: number; // expected sequence ids with no CRC-valid record from this source
}

export interface RecoveredRow {
  sequence_id: number;
  status: RecStatus;
  source_used: string | null;
  sources_agreeing: string[];
  sources_conflicting: string[];
  record: FlightRecord | null;
  note: string;
}

export interface Conflict {
  sequence_id: number;
  variants: { sources: string[]; record: FlightRecord }[];
  fields: string[];
}

export interface Range {
  start: number;
  end: number;
  length: number;
}

export interface RecoveryResult {
  flightId: string;
  expected: number;
  rows: RecoveredRow[];
  counts: Record<RecStatus, number>;
  recoveryPct: number | null; // validated / expected
  recoveryInclInconsistentPct: number | null;
  lossPct: number | null; // (missing + corrupted) / expected
  sourceStats: SourceStats[];
  conflicts: Conflict[];
  missingRanges: Range[];
  corruptedRanges: Range[];
  duplicatesTotal: number;
  malformedTotal: number;
  malformedSamples: string[];
  chronologyWarnings: number;
  durationMs: number;
}

const PRIORITY = ['PRIMARY', 'BACKUP', 'REMOTE'];
const prio = (s: string) => {
  const i = PRIORITY.indexOf(s);
  return i === -1 ? PRIORITY.length : i;
};
const FIELDS = ['timestamp', 'altitude', 'speed', 'pitch', 'roll', 'yaw'] as const;

export function toRanges(rows: RecoveredRow[], status: RecStatus): Range[] {
  const out: Range[] = [];
  for (const r of rows) {
    if (r.status !== status) continue;
    const last = out[out.length - 1];
    if (last && last.end === r.sequence_id - 1) {
      last.end = r.sequence_id;
      last.length++;
    } else out.push({ start: r.sequence_id, end: r.sequence_id, length: 1 });
  }
  return out;
}

const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : null);

/**
 * Merge surviving datasets into one reconstructed timeline of `expected` sequence ids (0..expected-1).
 * Never invents data: a sequence id with no CRC-valid copy is reported as missing or corrupted.
 * Conflicting valid copies are flagged `inconsistent` and every variant is retained in `conflicts`.
 */
export function recover(inputs: SourceInput[], expected: number, flightId: string): RecoveryResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const sources = [...inputs].sort((a, b) => prio(a.sourceId) - prio(b.sourceId));
  const exp = Math.max(0, Math.floor(expected));

  // seq -> payloadKey -> {record, sources}
  const valid: Map<number, Map<string, { record: FlightRecord; sources: string[] }>> = new Map();
  const badSeqs = new Set<number>();
  const stats: SourceStats[] = [];
  const malformedSamples: string[] = [];

  for (const src of sources) {
    const st: SourceStats = {
      sourceId: src.sourceId, total: src.records.length, valid: 0, crcFailures: 0,
      malformed: 0, duplicates: 0, outOfRange: 0, missing: 0,
    };
    const perSeq = new Map<number, FlightRecord[]>();
    for (const raw of src.records) {
      const p = parseRecord(raw, flightId);
      if (!p.ok) {
        st.malformed++;
        if (malformedSamples.length < 5) malformedSamples.push(`${src.sourceId}: ${p.reason}`);
        continue;
      }
      if (p.record.sequence_id >= exp) {
        st.outOfRange++;
        continue;
      }
      const arr = perSeq.get(p.record.sequence_id);
      if (arr) arr.push(p.record);
      else perSeq.set(p.record.sequence_id, [p.record]);
    }
    for (const [seq, copies] of perSeq) {
      st.duplicates += copies.length - 1;
      let anyValid = false;
      const seenKeys = new Set<string>();
      for (const c of copies) {
        if (!isCrcValid(c)) {
          st.crcFailures++;
          continue;
        }
        anyValid = true;
        const key = payloadString(c) + '#' + c.integrity_checksum.toLowerCase();
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        let byKey = valid.get(seq);
        if (!byKey) valid.set(seq, (byKey = new Map()));
        const slot = byKey.get(key);
        if (slot) {
          if (!slot.sources.includes(src.sourceId)) slot.sources.push(src.sourceId);
        } else byKey.set(key, { record: c, sources: [src.sourceId] });
      }
      if (anyValid) st.valid++;
      else badSeqs.add(seq);
    }
    st.missing = exp - st.valid;
    stats.push(st);
  }

  const rows: RecoveredRow[] = [];
  const conflicts: Conflict[] = [];
  const counts: Record<RecStatus, number> = { validated: 0, inconsistent: 0, missing: 0, corrupted: 0 };
  let chronologyWarnings = 0;
  let prevTs = -Infinity;

  for (let seq = 0; seq < exp; seq++) {
    const byKey = valid.get(seq);
    let row: RecoveredRow;
    if (!byKey || byKey.size === 0) {
      const corrupted = badSeqs.has(seq);
      row = {
        sequence_id: seq, status: corrupted ? 'corrupted' : 'missing', source_used: null,
        sources_agreeing: [], sources_conflicting: [], record: null,
        note: corrupted ? 'All surviving copies failed CRC verification' : 'No surviving copy',
      };
    } else {
      const variants = [...byKey.values()].map((v) => ({ ...v, sources: [...v.sources].sort((a, b) => prio(a) - prio(b)) }));
      variants.sort((a, b) => prio(a.sources[0]) - prio(b.sources[0]));
      const best = variants[0];
      if (variants.length === 1) {
        row = {
          sequence_id: seq, status: 'validated', source_used: best.sources[0], sources_agreeing: best.sources,
          sources_conflicting: [], record: best.record,
          note: best.sources.length > 1 ? 'Copies agree' : 'Single CRC-valid copy',
        };
      } else {
        const fields = FIELDS.filter((f) => new Set(variants.map((v) => v.record[f])).size > 1);
        conflicts.push({ sequence_id: seq, variants: variants.map((v) => ({ sources: v.sources, record: v.record })), fields: [...fields] });
        row = {
          sequence_id: seq, status: 'inconsistent', source_used: best.sources[0], sources_agreeing: best.sources,
          sources_conflicting: variants.slice(1).flatMap((v) => v.sources),
          record: best.record,
          note: `Valid copies disagree on ${fields.join(', ')}; shown value is the highest-priority source and is UNRESOLVED`,
        };
      }
      if (row.record) {
        const ts = Date.parse(row.record.timestamp);
        if (ts <= prevTs) {
          chronologyWarnings++;
          row.note += '; timestamp not later than previous recovered record';
        }
        prevTs = ts;
      }
    }
    counts[row.status]++;
    rows.push(row);
  }

  const duplicatesTotal = stats.reduce((a, s) => a + s.duplicates, 0);
  const malformedTotal = stats.reduce((a, s) => a + s.malformed, 0);
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    flightId, expected: exp, rows, counts,
    recoveryPct: pct(counts.validated, exp),
    recoveryInclInconsistentPct: pct(counts.validated + counts.inconsistent, exp),
    lossPct: pct(counts.missing + counts.corrupted, exp),
    sourceStats: stats, conflicts,
    missingRanges: toRanges(rows, 'missing'), corruptedRanges: toRanges(rows, 'corrupted'),
    duplicatesTotal, malformedTotal, malformedSamples, chronologyWarnings,
    durationMs: now - t0,
  };
}
