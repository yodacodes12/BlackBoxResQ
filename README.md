# BlackBoxResQ Integrated Sensor Monitoring and Data Recovery

> Educational research prototype. Not certified aviation equipment. Telemetry and fault scenarios are synthetic. No physical sensors, aircraft interface, or flight-control commands are supported.

BlackBoxResQ combines a synthetic sensor-health bench with redundant flight-data recording and recovery. It validates a versioned telemetry envelope, compares deterministic detectors, links alerts to sample evidence, records simulator runs, and exports or replays telemetry.

## Run

Frontend:

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

Optional local backend for recovery tests and audit events:

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --port 8000
```

On Windows, set `OPENAI_API_KEY` as a user environment variable before starting the backend (Windows Search → **Edit environment variables for your account** → **New** under User variables). Restart the terminal after saving the variable. The backend reads the key locally and sends selected telemetry to the OpenAI Responses API only when **Analyze latest samples** is clicked on Sensor Health. The dashboard sends at most 30 samples per request. The default model is `gpt-6-astra`; set `BBQ_OPENAI_MODEL` in the backend environment to select another model available to your API account. Do not put the key in frontend code, `.env` files committed to the project, or telemetry exports.

Windows backend commands (run from the project root in a new PowerShell window):

```powershell
cd backend
py -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m uvicorn app.main:app --port 8000
```

Run `npm install` and `npm run dev` from the project root in a second terminal.

If `OPENAI_API_KEY` is missing or the AI service fails, the UI reports the issue and the deterministic monitors keep working. The GPT response is an explanatory summary only; it is not a trained sensor fault detector, calibrated confidence, diagnosis, or operational instruction. Use synthetic data only; imported replay samples are sent to OpenAI if you request analysis.

The backend is a local prototype with no authentication. It does not persist complete telemetry runs; use telemetry JSON/CSV export to retain or replay those runs.

## Requirements fit

The app includes a versioned schema, UTC and monotonic timestamps, sequence/source/units/provenance, finite/range validation, and visible batch gap/duplicate/out-of-order errors. The Sensor Health page offers simulation-only bias, drift, spike, noise, frozen, dropout, message disorder, delayed, compound, and normal turbulence-like scenarios; threshold/persistence and median-residual CUSUM detectors; uncertainty-aware states; sample-linked alerts; telemetry replay; run stop/close; JSON/CSV export; and synthetic-run evaluation metrics. See [docs/REQUIREMENT_TRACEABILITY.md](docs/REQUIREMENT_TRACEABILITY.md) for implementation mapping and remaining blocked evidence.

The dashboard includes an on-demand GPT assistant that explains a bounded telemetry window alongside deterministic detector outputs. It does not replace those monitors or claim a validated AI detector, calibrated confidence, or aircraft suitability. See [docs/REQUIREMENTS_GAP_ANALYSIS.md](docs/REQUIREMENTS_GAP_ANALYSIS.md) for coverage and known limits.

## Pages

- **Overview**: recorder status, synthetic telemetry charts, recovery summary and event feed.
- **Sensor Health**: channel quality, fault injection, detector comparison, alerts, replay, export and evaluation.
- **Recovery Lab**: CRC verification, sequence-gap recovery, duplicate/conflict analysis and reconstructed export.
- **Failure Simulation**: shared recorder simulation, stop/close, storage/network/power failure and recovery controls.
- **Investigation Reports**: recovery history, audit events and print-ready reports.

## Architecture

- `src/lib/sensorMonitoring.ts`: versioned telemetry validation, fault injection, threshold/persistence and median-residual CUSUM, alerts and metrics.
- `src/lib/simulation.ts`: shared recorder/network/power state and deterministic recording lifecycle.
- `src/lib/recovery.ts`: CRC-aware multi-source merge with gaps, duplicates, conflicts and explicit missing values.
- `src/lib/scenarios.ts`: deterministic recorder/recovery scenarios without aircraft-location or survivability assumptions.
- `src/state/SimContext.tsx`: shared React reducer and simulation clock.
- `src/pages/`: Overview, SensorHealth, RecoveryLab, FailureLab and Reports.
- `backend/app/`: optional FastAPI/SQLite persistence plus the OpenAI Responses API adapter for on-demand explanations.
- `docs/PROTOCOL.md` and `docs/ESP32_RECORDERS.md`: design proposals and reference decoding only; no device transport is implemented.

## Telemetry schema

Each schema 1.0 sample includes `run_id`, `sequence`, `timestamp_utc`, `monotonic_ms`, `source`, explicit units, five synthetic signals, and quality/provenance flags. The sample signal set is a software fixture, not a validated aircraft sensor suite. Speed is generated simulator data; barometric pressure alone is never treated as airspeed.

## Limits

- Sensor thresholds and broad payload bounds are illustrative software parameters, not validated operating limits.
- The shown evaluation uses injected synthetic fault labels from the same run. It is not held-out research evidence; no real dataset split, confidence calibration, or aircraft generalization has been established.
- No live device transport, full telemetry backend persistence, durable browser recording beyond the current tab session, large-file stress evidence, trained AI detector, or actuator interface is included.
- CRC-32 detects accidental corruption only; it is not authentication. The optional backend has no auth or schema migrations.
- No aircraft control, warning-system replacement, certification, airworthiness or crash-survivability claim is made.
