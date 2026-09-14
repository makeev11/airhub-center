"""Durable bounded receipt queue; provider ACK follows an SQLite commit."""

from __future__ import annotations

import asyncio
import json
import time
from .spool import InboundSpool


class WhatsAppStatusSpool(InboundSpool):
    async def put_statuses(self, receipts: list[dict]) -> None:
        await asyncio.to_thread(self._put_statuses, receipts)

    def _put_statuses(self, receipts: list[dict]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with self._connect() as db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS whatsapp_statuses (receipt_key TEXT PRIMARY KEY, payload TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, next_attempt_at REAL NOT NULL DEFAULT 0, created_at REAL NOT NULL)"
            )
            now = time.time()
            # Keep dedupe evidence for a week, including uncorrelated provider IDs.
            db.execute(
                "DELETE FROM whatsapp_statuses WHERE created_at < ?", (now - 7 * 86400,)
            )
            pending = db.execute(
                "SELECT count(*) FROM whatsapp_statuses WHERE done=0"
            ).fetchone()[0]
            for receipt in receipts:
                key = json.dumps(
                    [
                        receipt["providerMessageId"],
                        receipt["status"],
                        receipt["timestamp"],
                    ],
                    separators=(",", ":"),
                )
                if db.execute(
                    "SELECT 1 FROM whatsapp_statuses WHERE receipt_key=?", (key,)
                ).fetchone():
                    continue
                if pending >= 10000:
                    raise OverflowError("WhatsApp status spool is full")
                db.execute(
                    "INSERT INTO whatsapp_statuses(receipt_key,payload,created_at) VALUES(?,?,?)",
                    (key, json.dumps(receipt), now),
                )
                pending += 1

    async def due_statuses(self) -> list[tuple[str, dict]]:
        await self.put_statuses([])
        return await asyncio.to_thread(self._due_statuses)

    def _due_statuses(self) -> list[tuple[str, dict]]:
        with self._connect() as db:
            return [
                (r["receipt_key"], json.loads(r["payload"]))
                for r in db.execute(
                    "SELECT receipt_key,payload FROM whatsapp_statuses WHERE done=0 AND next_attempt_at<=? ORDER BY created_at LIMIT 100",
                    (time.time(),),
                )
            ]

    async def finish_status(self, key: str, recorded: bool) -> None:
        await asyncio.to_thread(self._finish_status, key, recorded)

    def _finish_status(self, key: str, recorded: bool) -> None:
        with self._connect() as db:
            db.execute(
                "UPDATE whatsapp_statuses SET done=?,next_attempt_at=? WHERE receipt_key=?",
                (int(recorded), time.time() + 30, key),
            )

    async def begin_send(self, outbox_id: str) -> bool:
        return await asyncio.to_thread(self._begin_send, outbox_id)

    def _begin_send(self, outbox_id: str) -> bool:
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with self._connect() as db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS whatsapp_sends (outbox_id TEXT PRIMARY KEY, started_at REAL NOT NULL)"
            )
            return (
                db.execute(
                    "INSERT OR IGNORE INTO whatsapp_sends VALUES (?,?)",
                    (outbox_id, time.time()),
                ).rowcount
                == 1
            )

    async def rejected_send(self, outbox_id: str) -> None:
        await asyncio.to_thread(self._rejected_send, outbox_id)

    def _rejected_send(self, outbox_id: str) -> None:
        with self._connect() as db:
            db.execute("DELETE FROM whatsapp_sends WHERE outbox_id=?", (outbox_id,))
