import { assessLocal, DEFAULT_LAYOUT, type Assessment, type Hazard, type Layout } from './availability';
import { DEFAULT_CONFIG } from './generator';
import { initialState, simReducer, type SimAction, type SimState } from './simulation';
import type { FlightConfig, SourceId } from './types';

export interface ScenarioEvent {
  atTick: number;
  action: SimAction;
}
export interface Scenario {
  id: string;
  name: string;
  description: string;
  hazard: Hazard;
  timeline: ScenarioEvent[];
  assumptions: string[];
}

const D = DEFAULT_CONFIG.durationSec;
const damage = (zone: 'forward' | 'mid' | 'rear', name: string): Scenario => ({
  id: `damage-${zone}`,
  name,
  description: `Hypothetical: after a normal ${D}-record flight, the ${zone} fuselage zone is damaged. Local recorders located there are treated as unrecoverable.`,
  hazard: { kind: 'damage', zones: [zone] },
  timeline: [],
  assumptions: [`Damage applies to the ${zone} zone only; recorders elsewhere keep the assumed base index.`],
});

export const SCENARIOS: Scenario[] = [
  { id: 'nominal', name: 'Nominal flight (control)', description: 'No failures. Baseline for comparison.', hazard: { kind: 'none' }, timeline: [], assumptions: ['No faults injected.'] },
  { id: 'primary-failure', name: 'Primary recorder failure at t=400 s', description: 'Primary stops accepting writes; backup and remote continue.', hazard: { kind: 'none' }, timeline: [{ atTick: 400, action: { type: 'DISABLE_RECORDER', which: 'PRIMARY' } }], assumptions: ['Primary media remains readable; it simply holds no records after t=400 s.'] },
  damage('forward', 'Forward fuselage damage'),
  damage('mid', 'Mid-fuselage damage'),
  damage('rear', 'Rear fuselage damage'),
  { id: 'fire-water', name: 'Fire or water exposure', description: 'Both local recorders are degraded: readable, but with deterministic corrupted records.', hazard: { kind: 'fire' }, timeline: [], assumptions: ['Degraded media corrupts records where seq mod 17 = 3 (primary) and seq mod 19 = 5 (backup).'] },
  { id: 'comms-loss', name: 'Loss of communication at t=250 s', description: 'Remote link drops and is never restored; local recording continues.', hazard: { kind: 'none' }, timeline: [{ atTick: 250, action: { type: 'DISCONNECT' } }], assumptions: ['Remote copy only holds records transmitted before the outage.'] },
  { id: 'comms-interruption', name: 'Network interruption t=250–320 s', description: 'Link drops then is restored; queued records are retransmitted, creating duplicates.', hazard: { kind: 'none' }, timeline: [{ atTick: 250, action: { type: 'DISCONNECT' } }, { atTick: 320, action: { type: 'RESTORE' } }], assumptions: ['The batch in flight at disconnect is unacknowledged and is retransmitted.'] },
  { id: 'power-loss', name: 'Abrupt power loss at t=450 s', description: 'Primary fails with torn writes; comms queue lost; backup continues.', hazard: { kind: 'none' }, timeline: [{ atTick: 450, action: { type: 'POWER_LOSS' } }], assumptions: ['Backup recorder has independent power.'] },
  { id: 'data-faults', name: 'Corruption and conflict injection at t=300 s', description: 'CRC-failing records in primary, divergent CRC-valid records in backup.', hazard: { kind: 'none' }, timeline: [{ atTick: 300, action: { type: 'INJECT_CORRUPT', target: 'PRIMARY' } }, { atTick: 300, action: { type: 'INJECT_CONFLICT', target: 'BACKUP' } }], assumptions: ['Injection windows are deterministic (every 12th of the last 60 records).'] },
  { id: 'missing-records', name: 'Missing record blocks', description: 'A 10-record gap is removed from primary (t=300) and a different gap from backup (t=500).', hazard: { kind: 'none' }, timeline: [{ atTick: 300, action: { type: 'DROP_RECORDS', target: 'PRIMARY' } }, { atTick: 500, action: { type: 'DROP_RECORDS', target: 'BACKUP' } }], assumptions: ['Gaps are at fixed offsets from the store tail at injection time.'] },
  { id: 'severe-compound', name: 'Severe: forward + rear damage, comms lost at t=150 s', description: 'Both local recorders destroyed; only the partial remote copy survives.', hazard: { kind: 'damage', zones: ['forward', 'rear'] }, timeline: [{ atTick: 150, action: { type: 'DISCONNECT' } }], assumptions: ['With the default layout both recorders sit in damaged zones.'] },
];

/** Scenarios shown on the Location & Survivability page (subset of the Recovery Lab list). */
export const LOCATION_SCENARIO_IDS = ['damage-forward', 'damage-mid', 'damage-rear', 'fire-water', 'comms-loss'];

export const scenarioById = (id: string) => SCENARIOS.find((s) => s.id === id);

export type Availability = Record<SourceId, Assessment>;

export function assessScenario(sc: Scenario, layout: Layout = DEFAULT_LAYOUT): Availability {
  const remoteReason = sc.timeline.some((e) => e.action.type === 'DISCONNECT')
    ? 'Off-aircraft copy is physically unaffected, but only holds records transmitted before the link was lost'
    : 'Off-aircraft copy is physically unaffected by airframe damage';
  return {
    PRIMARY: assessLocal(sc.hazard, layout.primary),
    BACKUP: assessLocal(sc.hazard, layout.backup),
    REMOTE: { index: NaN, media: 'ok', reason: remoteReason },
  };
}

/** Runs a scenario headlessly through the same reducer used by the live simulation. Fully deterministic. */
export function runScenario(sc: Scenario, layout: Layout = DEFAULT_LAYOUT, config: FlightConfig = DEFAULT_CONFIG): SimState {
  let s = simReducer(initialState(config), { type: 'START' });
  for (let t = 0; t < config.durationSec; t++) {
    for (const e of sc.timeline) if (e.atTick === t) s = simReducer(s, e.action);
    s = simReducer(s, { type: 'TICK', n: 1 });
  }
  const av = assessScenario(sc, layout);
  if (sc.hazard.kind !== 'none') {
    for (const id of ['PRIMARY', 'BACKUP'] as const) {
      if (av[id].media !== 'ok') s = simReducer(s, { type: 'APPLY_MEDIA', target: id, media: av[id].media, reason: av[id].reason });
    }
  }
  return s;
}
