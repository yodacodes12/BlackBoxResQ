import { DEFAULT_CONFIG } from './generator';
import { initialState, simReducer, type SimAction, type SimState } from './simulation';
import type { FlightConfig } from './types';

export interface ScenarioEvent { atTick: number; action: SimAction }
export interface Scenario { id: string; name: string; description: string; timeline: ScenarioEvent[]; assumptions: string[] }
const D = DEFAULT_CONFIG.durationSec;
const stored = (target: 'PRIMARY' | 'BACKUP', media: 'degraded' | 'destroyed', reason: string): SimAction => ({ type: 'APPLY_MEDIA', target, media, reason });

export const SCENARIOS: Scenario[] = [
  { id: 'nominal', name: 'Nominal recording (control)', description: `Complete ${D}-record synthetic run without injected recorder faults.`, timeline: [], assumptions: ['Synthetic deterministic control run.'] },
  { id: 'primary-failure', name: 'Primary recorder stops at t=400 s', description: 'Primary stops accepting writes while backup and remote recording continue.', timeline: [{ atTick: 400, action: { type: 'DISABLE_RECORDER', which: 'PRIMARY' } }], assumptions: ['Existing primary records remain readable.'] },
  { id: 'primary-media-unavailable', name: 'Primary storage unavailable', description: 'Test recovery when primary recorder media is unavailable.', timeline: [{ atTick: 600, action: stored('PRIMARY', 'destroyed', 'Storage media failure scenario') }], assumptions: ['Media availability is a simulated test condition only.'] },
  { id: 'local-storage-degraded', name: 'Local storage integrity degradation', description: 'Inject deterministic CRC failures into local recorder media.', timeline: [{ atTick: 600, action: stored('PRIMARY', 'degraded', 'Synthetic media corruption') }, { atTick: 600, action: stored('BACKUP', 'degraded', 'Synthetic media corruption') }], assumptions: ['Degraded media corruption pattern is deterministic and synthetic.'] },
  { id: 'comms-loss', name: 'Remote link loss at t=250 s', description: 'Remote link drops and is not restored; local recording continues.', timeline: [{ atTick: 250, action: { type: 'DISCONNECT' } }], assumptions: ['Remote copy contains only batches transmitted before link loss.'] },
  { id: 'comms-interruption', name: 'Network interruption t=250–320 s', description: 'Link drops and returns; queued records are retransmitted and duplicates are detected.', timeline: [{ atTick: 250, action: { type: 'DISCONNECT' } }, { atTick: 320, action: { type: 'RESTORE' } }], assumptions: ['A batch pending acknowledgment at disconnect is retransmitted.'] },
  { id: 'power-loss', name: 'Abrupt power loss at t=450 s', description: 'Primary recorder and comms queue fail; backup recording continues.', timeline: [{ atTick: 450, action: { type: 'POWER_LOSS' } }], assumptions: ['Backup power is independent in this simulation.'] },
  { id: 'data-faults', name: 'Stored-record corruption and conflict', description: 'Inject CRC failures and divergent valid copies into recorder storage.', timeline: [{ atTick: 300, action: { type: 'INJECT_CORRUPT', target: 'PRIMARY' } }, { atTick: 300, action: { type: 'INJECT_CONFLICT', target: 'BACKUP' } }], assumptions: ['Injection pattern is deterministic.'] },
  { id: 'missing-records', name: 'Missing record blocks', description: 'Remove deterministic sequence blocks from local recorder stores.', timeline: [{ atTick: 300, action: { type: 'DROP_RECORDS', target: 'PRIMARY' } }, { atTick: 500, action: { type: 'DROP_RECORDS', target: 'BACKUP' } }], assumptions: ['The gap injector removes ten stored records when enough records exist.'] },
  { id: 'both-local-media-unavailable', name: 'Both local media unavailable with remote link loss', description: 'Test recovery from a partial remote copy when both local stores are unavailable.', timeline: [{ atTick: 150, action: { type: 'DISCONNECT' } }, { atTick: 600, action: stored('PRIMARY', 'destroyed', 'Synthetic media availability scenario') }, { atTick: 600, action: stored('BACKUP', 'destroyed', 'Synthetic media availability scenario') }], assumptions: ['Storage availability is an abstract test input.'] },
];
export const scenarioById = (id: string) => SCENARIOS.find((s) => s.id === id);

/** Runs one deterministic test scenario through the same reducer as the live recorder simulation. */
export function runScenario(sc: Scenario, config: FlightConfig = DEFAULT_CONFIG): SimState {
  let s = simReducer(initialState(config), { type: 'START', runId: config.flightId });
  for (let t = 0; t < config.durationSec; t++) {
    for (const e of sc.timeline) if (e.atTick === t) s = simReducer(s, e.action);
    s = simReducer(s, { type: 'TICK', n: 1 });
  }
  for (const e of sc.timeline) if (e.atTick >= config.durationSec) s = simReducer(s, e.action);
  return s;
}
