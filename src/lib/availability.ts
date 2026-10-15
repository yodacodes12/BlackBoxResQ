import type { MediaState, Zone } from './types';

/** ILLUSTRATIVE assumptions — editable constants, not a certified structural or survivability analysis. */
export const ASSUMPTIONS = {
  baseIndex: 0.9, // assumed availability index of a crash-protected recorder with no hazard applied
  hitFactor: 0.3, // multiplier when the recorder's fuselage zone is directly damaged
  fireFactor: 0.65, // multiplier for fire/water exposure (applies to all local recorders)
  destroyedBelow: 0.5, // index below this => media treated as unrecoverable
  degradedBelow: 0.75, // index below this (and >= destroyedBelow) => media readable but with corrupted records
};

export type Hazard =
  | { kind: 'none' }
  | { kind: 'damage'; zones: Zone[] }
  | { kind: 'fire' };

export interface Layout {
  primary: Zone;
  backup: Zone;
}
export const DEFAULT_LAYOUT: Layout = { primary: 'rear', backup: 'forward' };

export interface Assessment {
  index: number;
  media: MediaState;
  reason: string;
}

export function mediaFromIndex(index: number): MediaState {
  if (index < ASSUMPTIONS.destroyedBelow) return 'destroyed';
  if (index < ASSUMPTIONS.degradedBelow) return 'degraded';
  return 'ok';
}

export function assessLocal(hazard: Hazard, zone: Zone): Assessment {
  let f = 1;
  let reason = 'No airframe hazard applied';
  if (hazard.kind === 'damage') {
    if (hazard.zones.includes(zone)) {
      f = ASSUMPTIONS.hitFactor;
      reason = `Recorder is in the damaged ${zone} zone`;
    } else reason = `Recorder is outside the damaged zone(s): ${hazard.zones.join(', ')}`;
  } else if (hazard.kind === 'fire') {
    f = ASSUMPTIONS.fireFactor;
    reason = 'Fire or water exposure assumed to affect all local recorders';
  }
  const index = Math.round(ASSUMPTIONS.baseIndex * f * 1000) / 1000;
  return { index, media: mediaFromIndex(index), reason };
}
