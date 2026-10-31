import struct
import zlib

import pytest

from app import protocol as p

# Same bytes asserted in src/lib/hardware.test.ts
GOLDEN_RECORD_HEX = "b1ac0101014242512d53494d2d303030312a000000109d00799b01000040e201008f0c1fffe204900a145de7c7"


def test_golden_record_decodes_and_lengths():
    assert p.RECORD_LEN == 45 and p.ACK_LEN == 21
    d = p.decode_record(bytes.fromhex(GOLDEN_RECORD_HEX))
    assert d["flight_id"] == "BBQ-SIM-0001" and d["sequence_id"] == 42 and d["source_id"] == "PRIMARY"
    assert d["altitude"] == 12345.6 and d["speed"] == 321.5 and d["pitch"] == -2.25 and d["roll"] == 12.5 and d["yaw"] == 270.4
    assert d["timestamp"] == "2026-01-01T10:00:42.000Z"


def _frame(over):
    f = bytearray(bytes.fromhex(GOLDEN_RECORD_HEX))
    for k, v in over.items():
        f[k] = v
    f[-4:] = struct.pack("<I", zlib.crc32(bytes(f[:-4])))
    return bytes(f)


def test_rejects_bad_frames():
    good = bytes.fromhex(GOLDEN_RECORD_HEX)
    with pytest.raises(p.FrameError, match="crc"):
        p.decode_record(good[:17] + bytes([good[17] ^ 1]) + good[18:])
    with pytest.raises(p.FrameError, match="length"):
        p.decode_record(good[:-1])
    with pytest.raises(p.FrameError, match="magic"):
        p.decode_record(_frame({0: 0}))
    with pytest.raises(p.FrameError, match="version"):
        p.decode_record(_frame({2: 9}))
    with pytest.raises(p.FrameError, match="recorder"):
        p.decode_record(_frame({4: 9}))


def test_ack_roundtrip():
    body = struct.pack("<2sBBBIII", p.MAGIC, 1, 2, 3, 7, 10, 19)
    frame = body + struct.pack("<I", zlib.crc32(body))
    assert p.decode_ack(frame) == {"sender": "REMOTE", "batch_id": 7, "first_seq": 10, "last_seq": 19}
