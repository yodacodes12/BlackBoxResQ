# BlackBoxResQ — Flight Data Recovery & Investigation System

> **Research prototype. Not certified aviation equipment.** All flight data, failures, availability indices and recovery
> statistics are **synthetic** and produced by a deterministic simulator. No hardware, external API or network is required.

Concept: a primary recorder, an independent backup recorder and a remote data copy record the same flight; a recovery
engine merges whatever survives, verifies it and reports exactly what was and was not recovered.

## Run

Frontend (works on its own — the backend is optional):
```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck  # tsc --noEmit
npm test           # vitest (engine + protocol tests)
npm run build      # typecheck + production build
```
Backend (persists recovery tests and the audit trail to SQLite):
```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --port 8000   # DB file: backend/data/blackboxresq.db
.venv/bin/python -m pytest -q                # backend tests
```
With both running, the Vite dev server proxies `/api` to port 8000. The Reports page shows backend status; results created while
the backend is down stay in memory and upload automatically once it is reachable. API: `GET /api/health`, `POST/GET /api/tests`,
`GET /api/tests/{id}`, `POST/GET /api/events` (interactive docs at `/docs`). There is **no authentication** — local prototype use only;
the server assigns test ids (`RT-###`) so concurrent sessions cannot collide.

## Status by phase

| Phase | Scope | Status |
|---|---|---|
| 1 | UI foundation, 5 pages, design system | Done |
| 2 | Shared simulation engine, all failure controls | Done |
| 3 | Recovery engine (CRC, gaps, duplicates, conflicts, merge, CSV) | Done |
| 4 | Recovery history, CSV, print-ready report | Done. PDF = browser "Save as PDF" from the print dialog (no PDF library) |
| 5 | FastAPI + SQLite persistence | Done (tests + audit events) |
| 6 | Hardware-readiness | Specs + codecs + `RecorderSource` interface only. **No hardware integration** — see `docs/PROTOCOL.md`, `docs/ESP32_RECORDERS.md` |

## Architecture

```
src/lib/        pure, framework-free logic (unit-tested)
  crc.ts          CRC-32 (error detection only, not authentication)
  record.ts       payload canonicalisation, checksum, structural validation (parseRecord)
  generator.ts    seeded synthetic flight (climb/cruise/descent)
  simulation.ts   shared state + reducer: recorders, network, power, remote batches/acks, audit log
  scenarios.ts    deterministic scripted scenarios + headless runner (same reducer as live sim)
  availability.ts illustrative survivability assumptions (editable constants)
  recovery.ts     merge/validate engine and metrics
  csv.ts, reports.ts, status.ts, api.ts
  hardware.ts     proposed wire-protocol codec + RecorderSource interface (no transport)
src/state/SimContext.tsx   one useReducer shared by all pages; 200 ms tick timer
src/state/usePersistence.ts  optional backend sync
backend/app/               FastAPI + SQLite (main.py, db.py) and protocol.py reference decoder
src/pages/                 Overview, Location, RecoveryLab, FailureLab, Reports (hash routing, no router dependency)
```

## Data schema

`FlightRecord`: `flight_id, sequence_id, timestamp (ISO-8601), altitude (ft), speed (kt), pitch, roll, yaw (deg), source_id, integrity_checksum`.
The checksum is CRC-32 (8 hex chars) over `flight_id|sequence_id|timestamp|altitude|speed|pitch|roll|yaw` — `source_id` is excluded
so copies from different sources share a checksum. Sequence IDs drive gap detection; timestamps drive chronology.

Separate metadata in `SimState`: recorder state/media, network state, power state, remote queue / in-flight / acknowledged batches, events (audit trail), recovery tests.

## Simulation rules (documented assumptions)

- 1 record per simulated second per source; default flight 600 records, seed `20260101`. Same seed ⇒ identical data. Reset restores that state (recovery test history is kept).
- Recorders fail independently. A failed recorder stops writing; its already-stored records stay readable unless media is marked destroyed.
- Network loss never stops local recording. Records queue; remote sends batches of 10 and each batch is acknowledged one tick later. A batch unacknowledged at disconnect is retransmitted on restore, so the remote log gets **duplicates**, which recovery detects. The final partial batch is not sent at flight end.
- Abrupt power loss: primary fails with its last 2 writes torn (CRC fail); comms queue and unacknowledged state are lost; backup has independent power.
- Fault injection is deterministic (every 12th of last 60 records; 10-record gap ending 20 from the tail; needs ≥ 30 records).
- Damage/fire scenarios apply an assumption-based availability index (`availability.ts`): index < 0.5 ⇒ unrecoverable, < 0.75 ⇒ degraded (deterministic corrupted records).

## Recovery semantics

Per expected sequence ID `0..expected-1`:

| Status | Meaning |
|---|---|
| validated | ≥1 CRC-valid copy and all valid copies agree |
| inconsistent | valid copies disagree; shown value is highest-priority source, flagged, every variant listed in Conflicts |
| corrupted | copies exist but all fail CRC |
| missing | no surviving copy (exported with empty values — never invented) |

Recovery % = validated ÷ expected. Data loss % = (missing + corrupted) ÷ expected. Malformed input (wrong type, NaN, bad checksum format, wrong flight id) is rejected and counted, never thrown.
Estimation of missing data is intentionally **not** implemented.

## Known limitations

- Without the backend, state is in memory and is lost on reload. The live simulation itself is never persisted (only recovery tests and events).
- Printing relies on the browser: pick "Save as PDF" as the destination. Layout was verified with Chromium's PDF output only.
- Backend has no auth, rate limiting or schema migrations; payloads are stored as JSON blobs. Not for deployment as-is.
- Survivability indices are illustrative ordinal parameters, not probabilities or structural analysis.
- Recovery "time" is browser processing time. CRC-32 does not detect deliberate tampering.
- Hardware protocol is a draft with open items listed in `docs/PROTOCOL.md`; nothing has run on an ESP32.
- Single frontend bundle ~670 kB (Recharts); not code-split.
