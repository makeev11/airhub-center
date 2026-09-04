"""Small durable local inbox closing the provider-ACK-to-relay crash gap."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
import json
import os
from pathlib import Path
import sqlite3
import time
from typing import Any


@dataclass(frozen=True)
class InboundItem:
    provider_event_id: str
    provider_chat_id: str
    content: str
    received_at: int
    attempts: int
    event: dict[str, Any] | None


class InboundSpool:
    def __init__(self, path: Path):
        self.path = path

    async def initialize(self) -> None:
        await asyncio.to_thread(self._initialize)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=10.0)
        try:
            os.chmod(self.path, 0o600)
        except FileNotFoundError:
            pass
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA synchronous=FULL")
        connection.execute("PRAGMA busy_timeout=10000")
        return connection

    def _initialize(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.path.parent, 0o700)
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS inbound_spool (
                    provider_event_id TEXT PRIMARY KEY,
                    provider_chat_id TEXT NOT NULL,
                    content TEXT NOT NULL,
                    received_at INTEGER NOT NULL,
                    event_json TEXT,
                    status TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'processing', 'dead')),
                    attempts INTEGER NOT NULL DEFAULT 0,
                    next_attempt_at REAL NOT NULL DEFAULT 0,
                    last_error_code TEXT,
                    updated_at REAL NOT NULL
                )
                """
            )
            connection.execute(
                "UPDATE inbound_spool SET status = 'pending', next_attempt_at = 0 "
                "WHERE status = 'processing'"
            )

    async def put(
        self,
        *,
        provider_event_id: str,
        provider_chat_id: str,
        content: str,
        received_at: int,
    ) -> bool:
        return await asyncio.to_thread(
            self._put,
            provider_event_id,
            provider_chat_id,
            content,
            received_at,
        )

    def put_sync(
        self,
        *,
        provider_event_id: str,
        provider_chat_id: str,
        content: str,
        received_at: int,
    ) -> bool:
        """Commit provider inbound before its SDK handler may acknowledge it."""
        return self._put(
            provider_event_id,
            provider_chat_id,
            content,
            received_at,
        )

    def _put(
        self,
        provider_event_id: str,
        provider_chat_id: str,
        content: str,
        received_at: int,
    ) -> bool:
        now = time.time()
        with self._connect() as connection:
            result = connection.execute(
                "INSERT OR IGNORE INTO inbound_spool ("
                "provider_event_id, provider_chat_id, content, received_at, updated_at"
                ") VALUES (?, ?, ?, ?, ?)",
                (provider_event_id, provider_chat_id, content, received_at, now),
            )
            return result.rowcount == 1

    async def claim(self) -> InboundItem | None:
        return await asyncio.to_thread(self._claim)

    def _claim(self) -> InboundItem | None:
        now = time.time()
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT provider_event_id, provider_chat_id, content, received_at, "
                "attempts, event_json FROM inbound_spool "
                "WHERE status = 'pending' AND next_attempt_at <= ? "
                "ORDER BY received_at, provider_event_id LIMIT 1",
                (now,),
            ).fetchone()
            if row is None:
                connection.commit()
                return None
            connection.execute(
                "UPDATE inbound_spool SET status = 'processing', attempts = attempts + 1, "
                "updated_at = ? WHERE provider_event_id = ?",
                (now, row["provider_event_id"]),
            )
            connection.commit()
            event = json.loads(row["event_json"]) if row["event_json"] else None
            return InboundItem(
                provider_event_id=row["provider_event_id"],
                provider_chat_id=row["provider_chat_id"],
                content=row["content"],
                received_at=row["received_at"],
                attempts=row["attempts"] + 1,
                event=event,
            )

    async def persist_event(self, provider_event_id: str, event: dict[str, Any]) -> None:
        await asyncio.to_thread(self._persist_event, provider_event_id, event)

    def _persist_event(self, provider_event_id: str, event: dict[str, Any]) -> None:
        encoded = json.dumps(event, ensure_ascii=False, separators=(",", ":"))
        with self._connect() as connection:
            connection.execute(
                "UPDATE inbound_spool SET event_json = COALESCE(event_json, ?), "
                "updated_at = ? WHERE provider_event_id = ? AND status = 'processing'",
                (encoded, time.time(), provider_event_id),
            )

    async def delivered(self, provider_event_id: str) -> None:
        await asyncio.to_thread(self._delivered, provider_event_id)

    def _delivered(self, provider_event_id: str) -> None:
        with self._connect() as connection:
            connection.execute(
                "DELETE FROM inbound_spool WHERE provider_event_id = ?",
                (provider_event_id,),
            )

    async def retry(self, provider_event_id: str, error_code: str, delay: float) -> None:
        await asyncio.to_thread(self._retry, provider_event_id, error_code, delay)

    def _retry(self, provider_event_id: str, error_code: str, delay: float) -> None:
        now = time.time()
        with self._connect() as connection:
            connection.execute(
                "UPDATE inbound_spool SET status = 'pending', next_attempt_at = ?, "
                "last_error_code = ?, updated_at = ? WHERE provider_event_id = ?",
                (now + max(0.05, delay), error_code, now, provider_event_id),
            )

    async def dead(self, provider_event_id: str, error_code: str) -> None:
        await asyncio.to_thread(self._dead, provider_event_id, error_code)

    def _dead(self, provider_event_id: str, error_code: str) -> None:
        with self._connect() as connection:
            connection.execute(
                "UPDATE inbound_spool SET status = 'dead', last_error_code = ?, "
                "updated_at = ? WHERE provider_event_id = ?",
                (error_code, time.time(), provider_event_id),
            )

    async def counts(self) -> tuple[int, int]:
        return await asyncio.to_thread(self._counts)

    def _counts(self) -> tuple[int, int]:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT count(*) FILTER (WHERE status <> 'dead') AS pending, "
                "count(*) FILTER (WHERE status = 'dead') AS dead FROM inbound_spool"
            ).fetchone()
            return int(row["pending"]), int(row["dead"])

    async def prune_dead(self, retention_seconds: int) -> int:
        return await asyncio.to_thread(self._prune_dead, retention_seconds)

    def _prune_dead(self, retention_seconds: int) -> int:
        cutoff = time.time() - retention_seconds
        with self._connect() as connection:
            result = connection.execute(
                "DELETE FROM inbound_spool WHERE status = 'dead' AND updated_at < ?",
                (cutoff,),
            )
            return result.rowcount
