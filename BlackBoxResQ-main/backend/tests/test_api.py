import pytest
from fastapi.testclient import TestClient

from app.main import create_app


def sample(name="Nominal", validated=600):
    return {
        "scenarioId": "nominal", "scenarioName": name, "flightId": "BBQ-SIM-0001",
        "result": {"expected": 600, "counts": {"validated": validated, "inconsistent": 0, "missing": 600 - validated, "corrupted": 0},
                   "recoveryPct": validated / 6, "durationMs": 1.5, "rows": [{"sequence_id": 0}]},
    }


@pytest.fixture()
def client(tmp_path):
    return TestClient(create_app(tmp_path / "t.db"))


def test_health(client):
    assert client.get("/api/health").json()["status"] == "ok"


def test_store_and_list_roundtrip(client):
    r = client.post("/api/tests", json={"session_id": "s1", "client_id": "RT-001", "test": sample()})
    assert r.status_code == 201 and r.json() == {"id": "RT-001", "duplicate": False}
    r2 = client.post("/api/tests", json={"session_id": "s1", "client_id": "RT-002", "test": sample("Primary failure", 450)})
    assert r2.json()["id"] == "RT-002"
    tests = client.get("/api/tests").json()
    assert [t["id"] for t in tests] == ["RT-001", "RT-002"]
    assert tests[1]["result"]["counts"]["validated"] == 450
    assert tests[0]["result"]["rows"] == [{"sequence_id": 0}]  # full payload preserved
    assert client.get("/api/tests/RT-002").json()["scenarioName"] == "Primary failure"


def test_idempotent_retry_and_id_reassignment_across_sessions(client):
    a = client.post("/api/tests", json={"session_id": "s1", "client_id": "RT-001", "test": sample()}).json()
    again = client.post("/api/tests", json={"session_id": "s1", "client_id": "RT-001", "test": sample()}).json()
    assert again == {"id": a["id"], "duplicate": True}
    other = client.post("/api/tests", json={"session_id": "s2", "client_id": "RT-001", "test": sample()}).json()
    assert other["id"] == "RT-002"  # server assigns a unique id when two sessions collide
    assert len(client.get("/api/tests").json()) == 2


def test_rejects_malformed(client):
    assert client.post("/api/tests", json={"session_id": "s", "client_id": "c", "test": {"foo": 1}}).status_code == 422
    assert client.post("/api/tests", json={"session_id": "", "client_id": "c", "test": sample()}).status_code == 422
    assert client.post("/api/events", json={"session_id": "s", "run_id": "r", "events": [{"tick": -1, "kind": "x", "severity": "info", "message": "m"}]}).status_code == 422
    assert client.post("/api/events", json={"session_id": "s", "run_id": "r", "events": [{"tick": 1, "kind": "x", "severity": "bogus", "message": "m"}]}).status_code == 422
    assert client.get("/api/tests/NOPE").status_code == 404
    assert client.get("/api/tests").json() == []


def test_events(client):
    ev = [{"tick": i, "kind": "ack", "severity": "success", "message": f"m{i}"} for i in range(5)]
    assert client.post("/api/events", json={"session_id": "s", "run_id": "r1", "events": ev}).json() == {"stored": 5}
    client.post("/api/events", json={"session_id": "s", "run_id": "r2", "events": ev[:2]})
    assert len(client.get("/api/events").json()) == 7
    got = client.get("/api/events", params={"run_id": "r1", "limit": 3}).json()
    assert [e["message"] for e in got] == ["m2", "m3", "m4"]


def test_persists_across_app_restart(tmp_path):
    p = tmp_path / "p.db"
    TestClient(create_app(p)).post("/api/tests", json={"session_id": "s", "client_id": "RT-001", "test": sample()})
    assert len(TestClient(create_app(p)).get("/api/tests").json()) == 1
