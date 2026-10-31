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

The backend is a local prototype with no authentication. It does not persist complete telemetry runs; use telemetry JSON/CSV export to retain or replay those runs.

## Requirements fit

The app includes a versioned schema, UTC and monotonic timestamps, sequence/source/units/provenance, finite/range validation, and visible batch gap/duplicate/out-of-order errors. The Sensor Health page offers simulation-only bias, drift, spike, noise, frozen, dropout, message disorder, delayed, compound, and normal turbulence-like scenarios; threshold/persistence and median-residual CUSUM detectors; uncertainty-aware states; sample-linked alerts; telemetry replay; run stop/close; JSON/CSV export; and synthetic-run evaluation metrics. See [docs/REQUIREMENT_TRACEABILITY.md](docs/REQUIREMENT_TRACEABILITY.md) for implementation mapping and remaining blocked evidence.

The AI detector is explicitly unavailable because no model or evaluated dataset was supplied. The dashboard does not claim calibrated confidence. See [docs/REQUIREMENTS_GAP_ANALYSIS.md](docs/REQUIREMENTS_GAP_ANALYSIS.md) for coverage and known limits.

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
- `backend/app/`: optional FastAPI/SQLite persistence for recovery tests and audit events.
- `docs/PROTOCOL.md` and `docs/ESP32_RECORDERS.md`: design proposals and reference decoding only; no device transport is implemented.

## Telemetry schema

Each schema 1.0 sample includes `run_id`, `sequence`, `timestamp_utc`, `monotonic_ms`, `source`, explicit units, five synthetic signals, and quality/provenance flags. The sample signal set is a software fixture, not a validated aircraft sensor suite. Speed is generated simulator data; barometric pressure alone is never treated as airspeed.

## Limits

- Sensor thresholds and broad payload bounds are illustrative software parameters, not validated operating limits.
- The shown evaluation uses injected synthetic fault labels from the same run. It is not held-out research evidence; no real dataset split, confidence calibration, or aircraft generalization has been established.
- No live device transport, full telemetry backend persistence, durable browser recording beyond the current tab session, large-file stress evidence, trained AI detector, or actuator interface is included.
- CRC-32 detects accidental corruption only; it is not authentication. The optional backend has no auth or schema migrations.
- No aircraft control, warning-system replacement, certification, airworthiness or crash-survivability claim is made.
