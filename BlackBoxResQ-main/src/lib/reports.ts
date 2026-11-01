import type { RecoveryResult } from './recovery';

export interface RecoveryTest {
  id: string;
  runId?: string;
  scenarioId: string;
  scenarioName: string;
  flightId: string;
  seed: number;
  flightTimeSec: number;
  assumptions: string[];
  sourcesIncluded: string[];
  sourcesUnavailable: { source: string; reason: string }[];
  result: RecoveryResult;
  limitations: string[];
  /** Set by the backend when persisted (wall-clock UTC). */
  createdAt?: string;
}

export const STANDARD_LIMITATIONS = [
  'All flight data, failure events and recovery statistics are SYNTHETIC and produced by a deterministic simulator.',
  'No aircraft damage, crash-survivability or structural model is included.',
  'CRC-32 detects accidental corruption only; it is not cryptographic authentication and cannot detect deliberate tampering.',
  'Recovery time is the measured processing time of the in-browser merge, not a forensic lab turnaround time.',
  'A successful simulated write does not imply physical durability of real storage media.',
  'Research prototype — not certified aviation equipment.',
];
