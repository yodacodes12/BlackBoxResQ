# Requirement traceability

This map records where the supplied dashboard requirements are represented in the current software. “Implemented” means software behavior is present; it is not evidence of aircraft suitability or held-out research performance. No verification commands were run for this revision.

| Requirement group | Code/UI | Status and boundary |
|---|---|---|
| FR-01 run, connection, age, recorder | `src/pages/SensorHealth.tsx`, `src/lib/simulation.ts` | Implemented for simulator/replay; UUID run ID, wall-clock age/stale display, recorder status. No physical source connection. |
| FR-02 telemetry, units, stale | `src/lib/sensorMonitoring.ts`, Sensor Health | Implemented for five synthetic signals; schema 1.0 carries units, UTC, monotonic time, sequence and quality. The trend chart has a range brush for zoom/range selection. |
| FR-03 measured/simulated values | Sensor Health, `src/lib/generator.ts` | Simulator values are labelled synthetic. No physical readings. |
| FR-04 channel health | Sensor Health, `parseTelemetry` | Per-channel value/unit/validity/freshness and missing-channel state; broad payload bounds are sanity checks, not flight limits. |
| FR-05 detector comparison | `classifyRows`, `evaluate` in `src/lib/sensorMonitoring.ts` | Threshold/persistence and median-residual CUSUM process the same samples. AI remains unavailable. |
| FR-06/07 alert records and evidence | `makeAlerts`, Sensor Health | Alert IDs, run/time/channel/detector/version/state/label/score/uncertainty/reasons/sample ranges/raw samples displayed and exported. Scores are not confidence. |
| FR-08 recording and replay | `src/lib/simulation.ts`, Sensor Health | Start/pause/resume/stop; stop closes simulated recorders; telemetry JSON import replays samples and preserves sequence warnings. Session checkpoint in tab storage supports page refresh. No physical file durability. |
| FR-09 sensor fault injection | `injectFault`, Sensor Health | Bias, drift, spike, deterministic noise, frozen, dropout, out-of-order, delayed and compound scenarios; simulation/test only. Recorder-storage corruption controls remain separate. |
| FR-10 session metadata | Sim state and JSON export | Run ID, seed, duration, fault configuration, source and detector versions. Simulator and imported replay only. |
| FR-11 export | Sensor Health | Telemetry/alerts CSV and JSON plus evaluation JSON include units, timestamps, run provenance and versions. Recovery reconstruction CSV remains available. |
| FR-12/13 AI status/failure behavior | Sensor Health | Explicit unavailable state and deterministic-only fallback. No real model, exception or timeout simulation because there is no AI adapter. |
| FR-14 alert traceability | Alert raw sample and sequence range | Alert records include the telemetry sample used by the monitor. Recorder-recovery records remain independently CRC-checked. |
| Reliability/security | telemetry parser, simulator, optional FastAPI | Invalid JSON/schema/units/non-finite/range and batch ordering issues are rejected or reported; replay uploads are capped at 10 MB/50,000 records. No telemetry-controlled command path. Backend still has no auth; physical source security is unimplemented. |
| Evaluation/reproducibility | `evaluate`, replay controls | Confusion counts, precision/recall/F1, false alarms/hour, delay and abstention; replay button compares repeated output states/event IDs. Metrics cover only the injected synthetic run. |
| Performance and long-run stress | Sensor Health displays detector batch processing time | Local processing time only; ingestion-to-display target, memory growth, large-file and sustained-load evidence remain unmeasured. |
| Safety boundary | README, UI labels, gap analysis | No aircraft commands, certification or airworthiness claims. No crash-survivability model. |

## Commands for subsequent verification

From the project root, the existing package scripts are `npm run typecheck`, `npm test`, and `npm run build`; backend checks are `python -m pytest -q` from `backend`. Run them in an environment with dependencies installed and capture the output before reporting any PASS result. The DOCX verification scenarios for device, AI model, real dataset, sustained load and hardware remain blocked until those artifacts and acceptance targets exist.
