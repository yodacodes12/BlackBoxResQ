"""Reference decoder for the proposed BlackBoxResQ recorder wire protocol (see docs/PROTOCOL.md).

NOT connected to any hardware. Kept byte-compatible with src/lib/hardware.ts (shared golden vector in tests).
"""
import struct
import zlib
from datetime import datetime, timedelta, timezone

MAGIC = b"\xb1\xac"
VERSION = 1
TYPE_RECORD, TYPE_ACK = 1, 2
RECORDER_NAMES = {1: "PRIMARY", 2: "BACKUP", 3: "REMOTE"}
_REC = struct.Struct("<2sBBB12sIQiHhhHI")
_ACK = struct.Struct("<2sBBBIIII")
RECORD_LEN, ACK_LEN = _REC.size, _ACK.size  # 45, 21


class FrameError(ValueError):
    pass


def _check(frame: bytes, size: int) -> None:
    if len(frame) != size:
        raise FrameError(f"bad length {len(frame)}, expected {size}")
    if frame[:2] != MAGIC:
        raise FrameError("bad magic")
    if frame[2] != VERSION:
        raise FrameError(f"unsupported version {frame[2]}")
    if zlib.crc32(frame[:-4]) != struct.unpack("<I", frame[-4:])[0]:
        raise FrameError("crc mismatch")


def decode_record(frame: bytes) -> dict:
    _check(frame, RECORD_LEN)
    _, _, typ, rid, fid, seq, ts, alt, spd, pit, rol, yaw, crc = _REC.unpack(frame)
    if typ != TYPE_RECORD:
        raise FrameError("not a record frame")
    if rid not in RECORDER_NAMES:
        raise FrameError(f"unknown recorder id {rid}")
    dt = datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(milliseconds=ts)
    return {
        "flight_id": fid.rstrip(b"\x00").decode("ascii"),
        "sequence_id": seq,
        "timestamp": dt.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "altitude": alt / 10,
        "speed": spd / 10,
        "pitch": pit / 100,
        "roll": rol / 100,
        "yaw": yaw / 10,
        "source_id": RECORDER_NAMES[rid],
        "frame_crc32": f"{crc:08x}",
    }


def decode_ack(frame: bytes) -> dict:
    _check(frame, ACK_LEN)
    _, _, typ, sid, batch, first, last, _crc = _ACK.unpack(frame)
    if typ != TYPE_ACK:
        raise FrameError("not an ack frame")
    return {"sender": RECORDER_NAMES.get(sid, sid), "batch_id": batch, "first_seq": first, "last_seq": last}
