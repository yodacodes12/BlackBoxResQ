/**
 * Hardware-readiness layer (Phase 6). INTERFACES AND CODEC ONLY.
 * No ESP32 transport, serial port or network link is implemented or tested against real hardware.
 * Wire format is specified in docs/PROTOCOL.md and mirrored by backend/app/protocol.py.
 */
import { crc32Bytes } from './crc';
import { computeChecksum } from './record';
import type { SimState } from './simulation';
import type { FlightRecord, SourceId } from './types';

export const MAGIC = [0xb1, 0xac] as const;
export const PROTOCOL_VERSION = 1;
export const TYPE_RECORD = 1;
export const TYPE_ACK = 2;
export const RECORD_LEN = 45;
export const ACK_LEN = 21;
export const RECORDER_CODES: Record<SourceId, number> = { PRIMARY: 1, BACKUP: 2, REMOTE: 3 };
const NAMES: Record<number, SourceId> = { 1: 'PRIMARY', 2: 'BACKUP', 3: 'REMOTE' };

export type DecodeResult<T> = { ok: true; value: T } | { ok: false; error: string };
export interface AckFrame { sender: SourceId; batchId: number; firstSeq: number; lastSeq: number }

function checkRange(name: string, v: number, lo: number, hi: number): number {
  const q = Math.round(v);
  if (!Number.isFinite(q) || q < lo || q > hi) throw new RangeError(`${name} out of wire range`);
  return q;
}

/** Encode one record into the 45-byte little-endian frame. Throws RangeError if a value cannot be represented. */
export function encodeRecordFrame(r: FlightRecord, recorder: 'PRIMARY' | 'BACKUP'): Uint8Array {
  if (!/^[\x20-\x7e]{1,12}$/.test(r.flight_id)) throw new RangeError('flight_id must be 1–12 printable ASCII chars');
  const buf = new Uint8Array(RECORD_LEN);
  const v = new DataView(buf.buffer);
  buf.set(MAGIC, 0);
  buf[2] = PROTOCOL_VERSION;
  buf[3] = TYPE_RECORD;
  buf[4] = RECORDER_CODES[recorder];
  for (let i = 0; i < r.flight_id.length; i++) buf[5 + i] = r.flight_id.charCodeAt(i);
  v.setUint32(17, checkRange('sequence_id', r.sequence_id, 0, 0xffffffff), true);
  v.setBigUint64(21, BigInt(checkRange('timestamp', Date.parse(r.timestamp), 0, Number.MAX_SAFE_INTEGER)), true);
  v.setInt32(29, checkRange('altitude', r.altitude * 10, -2147483648, 2147483647), true);
  v.setUint16(33, checkRange('speed', r.speed * 10, 0, 65535), true);
  v.setInt16(35, checkRange('pitch', r.pitch * 100, -32768, 32767), true);
  v.setInt16(37, checkRange('roll', r.roll * 100, -32768, 32767), true);
  v.setUint16(39, checkRange('yaw', r.yaw * 10, 0, 65535), true);
  v.setUint32(41, crc32Bytes(buf.subarray(0, 41)), true);
  return buf;
}

function header(b: Uint8Array, len: number, type: number): string | null {
  if (b.length !== len) return `bad length ${b.length}, expected ${len}`;
  if (b[0] !== MAGIC[0] || b[1] !== MAGIC[1]) return 'bad magic';
  if (b[2] !== PROTOCOL_VERSION) return `unsupported version ${b[2]}`;
  const crc = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(len - 4, true);
  if (crc32Bytes(b.subarray(0, len - 4)) !== crc) return 'crc mismatch';
  if (b[3] !== type) return 'unexpected frame type';
  return null;
}

/** Decode a record frame into a FlightRecord. The integrity_checksum is recomputed in the app's canonical form. Never throws. */
export function decodeRecordFrame(b: Uint8Array): DecodeResult<FlightRecord> {
  const err = header(b, RECORD_LEN, TYPE_RECORD);
  if (err) return { ok: false, error: err };
  const src = NAMES[b[4]];
  if (!src || src === 'REMOTE') return { ok: false, error: `unknown recorder id ${b[4]}` };
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let fid = '';
  for (let i = 5; i < 17 && b[i] !== 0; i++) fid += String.fromCharCode(b[i]);
  const base = {
    flight_id: fid,
    sequence_id: v.getUint32(17, true),
    timestamp: new Date(Number(v.getBigUint64(21, true))).toISOString(),
    altitude: v.getInt32(29, true) / 10,
    speed: v.getUint16(33, true) / 10,
    pitch: v.getInt16(35, true) / 100,
    roll: v.getInt16(37, true) / 100,
    yaw: v.getUint16(39, true) / 10,
  };
  return { ok: true, value: { ...base, source_id: src, integrity_checksum: computeChecksum(base) } };
}

export function encodeAckFrame(a: AckFrame): Uint8Array {
  const buf = new Uint8Array(ACK_LEN);
  const v = new DataView(buf.buffer);
  buf.set(MAGIC, 0);
  buf[2] = PROTOCOL_VERSION;
  buf[3] = TYPE_ACK;
  buf[4] = RECORDER_CODES[a.sender];
  v.setUint32(5, a.batchId, true);
  v.setUint32(9, a.firstSeq, true);
  v.setUint32(13, a.lastSeq, true);
  v.setUint32(17, crc32Bytes(buf.subarray(0, 17)), true);
  return buf;
}

export function decodeAckFrame(b: Uint8Array): DecodeResult<AckFrame> {
  const err = header(b, ACK_LEN, TYPE_ACK);
  if (err) return { ok: false, error: err };
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const sender = NAMES[b[4]];
  if (!sender) return { ok: false, error: `unknown sender id ${b[4]}` };
  return { ok: true, value: { sender, batchId: v.getUint32(5, true), firstSeq: v.getUint32(9, true), lastSeq: v.getUint32(13, true) } };
}

export const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

/**
 * What a physical recorder must expose to the recovery engine. A future ESP32 transport (USB-serial dump of the SD log,
 * Wi-Fi/LoRa uplink) would implement this; today only the simulated implementation exists.
 */
export interface RecorderSource {
  readonly id: SourceId;
  readonly kind: 'simulated' | 'esp32';
  /** Hardware media health as reported by the device (not inferred). */
  mediaState(): 'ok' | 'degraded' | 'destroyed' | 'unreachable';
  /** Raw, unvalidated records as stored on the device. Validation is the recovery engine's job. */
  readRecords(): Promise<unknown[]>;
}

export class SimulatedRecorderSource implements RecorderSource {
  readonly kind = 'simulated' as const;
  constructor(readonly id: SourceId, private readonly getState: () => SimState) {}
  mediaState() {
    const s = this.getState();
    return (this.id === 'PRIMARY' ? s.primary.media : this.id === 'BACKUP' ? s.backup.media : s.remote.media);
  }
  async readRecords(): Promise<unknown[]> {
    const s = this.getState();
    return [...(this.id === 'PRIMARY' ? s.primary.records : this.id === 'BACKUP' ? s.backup.records : s.remote.records)];
  }
}
