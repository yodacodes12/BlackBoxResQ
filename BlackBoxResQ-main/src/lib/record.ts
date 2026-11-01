import { crc32Hex } from './crc';
import type { FlightRecord } from './types';

export const round = (v: number, d: number): number => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};

type Payload = Omit<FlightRecord, 'source_id' | 'integrity_checksum'>;

/** Canonical payload string. Source id is excluded so copies from different sources share a checksum. */
export function payloadString(r: Payload): string {
  return [
    r.flight_id,
    r.sequence_id,
    r.timestamp,
    r.altitude.toFixed(1),
    r.speed.toFixed(1),
    r.pitch.toFixed(2),
    r.roll.toFixed(2),
    r.yaw.toFixed(1),
  ].join('|');
}

export const computeChecksum = (r: Payload): string => crc32Hex(payloadString(r));

const crcCache = new WeakMap<FlightRecord, boolean>();
/** True if the stored checksum matches the payload. Cached per (immutable) record object. */
export function isCrcValid(r: FlightRecord): boolean {
  let v = crcCache.get(r);
  if (v === undefined) {
    v = r.integrity_checksum.toLowerCase() === computeChecksum(r);
    crcCache.set(r, v);
  }
  return v;
}

export const withSource = (r: FlightRecord, source: string): FlightRecord => ({ ...r, source_id: source });

/** Simulated bit-rot: payload altered, checksum left stale, so CRC verification fails. */
export const corruptRecord = (r: FlightRecord): FlightRecord => ({ ...r, altitude: round(r.altitude + 137, 1) });

/** Simulated divergent copy: payload altered AND checksum recomputed, so CRC passes but content conflicts. */
export function divergentRecord(r: FlightRecord): FlightRecord {
  const d = { ...r, altitude: round(r.altitude + 90, 1) };
  return { ...d, integrity_checksum: computeChecksum(d) };
}

export type ParseResult = { ok: true; record: FlightRecord } | { ok: false; reason: string };

const NUM_FIELDS = ['altitude', 'speed', 'pitch', 'roll', 'yaw'] as const;

/** Structural validation of untrusted input. Never throws. */
export function parseRecord(u: unknown, expectedFlightId?: string): ParseResult {
  if (typeof u !== 'object' || u === null || Array.isArray(u)) return { ok: false, reason: 'not an object' };
  const o = u as Record<string, unknown>;
  if (typeof o.flight_id !== 'string' || !o.flight_id) return { ok: false, reason: 'flight_id missing' };
  if (expectedFlightId !== undefined && o.flight_id !== expectedFlightId) return { ok: false, reason: 'flight_id mismatch' };
  if (typeof o.sequence_id !== 'number' || !Number.isInteger(o.sequence_id) || o.sequence_id < 0)
    return { ok: false, reason: 'sequence_id invalid' };
  if (typeof o.timestamp !== 'string' || Number.isNaN(Date.parse(o.timestamp))) return { ok: false, reason: 'timestamp invalid' };
  for (const f of NUM_FIELDS) {
    const v = o[f];
    if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false, reason: `${f} invalid` };
  }
  if (typeof o.source_id !== 'string') return { ok: false, reason: 'source_id missing' };
  if (typeof o.integrity_checksum !== 'string' || !/^[0-9a-fA-F]{8}$/.test(o.integrity_checksum))
    return { ok: false, reason: 'checksum malformed' };
  return { ok: true, record: o as unknown as FlightRecord };
}
