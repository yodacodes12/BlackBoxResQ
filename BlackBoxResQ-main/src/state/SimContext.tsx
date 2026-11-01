import { createContext, useContext, useEffect, useMemo, useReducer, useState, type ReactNode, type Dispatch } from 'react';
import { recover, type RecoveryResult } from '../lib/recovery';
import { usePersistence, type BackendStatus } from './usePersistence';
import { datasetsFromState, initialState, simReducer, type SimAction, type SimState } from '../lib/simulation';

interface Ctx {
  sim: SimState;
  dispatch: Dispatch<SimAction>;
  speed: number;
  setSpeed: (n: number) => void;
  labScenarioId: string;
  setLabScenarioId: (id: string) => void;
  /** Merge of every stored copy in the live session (what is recoverable right now). */
  live: RecoveryResult;
  backend: { status: BackendStatus; lastError: string | null };
  localPersistenceError: string | null;
}

const SimCtx = createContext<Ctx | null>(null);
export const TICK_MS = 200;
const SIM_STORAGE_KEY = 'blackboxresq.sim.v1';

function restoreSim(): SimState {
  try {
    const saved = sessionStorage.getItem(SIM_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as { version?: number; state?: SimState };
      const s = parsed.state;
      if (parsed.version === 1 && s && typeof s.runId === 'string' && typeof s.config?.flightId === 'string'
        && ['idle', 'running', 'paused', 'complete'].includes(s.status)
        && Array.isArray(s.primary?.records) && Array.isArray(s.backup?.records) && Array.isArray(s.remote?.records)) return s;
    }
  } catch { /* invalid or unavailable browser storage falls back to a fresh session */ }
  return initialState();
}

export function SimProvider({ children }: { children: ReactNode }) {
  const [sim, dispatch] = useReducer(simReducer, undefined, restoreSim);
  const [speed, setSpeed] = useState(1);
  const [localPersistenceError, setLocalPersistenceError] = useState<string | null>(null);
  const [labScenarioId, setLabScenarioId] = useState('live');

  useEffect(() => {
    if (sim.status !== 'running') return;
    const h = setInterval(() => dispatch({ type: 'TICK', n: speed, receivedAtUtc: new Date().toISOString() }), TICK_MS);
    return () => clearInterval(h);
  }, [sim.status, speed]);

  const backend = usePersistence(sim, dispatch);

  useEffect(() => {
    const save = () => {
      try { sessionStorage.setItem(SIM_STORAGE_KEY, JSON.stringify({ version: 1, state: sim })); setLocalPersistenceError(null); }
      catch (e) { setLocalPersistenceError(`Browser session storage failed: ${String(e)}`); }
    };
    const timer = window.setTimeout(save, 500);
    window.addEventListener('pagehide', save);
    return () => { window.clearTimeout(timer); window.removeEventListener('pagehide', save); };
  }, [sim]);

  const live = useMemo(
    () => recover(datasetsFromState(sim), sim.tick, sim.config.flightId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sim.primary.records, sim.backup.records, sim.remote.records, sim.tick, sim.primary.media, sim.backup.media, sim.remote.media, sim.config.flightId],
  );

  const value = useMemo(() => ({ sim, dispatch, speed, setSpeed, labScenarioId, setLabScenarioId, live, backend, localPersistenceError }), [sim, speed, labScenarioId, live, backend, localPersistenceError]);
  return <SimCtx.Provider value={value}>{children}</SimCtx.Provider>;
}

export function useSim(): Ctx {
  const c = useContext(SimCtx);
  if (!c) throw new Error('useSim outside SimProvider');
  return c;
}
