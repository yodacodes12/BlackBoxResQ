import { describe, expect, it } from 'vitest';
import { crc32Hex } from './crc';
import { DEFAULT_CONFIG, generateTruth } from './generator';
import { computeChecksum, corruptRecord, divergentRecord, isCrcValid, withSource } from './record';
import { recover } from './recovery';
import { reconstructedCsv } from './csv';
import { initialState, simReducer, datasetsFromState, type SimAction, type SimState } from './simulation';
import { SCENARIOS, runScenario, scenarioById } from './scenarios';

const cfg = { ...DEFAULT_CONFIG, durationSec: 20 };
const truth = (i: number) => generateTruth(cfg, i);
const copy = (i: number, src: string) => withSource(truth(i), src);
const run = (s: SimState, ...acts: SimAction[]) => acts.reduce(simReducer, s);
const started = (c = cfg) => run(initialState(c), { type: 'START' });

describe('crc / records', () => {
  it('matches the CRC-32 check value', () => expect(crc32Hex('123456789')).toBe('cbf43926'));
  it('generated records verify; corrupted fail; divergent pass CRC but differ', () => {
    const r = truth(3);
    expect(isCrcValid(r)).toBe(true);
    expect(isCrcValid(corruptRecord(r))).toBe(false);
    const d = divergentRecord(r);
    expect(isCrcValid(d)).toBe(true);
    expect(d.altitude).not.toBe(r.altitude);
    expect(computeChecksum(d)).not.toBe(computeChecksum(r));
  });
  it('generator is deterministic and seed-sensitive', () => {
    expect(generateTruth(cfg, 7)).toEqual(generateTruth(cfg, 7));
    expect(generateTruth({ ...cfg, seed: 1 }, 7).altitude).not.toBe(generateTruth(cfg, 7).altitude);
  });
});

describe('recovery engine with known dataset', () => {
  // expected 10. primary: 0-9 minus 3 (missing), 5 corrupted, 7 duplicated.
  // backup: 3, 5, 8 (conflicting), 9 ; remote: 0,1,2,4,6
  const primary = [0, 1, 2, 4, 5, 6, 7, 7, 8, 9].map((i) => (i === 5 ? corruptRecord(copy(i, 'PRIMARY')) : copy(i, 'PRIMARY')));
  const backup = [3, 5, 8, 9].map((i) => (i === 8 ? divergentRecord(copy(i, 'BACKUP')) : copy(i, 'BACKUP')));
  const remote = [0, 1, 2, 4, 6].map((i) => copy(i, 'REMOTE'));
  const res = recover([{ sourceId: 'REMOTE', records: remote }, { sourceId: 'PRIMARY', records: primary }, { sourceId: 'BACKUP', records: backup }], 10, cfg.flightId);

  it('classifies every sequence id', () => {
    expect(res.counts).toEqual({ validated: 9, inconsistent: 1, missing: 0, corrupted: 0 });
    expect(res.rows.map((r) => r.status)[8]).toBe('inconsistent');
  });
  it('uses priority source and records which source supplied each row', () => {
    expect(res.rows[3].source_used).toBe('BACKUP'); // only backup holds seq 3
    expect(res.rows[5].source_used).toBe('BACKUP'); // primary copy corrupted
    expect(res.rows[0].sources_agreeing).toEqual(['PRIMARY', 'REMOTE']);
  });
  it('detects duplicates, CRC failures, conflicts', () => {
    expect(res.duplicatesTotal).toBe(1);
    expect(res.sourceStats.find((s) => s.sourceId === 'PRIMARY')!.crcFailures).toBe(1);
    expect(res.conflicts).toHaveLength(1);
    expect(res.conflicts[0].fields).toEqual(['altitude']);
    expect(res.rows[8].sources_conflicting).toEqual(['BACKUP']);
  });
  it('percentages computed from counts', () => {
    expect(res.recoveryPct).toBeCloseTo(90);
    expect(res.recoveryInclInconsistentPct).toBeCloseTo(100);
    expect(res.lossPct).toBe(0);
  });
  it('reports missing and corrupted without inventing data', () => {
    const r = recover([{ sourceId: 'PRIMARY', records: [0, 1, 4, 5].map((i) => (i === 5 ? corruptRecord(copy(i, 'PRIMARY')) : copy(i, 'PRIMARY'))) }], 8, cfg.flightId);
    expect(r.counts).toEqual({ validated: 3, inconsistent: 0, missing: 4, corrupted: 1 });
    expect(r.missingRanges).toEqual([{ start: 2, end: 3, length: 2 }, { start: 6, end: 7, length: 2 }]);
    expect(r.corruptedRanges).toEqual([{ start: 5, end: 5, length: 1 }]);
    expect(r.rows[2].record).toBeNull();
    expect(r.lossPct).toBeCloseTo(62.5);
    const csv = reconstructedCsv(r.rows).split('\r\n');
    expect(csv[0]).toContain('sequence_id,timestamp,status');
    expect(csv[1 + 2]).toMatch(/^2,,missing,,,/); // empty values for missing
    expect(csv).toHaveLength(8 + 2);
  });
  it('handles empty datasets and malformed records', () => {
    expect(recover([], 0, 'X').recoveryPct).toBeNull();
    const e = recover([{ sourceId: 'PRIMARY', records: [] }], 5, cfg.flightId);
    expect(e.counts.missing).toBe(5);
    const bad = recover([{ sourceId: 'PRIMARY', records: [null, 42, 'x', {}, { ...copy(0, 'PRIMARY'), altitude: NaN }, { ...copy(1, 'PRIMARY'), flight_id: 'OTHER' }, { ...copy(2, 'PRIMARY'), integrity_checksum: 'zz' }, copy(3, 'PRIMARY'), copy(99, 'PRIMARY')] }], 5, cfg.flightId);
    expect(bad.malformedTotal).toBe(7);
    expect(bad.counts.validated).toBe(1);
    expect(bad.sourceStats[0].outOfRange).toBe(1);
  });
});

describe('simulation behaviour', () => {
  const ticks = (s: SimState, n: number) => run(s, { type: 'TICK', n });
  it('is reproducible after reset', () => {
    const a = ticks(started(), 12);
    const b = ticks(run(a, { type: 'RESET' }, { type: 'START' }), 12);
    expect(b.primary.records).toEqual(a.primary.records);
    expect(b.remote.records).toEqual(a.remote.records);
  });
  it('does not tick unless running', () => {
    expect(ticks(initialState(cfg), 5).tick).toBe(0);
    expect(ticks(run(started(), { type: 'PAUSE' }), 5).tick).toBe(0);
  });
  it('network loss does not stop local recording and queues records', () => {
    const s = ticks(run(ticks(started(), 5), { type: 'DISCONNECT' }), 10);
    expect(s.primary.records).toHaveLength(15);
    expect(s.backup.records).toHaveLength(15);
    expect(s.remote.pending.length).toBeGreaterThan(0);
    expect(s.remote.records.length).toBeLessThan(15);
  });
  it('restore retransmits the queue and creates duplicates only for the unacked batch', () => {
    const s = ticks(run(ticks(started(), 10), { type: 'DISCONNECT' }), 8); // batch of 10 sent at t=9, unacked
    const r = ticks(run(s, { type: 'RESTORE' }), 1);
    const seqs = r.remote.records.map((x) => x.sequence_id);
    expect(new Set(seqs).size).toBe(18);
    expect(seqs.length - new Set(seqs).size).toBe(10);
    const rec = recover(datasetsFromState(r, ['REMOTE']), r.tick, cfg.flightId);
    expect(rec.duplicatesTotal).toBe(10);
    expect(rec.counts.validated).toBe(18);
  });
  it('failed recorders stop accepting records; others unaffected', () => {
    const s = ticks(run(ticks(started(), 5), { type: 'DISABLE_RECORDER', which: 'PRIMARY' }), 5);
    expect(s.primary.records).toHaveLength(5);
    expect(s.backup.records).toHaveLength(10);
    const t = ticks(run(ticks(started(), 5), { type: 'DISABLE_RECORDER', which: 'BACKUP' }), 5);
    expect(t.primary.records).toHaveLength(10);
    expect(t.backup.records).toHaveLength(5);
  });
  it('power loss fails primary with torn tail, keeps backup running, clears comms queue', () => {
    const s = ticks(run(ticks(started(), 14), { type: 'POWER_LOSS' }), 4);
    expect(s.primary.state).toBe('failed');
    expect(s.primary.records.filter((r) => !isCrcValid(r))).toHaveLength(2);
    expect(s.backup.records).toHaveLength(18);
    expect(s.remote.pending).toEqual([]);
    expect(s.remote.records.length).toBe(10);
  });
  it('recovery uses only available sources and failed sources do not contribute later records', () => {
    const s = ticks(run(ticks(started(), 10), { type: 'DISABLE_RECORDER', which: 'PRIMARY' }, { type: 'DISABLE_RECORDER', which: 'BACKUP' }, { type: 'DISCONNECT' }), 10);
    const rec = recover(datasetsFromState(s), s.tick, cfg.flightId);
    expect(rec.counts.validated).toBeLessThanOrEqual(10);
    expect(rec.rows.slice(10).every((r) => r.status === 'missing')).toBe(true);
    const destroyed = run(s, { type: 'APPLY_MEDIA', target: 'PRIMARY', media: 'destroyed', reason: 't' });
    expect(datasetsFromState(destroyed).map((d) => d.sourceId)).not.toContain('PRIMARY');
  });
  it('fault injection is detected, not hidden', () => {
    const s = ticks(started({ ...cfg, durationSec: 40 }), 40);
    const c = run(s, { type: 'INJECT_CORRUPT', target: 'PRIMARY' }, { type: 'DROP_RECORDS', target: 'BACKUP' }, { type: 'INJECT_CONFLICT', target: 'REMOTE' });
    const r = recover(datasetsFromState(c), c.tick, cfg.flightId);
    expect(r.sourceStats.find((x) => x.sourceId === 'PRIMARY')!.crcFailures).toBeGreaterThan(0);
    expect(r.sourceStats.find((x) => x.sourceId === 'BACKUP')!.missing).toBe(10);
    expect(r.counts.inconsistent).toBeGreaterThan(0);
  });
});

describe('scenarios', () => {
  const full = (id: string) => { const s = runScenario(scenarioById(id)!); return { s, r: recover(datasetsFromState(s), s.tick, s.config.flightId) }; };
  it('all scenarios run deterministically', () => {
    for (const sc of SCENARIOS) expect(runScenario(sc).primary.records).toEqual(runScenario(sc).primary.records);
  });
  it('nominal recovers 100%', () => expect(full('nominal').r.recoveryPct).toBe(100));
  it('primary storage failure leaves backup and remote copies available', () => {
    const { s, r } = full('primary-media-unavailable');
    expect(s.primary.media).toBe('destroyed');
    expect(r.recoveryPct).toBe(100);
  });
  it('both local media unavailable leaves only partial remote data', () => {
    const { s, r } = full('both-local-media-unavailable');
    expect(s.primary.media).toBe('destroyed');
    expect(s.backup.media).toBe('destroyed');
    expect(r.counts.validated).toBeGreaterThan(0);
    expect(r.counts.validated).toBe(150); // disconnect at t=150 falls on a 10-record batch boundary
    expect(r.counts.missing).toBe(600 - r.counts.validated);
  });
  it('local storage corruption degrades both local copies but merged recovery is complete', () => {
    const { s, r } = full('local-storage-degraded');
    expect(s.primary.media).toBe('degraded');
    expect(r.sourceStats.find((x) => x.sourceId === 'PRIMARY')!.crcFailures).toBeGreaterThan(0);
    expect(r.counts.corrupted).toBe(0);
  });
});
