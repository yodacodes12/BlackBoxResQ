/** Thin client for the optional FastAPI backend (proxied at /api in dev). The UI works fully without it. */
export async function api<T>(path: string, init?: { method?: string; body?: unknown; timeoutMs?: number }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? 'GET',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(init?.timeoutMs ?? 5000),
  });
  if (!res.ok) {
    let detail: string | undefined;
    try {
      const error = await res.json() as { detail?: unknown };
      if (typeof error.detail === 'string') detail = error.detail;
    } catch { /* Fall back to the HTTP status when the response is not JSON. */ }
    throw new Error(detail ?? `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export interface PersistedEvent { id: number; run_id: string; created_at: string; tick: number; kind: string; severity: string; message: string }
