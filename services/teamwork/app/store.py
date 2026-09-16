from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class JobStore:
    def __init__(self, data_dir: Path):
        data_dir.mkdir(parents=True, exist_ok=True)
        self.path = data_dir / "jobs.sqlite3"
        self.lock = threading.Lock()
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=15)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self) -> None:
        with self.lock, self._connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute(
                """CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    request_json TEXT NOT NULL,
                    result_json TEXT,
                    error TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )"""
            )
            db.execute(
                "UPDATE jobs SET status = 'failed', error = 'Service restarted during analysis', updated_at = ? WHERE status IN ('queued', 'running')",
                (utc_now(),),
            )

    def create(self, request: dict[str, Any]) -> dict[str, Any]:
        job_id = uuid.uuid4().hex
        now = utc_now()
        with self.lock, self._connect() as db:
            db.execute(
                "INSERT INTO jobs (id, status, request_json, created_at, updated_at) VALUES (?, 'queued', ?, ?, ?)",
                (job_id, json.dumps(request), now, now),
            )
        return self.get(job_id) or {}

    def get(self, job_id: str) -> dict[str, Any] | None:
        with self.lock, self._connect() as db:
            row = db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if not row:
            return None
        return {
            "id": row["id"],
            "status": row["status"],
            "result": json.loads(row["result_json"]) if row["result_json"] else None,
            "error": row["error"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def request(self, job_id: str) -> dict[str, Any]:
        with self.lock, self._connect() as db:
            row = db.execute("SELECT request_json FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if not row:
            raise KeyError(job_id)
        return json.loads(row["request_json"])

    def running(self, job_id: str) -> None:
        self._update(job_id, status="running", error=None)

    def complete(self, job_id: str, result: dict[str, Any]) -> None:
        self._update(job_id, status="complete", result_json=json.dumps(result), error=None)

    def fail(self, job_id: str, error: str) -> None:
        self._update(job_id, status="failed", error=error[:1000])

    def _update(self, job_id: str, **values: Any) -> None:
        values["updated_at"] = utc_now()
        columns = ", ".join(f"{name} = ?" for name in values)
        with self.lock, self._connect() as db:
            db.execute(f"UPDATE jobs SET {columns} WHERE id = ?", (*values.values(), job_id))
