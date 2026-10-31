# Requirements coverage and implementation limits

## Implemented

- Dashboard displays connection state, run ID, data age, recorder status, simulated signals and clearly labelled simulated data.
- Versioned JSON telemetry records carry run ID, sequence, UTC timestamp, monotonic time, source, units, signals, and quality/provenance flags. Individual records are validated for schema, units, finite values and timestamp/sequence shape. Batch import flags duplicates, gaps and out-of-order messages; gaps and invalid inputs are surfaced as degraded/unknown.
- Sensor bench injects bias, gradual drift, spike, deterministic excess noise, frozen output, dropout, out-of-order messages and a simultaneous drift/dropout case. Recorder-storage corruption remains a distinct control.
- Deterministic threshold/persistence and median-residual CUSUM detectors run on the same samples. Outputs include detector ID/version, state, reason codes, scores without confidence claims, and sample references.
- Alerts carry run ID, UTC times, affected channels, detector/version, suspected label or UNKNOWN, uncertainty, reason codes and the raw telemetry sample.
- AI is explicitly unavailable without a model. No stale AI prediction is presented; deterministic monitoring and recording run independently.
- Runs have unique IDs, can be stopped with simulated recorder closure, and export telemetry, alerts, configuration, provenance and evaluation as JSON/CSV. Recovery lab replays deterministic scenarios; telemetry JSON is the supported interchange/replay format.
- The evaluation panel reports TP/FP/FN/TN, precision, recall, F1, false alarms per simulated hour, detection delay and abstention/unknown rate for each deterministic baseline. It omits calibration because confidence has not been evaluated.
- The recorder-location schematic and assumption-based aircraft survivability indices have been removed. Recovery scenarios now model abstract storage availability only and make no structural or crash-survivability claim.

## Explicitly not implemented or not evidenced

- Physical sensor or embedded-device ingestion, real-time hardware transport, and physical recorder storage. The protocol/ESP32 documents remain proposals/reference code.
- AI inference, trained model/version, calibration, model uncertainty or OOD testing. The dashboard shows AI as unavailable and exercises deterministic-only operation; it does not fabricate an AI timeout or output.
- A defensible real flight dataset, held-out run/scenario evaluation, statistical confidence intervals, target latency thresholds, hardware resource use, or real-aircraft generalization.
- Aircraft control/actuator commands, aircraft airworthiness, certified warning behavior, or flight safety.
- Durable local browser recording across reload and large-file stress evidence. Backend persistence applies only to recovery tests and audit events, not full telemetry runs.

## Verification scenarios to execute before a demonstration claim

Use the Sensor Health page to start a run and capture a nominal fixture, then repeat for each listed sensor fault and the multiple-fault case. Import exported telemetry twice and compare detector states and event IDs. Exercise malformed JSON, wrong schema/units, non-finite values, duplicate/gap/out-of-order sequences, stale/absent input, stop/close, recorder failure, network disconnect/reconnect, and AI-unavailable fallback. Sustained-load, large-file, memory-growth, and hardware checks remain blocked until suitable fixtures, device, and target limits exist.

Metrics shown in the UI are descriptive for the currently injected synthetic run only. They are not held-out research results and must not be presented as evidence of real-world performance.
