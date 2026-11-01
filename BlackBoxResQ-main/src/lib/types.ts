export type SourceId = 'PRIMARY' | 'BACKUP' | 'REMOTE';
export const SOURCE_IDS: SourceId[] = ['PRIMARY', 'BACKUP', 'REMOTE'];
export const SOURCE_LABEL: Record<SourceId, string> = {
  PRIMARY: 'Primary recorder',
  BACKUP: 'Independent backup recorder',
  REMOTE: 'Remote data copy',
};

/** One flight-data sample. `integrity_checksum` is a CRC-32 over the payload fields (not source_id). */
export interface FlightRecord {
  flight_id: string;
  sequence_id: number;
  timestamp: string;
  altitude: number; // ft
  speed: number; // kt
  pitch: number; // deg
  roll: number; // deg
  yaw: number; // deg (heading)
  source_id: string;
  integrity_checksum: string;
}

export interface FlightConfig {
  flightId: string;
  seed: number;
  durationSec: number;
  startIso: string;
}

export type MediaState = 'ok' | 'degraded' | 'destroyed';
export type Zone = 'forward' | 'mid' | 'rear';
