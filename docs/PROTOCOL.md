# Proposed recorder wire protocol (v1) — DRAFT

> **Status: specification and reference codecs only.** No ESP32 firmware, serial/Wi-Fi transport or physical recorder
> exists in this repository, and none of this has been tested against hardware. Codecs are tested against each other
> (TypeScript ↔ Python) with a shared golden vector, nothing more.

Implementations: `src/lib/hardware.ts` (encoder + decoder), `backend/app/protocol.py` (decoder).
Tests: `src/lib/hardware.test.ts`, `backend/tests/test_protocol.py`.

All multi-byte integers are **little-endian**. No padding.

## Record frame — 45 bytes (type 1)

| Offset | Size | Field | Encoding |
|---:|---:|---|---|
| 0 | 2 | magic | `B1 AC` |
| 2 | 1 | version | `1` |
| 3 | 1 | type | `1` = record |
| 4 | 1 | recorder_id | `1` PRIMARY, `2` BACKUP |
| 5 | 12 | flight_id | ASCII, NUL-padded |
| 17 | 4 | sequence_id | u32, per-recorder counter, starts at 0 |
| 21 | 8 | timestamp_ms | u64, Unix epoch ms (UTC) |
| 29 | 4 | altitude | i32, ft × 10 |
| 33 | 2 | speed | u16, kt × 10 |
| 35 | 2 | pitch | i16, deg × 100 |
| 37 | 2 | roll | i16, deg × 100 |
| 39 | 2 | yaw | u16, deg × 10 (heading 0–359.9) |
| 41 | 4 | crc32 | CRC-32/IEEE over bytes 0–40 |

## Ack frame — 21 bytes (type 2)

`magic(2) version(1) type=2(1) sender_id(1) batch_id u32  first_seq u32  last_seq u32  crc32 u32` (CRC over bytes 0–16).
Sender `3` = REMOTE (ground copy). An ack means "records first..last were received and stored", nothing about durability.

## Rules

1. Receivers drop frames with bad length, magic, version, unknown ids or CRC mismatch, and count them; they never repair them.
2. `sequence_id` is assigned by each recorder independently. Both recorders sample the same sensor tap; matching records are
   aligned by `(flight_id, sequence_id)`, so the two recorders must start from the same sequence base (open item, below).
3. Remote batches: the aircraft-side comms unit sends up to 10 consecutive frames; the ground side acks the range.
   Unacknowledged ranges are retransmitted; the ground store is an append-only log and duplicates are resolved at recovery time.
4. CRC-32 detects accidental corruption only. It provides **no authentication or tamper evidence**. If that is needed,
   add a MAC (e.g. HMAC-SHA-256 truncated) in v2 with proper key management.

## Open items before any hardware claim

- The app's `integrity_checksum` is a CRC over a canonical *text* payload; firmware would naturally CRC the *binary* frame.
  The decoder recomputes the app form on receipt (works today), but the stored-log format should be unified.
- Sequence alignment between two independent MCUs needs a defined handshake (e.g., sequence = floor((time − t0)/period) from a shared time source).
- SD-card log format (append-only, per-frame CRC, periodic sync) and power-fail behaviour need to be specified and measured.
- Range limits: altitude ±214,748,364.7 ft, speed ≤ 6,553.5 kt; encoder throws `RangeError` outside them.
