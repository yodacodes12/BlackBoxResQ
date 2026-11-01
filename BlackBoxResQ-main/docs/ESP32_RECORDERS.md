# Two-independent-ESP32 recorder concept — DESIGN ONLY

**Not implemented. Not tested on hardware.** This describes how the simulated architecture could map to hardware so the
interfaces in `src/lib/hardware.ts` have a target.

## Independence requirements

| Aspect | Primary recorder | Backup recorder |
|---|---|---|
| MCU | ESP32 #1 | ESP32 #2 (separate board) |
| Power | main supply + local regulator | **own battery/supercap + regulator** (the sim assumes this) |
| Storage | own SD card | own SD card |
| Sensor input | read-only tap | read-only tap (separate buffer/tap, no shared writable bus) |
| Placement | zone A | different zone B |

Neither unit may be able to write to the other, and a fault on the sensor tap must not propagate through a shared line.

## Software mapping

- `RecorderSource` (in `hardware.ts`) is the seam: a future `Esp32SerialSource` would implement `readRecords()` by dumping the SD
  log over USB-serial, decoding frames with `decodeRecordFrame`, and returning them to the unchanged recovery engine.
- `mediaState()` must come from the device (SD init/read errors), not be inferred by the app.
- Remote copy: a comms unit batches frames per `docs/PROTOCOL.md`; a ground service would ack and persist them. The backend here
  does **not** have an ingest endpoint for frames — deliberately, since nothing can produce them yet.

## Suggested validation plan (when hardware exists)

1. Bench: feed both ESP32s from one signal generator; compare logs with the Recovery Lab (expect 100 % validated, 0 conflicts).
2. Fault: cut power to the primary mid-write; measure torn-write count (the sim assumes 2).
3. Fault: pull the SD card / corrupt sectors; confirm CRC failures are detected, not hidden.
4. Link: interrupt the uplink; confirm queue, retransmission and duplicate handling.
5. Document measured numbers; replace simulation assumptions only with measured ones.
