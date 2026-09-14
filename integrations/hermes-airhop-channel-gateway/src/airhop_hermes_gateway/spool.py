"""Small durable local inbox closing the provider-ACK-to-relay crash gap."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from contextlib import contextmanager
import json
import os
from pathlib import Path
import sqlite3
import time
from typing import Any, Iterator


@dataclass(frozen=True)
class InboundItem:
    provider_event_id: str
    provider_chat_id: str
    content: str
    received_at: int
    attempts: int
    event: dict[str, Any] | None
    handoff_token_digest: str | None = None


class InboundSpool:
    def __init__(self, path: Path):
        self.path = path

    async def initialize(self) -> None:
        await asyncio.to_thread(self._initialize)

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=10.0)
        try:
            os.chmod(self.path, 0o600)
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA synchronous=FULL")
            connection.execute("PRAGMA busy_timeout=10000")
            with connection:
                yield connection
        finally:
            connection.close()

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
            columns = {row[1] for row in connection.execute("PRAGMA table_info(inbound_spool)")}
            if "handoff_token_digest" not in columns:
                connection.execute("ALTER TABLE inbound_spool ADD COLUMN handoff_token_digest TEXT")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS runtime_state (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at REAL NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS provider_contact_activity (
                    provider_chat_id TEXT PRIMARY KEY,
                    last_inbound_at INTEGER NOT NULL,
                    updated_at REAL NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS outbound_receipts (
                    outbox_id TEXT PRIMARY KEY,
                    provider_message_id TEXT NOT NULL,
                    created_at REAL NOT NULL
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
        handoff_token_digest: str | None = None,
        touch_inbound_at: int | None = None,
    ) -> bool:
        return await asyncio.to_thread(
            self._put,
            provider_event_id,
            provider_chat_id,
            content,
            received_at,
            handoff_token_digest,
            touch_inbound_at,
        )

    def put_sync(
        self,
        *,
        provider_event_id: str,
        provider_chat_id: str,
        content: str,
        received_at: int,
        handoff_token_digest: str | None = None,
        touch_inbound_at: int | None = None,
    ) -> bool:
        """Commit provider inbound before its SDK handler may acknowledge it."""
        return self._put(
            provider_event_id,
            provider_chat_id,
            content,
            received_at,
            handoff_token_digest,
            touch_inbound_at,
        )

    def _put(
        self,
        provider_event_id: str,
        provider_chat_id: str,
        content: str,
        received_at: int,
        handoff_token_digest: str | None = None,
        touch_inbound_at: int | None = None,
    ) -> bool:
        now = time.time()
        with self._connect() as connection:
            result = connection.execute(
                "INSERT OR IGNORE INTO inbound_spool ("
                "provider_event_id, provider_chat_id, content, received_at, updated_at, handoff_token_digest"
                ") VALUES (?, ?, ?, ?, ?, ?)",
                (provider_event_id, provider_chat_id, content, received_at, now, handoff_token_digest),
            )
            if touch_inbound_at is not None:
                connection.execute(
                    "INSERT INTO provider_contact_activity ("
                    "provider_chat_id, last_inbound_at, updated_at) VALUES (?, ?, ?) "
                    "ON CONFLICT(provider_chat_id) DO UPDATE SET "
                    "last_inbound_at = max(last_inbound_at, excluded.last_inbound_at), "
                    "updated_at = excluded.updated_at",
                    (provider_chat_id, touch_inbound_at, now),
                )
            return result.rowcount == 1

    async def set_runtime_state(self, key: str, value: str) -> None:
        await asyncio.to_thread(self._set_runtime_state, key, value)

    def _set_runtime_state(self, key: str, value: str) -> None:
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO runtime_state (key, value, updated_at) VALUES (?, ?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value, "
                "updated_at = excluded.updated_at",
                (key, value, time.time()),
            )

    async def get_runtime_state(self, key: str) -> str | None:
        return await asyncio.to_thread(self._get_runtime_state, key)

    def _get_runtime_state(self, key: str) -> str | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT value FROM runtime_state WHERE key = ?", (key,)
            ).fetchone()
            return str(row["value"]) if row is not None else None

    async def last_inbound_at(self, provider_chat_id: str) -> int | None:
        return await asyncio.to_thread(self._last_inbound_at, provider_chat_id)

    def _last_inbound_at(self, provider_chat_id: str) -> int | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT last_inbound_at FROM provider_contact_activity "
                "WHERE provider_chat_id = ?",
                (provider_chat_id,),
            ).fetchone()
            return int(row["last_inbound_at"]) if row is not None else None

    async def record_outbound_receipt(
        self, outbox_id: str, provider_message_id: str
    ) -> None:
        await asyncio.to_thread(
            self._record_outbound_receipt, outbox_id, provider_message_id
        )

    def _record_outbound_receipt(
        self, outbox_id: str, provider_message_id: str
    ) -> None:
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO outbound_receipts (outbox_id, provider_message_id, created_at) "
                "VALUES (?, ?, ?) ON CONFLICT(outbox_id) DO NOTHING",
                (outbox_id, provider_message_id, time.time()),
            )

    async def outbound_receipt(self, outbox_id: str) -> str | None:
        return await asyncio.to_thread(self._outbound_receipt, outbox_id)

    def _outbound_receipt(self, outbox_id: str) -> str | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT provider_message_id FROM outbound_receipts WHERE outbox_id = ?",
                (outbox_id,),
            ).fetchone()
            return str(row["provider_message_id"]) if row is not None else None

    async def prune_outbound_receipts(self, retention_seconds: int) -> int:
        return await asyncio.to_thread(
            self._prune_outbound_receipts, retention_seconds
        )

    def _prune_outbound_receipts(self, retention_seconds: int) -> int:
        cutoff = time.time() - retention_seconds
        with self._connect() as connection:
            result = connection.execute(
                "DELETE FROM outbound_receipts WHERE created_at < ?", (cutoff,)
            )
            return result.rowcount

    async def claim(self) -> InboundItem | None:
        return await asyncio.to_thread(self._claim)

    def _claim(self) -> InboundItem | None:
        now = time.time()
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT provider_event_id, provider_chat_id, content, received_at, "
                "attempts, event_json, handoff_token_digest FROM inbound_spool "
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
                handoff_token_digest=row["handoff_token_digest"],
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

    async def reject_thread_candidate(self, provider_event_id: str) -> None:
        """Discard only a candidate explicitly rejected before relay insertion."""
        await asyncio.to_thread(self._reject_thread_candidate, provider_event_id)

    def _reject_thread_candidate(self, provider_event_id: str) -> None:
        with self._connect() as db:
            db.execute(
                "UPDATE inbound_spool SET event_json=NULL, status='pending', "
                "next_attempt_at=?, last_error_code='thread_changed', updated_at=? "
                "WHERE provider_event_id=? AND status='processing'",
                (time.time() + 0.1, time.time(), provider_event_id),
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
