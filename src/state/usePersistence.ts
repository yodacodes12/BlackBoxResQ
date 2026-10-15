import { useEffect, useRef, useState, type Dispatch } from 'react';
import { api } from '../lib/api';
import type { RecoveryTest } from '../lib/reports';
import type { SimAction, SimState } from '../lib/simulation';

export type BackendStatus = 'checking' | 'online' | 'offline';

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

/**
 * Mirrors recovery tests and the audit trail to the backend when it is reachable.
 * Backend is authoritative for test ids. If it is down, nothing is lost from the in-memory session.
 */
export function usePersistence(sim: SimState, dispatch: Dispatch<SimAction>) {
  const [status, setStatus] = useState<BackendStatus>('checking');
  const [lastError, setLastError] = useState<string | null>(null);
  const [sessionId] = useState(uuid);
  const runId = useRef(uuid());
  const postedEvt = useRef(0);
  const synced = useRef(new Set<string>());
  const loaded = useRef(false);
  const busy = useRef(false);
  const testsRef = useRef<RecoveryTest[]>(sim.tests);
  testsRef.current = sim.tests;

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try { await api('/health'); if (alive) { setStatus('online'); setLastError(null); } }
      catch (e) { if (alive) { setStatus('offline'); setLastError(String(e)); } }
    };
    check();
    const h = setInterval(check, 8000);
    return () => { alive = false; clearInterval(h); };
  }, []);

  useEffect(() => {
    if (status !== 'online' || busy.current) return;
    const unsynced = sim.tests.filter((t) => !synced.current.has(t.id));
    if (loaded.current && unsynced.length === 0) return;
    busy.current = true;
    (async () => {
      try {
        for (const t of unsynced) {
          const { id } = await api<{ id: string }>('/tests', { method: 'POST', body: { session_id: sessionId, client_id: t.id, test: t } });
          synced.current.add(id);
          synced.current.add(t.id);
        }
        const list = await api<RecoveryTest[]>('/tests');
        list.forEach((t) => synced.current.add(t.id));
        const extra = testsRef.current.filter((t) => !synced.current.has(t.id));
        dispatch({ type: 'REPLACE_TESTS', tests: [...list, ...extra] });
        loaded.current = true;
        setLastError(null);
      } catch (e) {
        setStatus('offline');
        setLastError(String(e));
      } finally {
        busy.current = false;
      }
    })();
  }, [status, sim.tests, sessionId, dispatch]);

  // Throttled (not debounced): events can arrive faster than any quiet period, so flush on a fixed interval.
  const eventsRef = useRef(sim.events);
  eventsRef.current = sim.events;
  useEffect(() => {
    if (status !== 'online') return;
    let inFlight = false;
    const flush = async () => {
      const evs = eventsRef.current;
      if (inFlight || evs.length === 0) return;
      const last = evs[evs.length - 1].id;
      if (last < postedEvt.current) { runId.current = uuid(); postedEvt.current = 0; } // simulation was reset
      const fresh = evs.filter((e) => e.id > postedEvt.current);
      if (fresh.length === 0) return;
      inFlight = true;
      try {
        await api('/events', { method: 'POST', body: { session_id: sessionId, run_id: runId.current, events: fresh.slice(-1000).map(({ tick, kind, severity, message }) => ({ tick, kind, severity, message })) } });
        postedEvt.current = last;
      } catch (e) { setStatus('offline'); setLastError(String(e)); }
      finally { inFlight = false; }
    };
    flush();
    const h = setInterval(flush, 1000);
    return () => clearInterval(h);
  }, [status, sessionId]);

  return { status, lastError };
}
