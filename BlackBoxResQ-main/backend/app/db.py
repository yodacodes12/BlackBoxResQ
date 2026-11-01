"""SQLite persistence. One short-lived connection per request; schema created on startup."""
import sqlite3
from pathlib import Path

DEFAULT_DB = Path(__file__).resolve().parent.parent / "data" / "blackboxresq.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS tests (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  scenario_id TEXT NOT NULL,
  scenario_name TEXT NOT NULL,
  flight_id TEXT NOT NULL,
  expected INTEGER NOT NULL,
  validated INTEGER NOT NULL,
  inconsistent INTEGER NOT NULL,
  missing INTEGER NOT NULL,
  corrupted INTEGER NOT NULL,
  recovery_pct REAL,
  duration_ms REAL NOT NULL,
  payload TEXT NOT NULL,
  UNIQUE(session_id, client_id)
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  tick INTEGER NOT NULL,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id, id);
"""


def connect(path: Path | str) -> sqlite3.Connection:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    return conn


def init(path: Path | str) -> None:
    with connect(path) as conn:
        conn.executescript(SCHEMA)
