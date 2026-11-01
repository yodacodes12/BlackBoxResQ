import { computeChecksum, round } from './record';
import type { FlightConfig, FlightRecord } from './types';

export const DEFAULT_CONFIG: FlightConfig = {
  flightId: 'BBQ-SIM-0001',
  seed: 20260101,
  durationSec: 600,
  startIso: '2026-01-01T10:00:00.000Z',
};

function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

/**
 * Deterministic synthetic flight: climb (0–25 %), cruise (25–75 %), descent (75–100 %).
 * The same (config, sequence) always yields the same record. SYNTHETIC DATA — not a real aircraft.
 */
export function generateTruth(cfg: FlightConfig, seq: number): FlightRecord {
  const p = cfg.durationSec > 1 ? seq / (cfg.durationSec - 1) : 0;
  const rnd = mulberry32((Math.imul(cfg.seed, 2654435761) ^ Math.imul(seq + 1, 40503)) >>> 0);
  const n = (amp: number) => (rnd() * 2 - 1) * amp;

  let alt: number, spd: number, pitch: number;
  if (p < 0.25) {
    const u = p / 0.25;
    alt = 35000 * smooth(u);
    spd = 160 + 290 * smooth(u);
    pitch = 8 - 5.5 * smooth(u);
  } else if (p < 0.75) {
    alt = 35000 + 150 * Math.sin(2 * Math.PI * p * 6);
    spd = 450 + 4 * Math.sin(2 * Math.PI * p * 4);
    pitch = 2.5 + 0.3 * Math.sin(2 * Math.PI * p * 6);
  } else {
    const u = (p - 0.75) / 0.25;
    alt = 35000 - 33500 * smooth(u);
    spd = 450 - 310 * smooth(u);
    pitch = 2.5 - 5.5 * Math.sin(Math.PI * u) * 0.9 - 2 * u * 0.5;
  }
  const bankScale = p < 0.1 || p > 0.9 ? 0.3 : 1;
  const roll = 12 * Math.sin(2 * Math.PI * p * 3) * bankScale;
  const yaw = (90 + 60 * Math.sin(2 * Math.PI * p * 1.2) + 360) % 360;

  const base = {
    flight_id: cfg.flightId,
    sequence_id: seq,
    timestamp: new Date(Date.parse(cfg.startIso) + seq * 1000).toISOString(),
    altitude: round(Math.max(0, alt + n(15)), 1),
    speed: round(spd + n(1.5), 1),
    pitch: round(pitch + n(0.15), 2),
    roll: round(roll + n(0.4), 2),
    yaw: round((yaw + n(0.3) + 360) % 360, 1),
  };
  return { ...base, source_id: 'TRUTH', integrity_checksum: computeChecksum(base) };
}
