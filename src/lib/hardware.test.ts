import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, generateTruth } from './generator';
import { ACK_LEN, RECORD_LEN, SimulatedRecorderSource, decodeAckFrame, decodeRecordFrame, encodeAckFrame, encodeRecordFrame, toHex } from './hardware';
import { computeChecksum } from './record';
import { recover } from './recovery';
import { initialState, simReducer } from './simulation';
import type { FlightRecord } from './types';

const golden: FlightRecord = {
  flight_id: 'BBQ-SIM-0001', sequence_id: 42, timestamp: '2026-01-01T10:00:42.000Z',
  altitude: 12345.6, speed: 321.5, pitch: -2.25, roll: 12.5, yaw: 270.4, source_id: 'PRIMARY', integrity_checksum: '',
};
// Same bytes are asserted in backend/tests/test_protocol.py
export const GOLDEN_RECORD_HEX = 'b1ac0101014242512d53494d2d303030312a000000109d00799b01000040e201008f0c1fffe204900a145de7c7';

describe('wire protocol', () => {
  it('frame sizes', () => expect([encodeRecordFrame(golden, 'PRIMARY').length, encodeAckFrame({ sender: 'REMOTE', batchId: 1, firstSeq: 0, lastSeq: 9 }).length]).toEqual([RECORD_LEN, ACK_LEN]));
  it('matches golden vector shared with the Python decoder', () => expect(toHex(encodeRecordFrame(golden, 'PRIMARY'))).toBe(GOLDEN_RECORD_HEX));
  it('round-trips every record of the synthetic flight exactly and checksums match the canonical form', () => {
    for (let i = 0; i < DEFAULT_CONFIG.durationSec; i++) {
      const t = generateTruth(DEFAULT_CONFIG, i);
      const d = decodeRecordFrame(encodeRecordFrame(t, 'BACKUP'));
      expect(d.ok).toBe(true);
      if (d.ok) {
        expect(d.value).toEqual({ ...t, source_id: 'BACKUP' });
        expect(d.value.integrity_checksum).toBe(computeChecksum(t));
      }
    }
  });
  it('rejects corrupted, truncated, wrong-magic and wrong-version frames without throwing', () => {
    const f = encodeRecordFrame(golden, 'PRIMARY');
    const flip = (i: number, v: number) => { const c = f.slice(); c[i] = v; return c; };
    expect(decodeRecordFrame(flip(20, f[20] ^ 1))).toEqual({ ok: false, error: 'crc mismatch' });
    expect(decodeRecordFrame(f.slice(0, 44))).toMatchObject({ ok: false });
    expect(decodeRecordFrame(flip(0, 0))).toEqual({ ok: false, error: 'bad magic' });
    expect(decodeRecordFrame(flip(2, 9))).toEqual({ ok: false, error: 'unsupported version 9' });
    expect(decodeRecordFrame(new Uint8Array(0))).toMatchObject({ ok: false });
    expect(decodeAckFrame(f)).toMatchObject({ ok: false });
  });
  it('refuses to encode unrepresentable values', () => {
    expect(() => encodeRecordFrame({ ...golden, flight_id: 'THIS-IS-TOO-LONG' }, 'PRIMARY')).toThrow(RangeError);
    expect(() => encodeRecordFrame({ ...golden, speed: -5 }, 'PRIMARY')).toThrow(RangeError);
    expect(() => encodeRecordFrame({ ...golden, altitude: NaN }, 'PRIMARY')).toThrow(RangeError);
  });
  it('ack round trip', () => {
    const a = { sender: 'REMOTE' as const, batchId: 7, firstSeq: 10, lastSeq: 19 };
    expect(decodeAckFrame(encodeAckFrame(a))).toEqual({ ok: true, value: a });
  });
});

describe('RecorderSource (simulated)', () => {
  it('feeds the recovery engine through the hardware interface', async () => {
    let s = simReducer(initialState({ ...DEFAULT_CONFIG, durationSec: 15 }), { type: 'START' });
    s = simReducer(s, { type: 'TICK', n: 15 });
    const p = new SimulatedRecorderSource('PRIMARY', () => s);
    expect(p.kind).toBe('simulated');
    const r = recover([{ sourceId: 'PRIMARY', records: await p.readRecords() }], 15, DEFAULT_CONFIG.flightId);
    expect(r.counts.validated).toBe(15);
  });
});
