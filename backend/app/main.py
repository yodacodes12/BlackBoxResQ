"""BlackBoxResQ persistence API (research prototype, local use, no authentication).

Stores recovery-test results and simulation audit events. It never receives or serves real aircraft data.
"""
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

from . import db

VERSION = "0.1.0"
ID = Field(min_length=1, max_length=64)


class TestIn(BaseModel):
    session_id: str = ID
    client_id: str = ID
    test: dict[str, Any]


class EventIn(BaseModel):
    tick: int = Field(ge=0)
    kind: str = Field(min_length=1, max_length=40)
    severity: Literal["info", "success", "warning", "error"]
    message: str = Field(max_length=500)


class EventsIn(BaseModel):
    session_id: str = ID
    run_id: str = ID
    events: list[EventIn] = Field(max_length=1000)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _summary(test: dict[str, Any]) -> dict[str, Any]:
    """Pull the columns we index on; reject payloads that are not recovery tests."""
    try:
        r = test["result"]
        c = r["counts"]
        return {
            "scenario_id": str(test["scenarioId"]),
            "scenario_name": str(test["scenarioName"]),
            "flight_id": str(test["flightId"]),
            "expected": int(r["expected"]),
            "validated": int(c["validated"]),
            "inconsistent": int(c["inconsistent"]),
            "missing": int(c["missing"]),
            "corrupted": int(c["corrupted"]),
            "recovery_pct": None if r.get("recoveryPct") is None else float(r["recoveryPct"]),
            "duration_ms": float(r["durationMs"]),
        }
    except (KeyError, TypeError, ValueError) as e:
        raise HTTPException(422, f"test payload is not a recovery test: {e!r}") from e


def create_app(db_path: Path | str = db.DEFAULT_DB) -> FastAPI:
    app = FastAPI(title="BlackBoxResQ API", version=VERSION)
    db.init(db_path)

    def conn() -> sqlite3.Connection:
        return db.connect(db_path)

    @app.get("/api/health")
    def health():
        return {"status": "ok", "version": VERSION}

    @app.post("/api/tests", status_code=201)
    def add_test(body: TestIn):
        cols = _summary(body.test)
        with conn() as c:
            row = c.execute("SELECT id FROM tests WHERE session_id=? AND client_id=?", (body.session_id, body.client_id)).fetchone()
            if row:  # idempotent retry
                return {"id": row["id"], "duplicate": True}
            n = c.execute("SELECT COALESCE(MAX(CAST(SUBSTR(id, 4) AS INTEGER)), 0) + 1 FROM tests").fetchone()[0]
            tid = f"RT-{n:03d}"
            payload = {**body.test, "id": tid}
            c.execute(
                "INSERT INTO tests (id, session_id, client_id, created_at, scenario_id, scenario_name, flight_id, expected, validated,"
                " inconsistent, missing, corrupted, recovery_pct, duration_ms, payload) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (tid, body.session_id, body.client_id, _now(), cols["scenario_id"], cols["scenario_name"], cols["flight_id"],
                 cols["expected"], cols["validated"], cols["inconsistent"], cols["missing"], cols["corrupted"],
                 cols["recovery_pct"], cols["duration_ms"], json.dumps(payload)),
            )
        return {"id": tid, "duplicate": False}

    @app.get("/api/tests")
    def list_tests(limit: int = Query(200, ge=1, le=500)):
        with conn() as c:
            rows = c.execute("SELECT payload, created_at FROM tests ORDER BY seq DESC LIMIT ?", (limit,)).fetchall()
        return [{**json.loads(r["payload"]), "createdAt": r["created_at"]} for r in reversed(rows)]

    @app.get("/api/tests/{test_id}")
    def get_test(test_id: str):
        with conn() as c:
            r = c.execute("SELECT payload, created_at FROM tests WHERE id=?", (test_id,)).fetchone()
        if not r:
            raise HTTPException(404, "test not found")
        return {**json.loads(r["payload"]), "createdAt": r["created_at"]}

    @app.post("/api/events", status_code=201)
    def add_events(body: EventsIn):
        now = _now()
        with conn() as c:
            c.executemany(
                "INSERT INTO events (session_id, run_id, created_at, tick, kind, severity, message) VALUES (?,?,?,?,?,?,?)",
                [(body.session_id, body.run_id, now, e.tick, e.kind, e.severity, e.message) for e in body.events],
            )
        return {"stored": len(body.events)}

    @app.get("/api/events")
    def list_events(limit: int = Query(100, ge=1, le=1000), run_id: str | None = None):
        q, args = "SELECT * FROM events", []
        if run_id:
            q += " WHERE run_id=?"
            args.append(run_id)
        q += " ORDER BY id DESC LIMIT ?"
        args.append(limit)
        with conn() as c:
            rows = c.execute(q, args).fetchall()
        return [dict(r) for r in reversed(rows)]

    return app


app = create_app(os.environ.get("BBQ_DB", db.DEFAULT_DB))
