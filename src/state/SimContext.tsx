import { createContext, useContext, useEffect, useMemo, useReducer, useState, type ReactNode, type Dispatch } from 'react';
import { DEFAULT_LAYOUT, type Layout } from '../lib/availability';
import { recover, type RecoveryResult } from '../lib/recovery';
import { usePersistence, type BackendStatus } from './usePersistence';
import { datasetsFromState, initialState, simReducer, type SimAction, type SimState } from '../lib/simulation';

interface Ctx {
  sim: SimState;
  dispatch: Dispatch<SimAction>;
  speed: number;
  setSpeed: (n: number) => void;
  layout: Layout;
  setLayout: (l: Layout) => void;
  labScenarioId: string;
  setLabScenarioId: (id: string) => void;
  /** Merge of every stored copy in the live session (what is recoverable right now). */
  live: RecoveryResult;
  backend: { status: BackendStatus; lastError: string | null };
}

const SimCtx = createContext<Ctx | null>(null);
export const TICK_MS = 200;

export function SimProvider({ children }: { children: ReactNode }) {
  const [sim, dispatch] = useReducer(simReducer, undefined, () => initialState());
  const [speed, setSpeed] = useState(1);
  const [layout, setLayout] = useState<Layout>(DEFAULT_LAYOUT);
  const [labScenarioId, setLabScenarioId] = useState('live');

  useEffect(() => {
    if (sim.status !== 'running') return;
    const h = setInterval(() => dispatch({ type: 'TICK', n: speed }), TICK_MS);
    return () => clearInterval(h);
  }, [sim.status, speed]);

  const backend = usePersistence(sim, dispatch);

  const live = useMemo(
    () => recover(datasetsFromState(sim), sim.tick, sim.config.flightId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sim.primary.records, sim.backup.records, sim.remote.records, sim.tick, sim.primary.media, sim.backup.media, sim.remote.media, sim.config.flightId],
  );

  const value = useMemo(() => ({ sim, dispatch, speed, setSpeed, layout, setLayout, labScenarioId, setLabScenarioId, live, backend }), [sim, speed, layout, labScenarioId, live, backend]);
  return <SimCtx.Provider value={value}>{children}</SimCtx.Provider>;
}

export function useSim(): Ctx {
  const c = useContext(SimCtx);
  if (!c) throw new Error('useSim outside SimProvider');
  return c;
}
