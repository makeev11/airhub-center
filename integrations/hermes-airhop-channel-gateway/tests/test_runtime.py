from __future__ import annotations

import asyncio
from dataclasses import dataclass
import hashlib
from pathlib import Path
import tempfile
import time
import unittest
from uuid import UUID

from airhop_hermes_gateway.client import RouteResolution
from airhop_hermes_gateway.config import Settings
from airhop_hermes_gateway.runtime import TelegramGatewayRuntime


@dataclass
class FakeSource:
    chat_id: str
    chat_type: str = "dm"
    thread_id: str | None = None


@dataclass
class FakeEvent:
    text: str
    platform_update_id: int
    source: FakeSource
    message_type: str = "text"
    message_id: str = "1"


@dataclass
class FakeSendResult:
    success: bool
    message_id: str | None = None
    retryable: bool = False
    retry_after: float | None = None
    error_kind: str | None = None


class FakeSigner:
    public_key_hex = "11" * 32

    def sign_event(self, *, kind, content, tags, created_at=None):
        created_at = int(time.time()) if created_at is None else created_at
        material = repr((kind, content, tags, created_at)).encode()
        event_id = hashlib.sha256(material).hexdigest()
        return {
            "id": event_id,
            "pubkey": self.public_key_hex,
            "created_at": created_at,
            "kind": kind,
            "tags": tags,
            "content": content,
            "sig": "22" * 64,
        }


class FakeAdapter:
    def __init__(self, send_result=None):
        self.handler = None
        self.durable_handler = None
        self.is_connected = False
        self.connected = asyncio.Event()
        self.sent = []
        self.send_result = send_result or FakeSendResult(True, "tg-1")

    def set_message_handler(self, handler):
        self.handler = handler

    def set_durable_message_handler(self, handler):
        self.durable_handler = handler

    async def connect(self):
        self.is_connected = True
        self.connected.set()
        return True

    async def disconnect(self):
        self.is_connected = False

    async def send(self, chat_id, content, reply_to=None, metadata=None):
        self.sent.append((chat_id, content, metadata))
        return self.send_result

    async def emit(self, event):
        if self.durable_handler is not None:
            self.durable_handler(event)
        else:
            await self.handler(event)


class FakeClient:
    def __init__(self, outbound_jobs=None):
        self.resolve_gate = asyncio.Event()
        self.resolve_gate.set()
        self.ingested = []
        self.heartbeats = []
        self.completed = []
        self.outbound_jobs = list(outbound_jobs or [])
        self.closed = False

    async def resolve_route(self, provider_chat_id):
        await self.resolve_gate.wait()
        return RouteResolution(
            conversation_id="10000000-0000-0000-0000-000000000001",
            channel_id="20000000-0000-0000-0000-000000000002",
            route_status="active",
            connection_status="active",
        )

    async def ingest(self, provider_event_id, event):
        self.ingested.append((provider_event_id, event))
        return {"accepted": True, "duplicate": False}

    async def heartbeat(self, **kwargs):
        self.heartbeats.append(kwargs)
        return {}

    async def claim(self, **kwargs):
        if self.outbound_jobs:
            jobs, self.outbound_jobs = self.outbound_jobs, []
            return jobs
        return []

    async def complete_delivered(self, **kwargs):
        self.completed.append(("delivered", kwargs))
        return {}

    async def complete_failed(self, **kwargs):
        self.completed.append(("failed", kwargs))
        return {}

    async def close(self):
        self.closed = True


def outbound_job(connection_id: str) -> dict:
    return {
        "outboxId": "30000000-0000-0000-0000-000000000003",
        "leaseToken": "40000000-0000-0000-0000-000000000004",
        "connectionId": connection_id,
        "provider": "telegram",
        "providerChatId": "42",
        "idempotencyKey": "abc",
        "event": {"content": "Андрей, всё готово. Запись подтверждена."},
    }


async def wait_until(predicate, timeout=2.0):
    deadline = asyncio.get_running_loop().time() + timeout
    while not predicate():
        if asyncio.get_running_loop().time() >= deadline:
            raise AssertionError("condition was not reached")
        await asyncio.sleep(0.01)


class TelegramGatewayRuntimeTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.connection_id = UUID("50000000-0000-0000-0000-000000000005")
        self.settings = Settings(
            relay_url="https://center.example",
            connection_id=self.connection_id,
            connector_secret_key="01" * 32,
            telegram_bot_token="secret",
            state_path=Path(self.tempdir.name) / "state.sqlite3",
            heartbeat_seconds=0.05,
            claim_interval_seconds=0.01,
            inbound_interval_seconds=0.01,
        )

    async def asyncTearDown(self):
        self.tempdir.cleanup()

    async def test_fake_telegram_round_trip_is_durable_deduplicated_and_ordered(self):
        adapter = FakeAdapter()
        client = FakeClient([outbound_job(str(self.connection_id))])
        client.resolve_gate.clear()
        runtime = TelegramGatewayRuntime(
            settings=self.settings,
            adapter=adapter,
            client=client,
            signer=FakeSigner(),
        )
        stop = asyncio.Event()
        task = asyncio.create_task(runtime.run(stop))
        await adapter.connected.wait()

        inbound = FakeEvent("/start super-secret-grant", 700, FakeSource("42"))
        await adapter.emit(inbound)
        await adapter.emit(inbound)
        client.resolve_gate.set()

        await wait_until(lambda: len(client.ingested) == 1)
        await wait_until(lambda: len(client.completed) == 1)
        provider_event_id, event = client.ingested[0]
        self.assertEqual(provider_event_id, "telegram:update:700")
        self.assertEqual(event["content"], "/start")
        self.assertNotIn("super-secret-grant", repr(event))
        self.assertIn(
            ["h", "20000000-0000-0000-0000-000000000002"], event["tags"]
        )
        self.assertEqual(
            adapter.sent,
            [
                (
                    "42",
                    "Андрей, всё готово. Запись подтверждена.",
                    {"notify": True, "airhop_idempotency_key": "abc"},
                )
            ],
        )
        self.assertEqual(client.completed[0][0], "delivered")

        stop.set()
        await task
        self.assertTrue(client.closed)
        self.assertEqual(client.heartbeats[-1]["observed_status"], "offline")

    async def test_permanent_provider_failure_is_completed_without_retry_loop(self):
        adapter = FakeAdapter(
            FakeSendResult(False, error_kind="forbidden", retryable=False)
        )
        client = FakeClient([outbound_job(str(self.connection_id))])
        runtime = TelegramGatewayRuntime(
            settings=self.settings,
            adapter=adapter,
            client=client,
            signer=FakeSigner(),
        )
        stop = asyncio.Event()
        task = asyncio.create_task(runtime.run(stop))
        await adapter.connected.wait()
        await wait_until(lambda: len(client.completed) == 1)
        status, completion = client.completed[0]
        self.assertEqual(status, "failed")
        self.assertFalse(completion["retryable"])
        self.assertEqual(completion["retry_after_seconds"], 0)
        self.assertEqual(completion["error_code"], "telegram_forbidden")
        stop.set()
        await task


class SettingsTest(unittest.TestCase):
    def test_webhook_requires_secret_and_never_places_secrets_in_repr(self):
        env = {
            "AIRHOP_RELAY_URL": "https://center.example",
            "AIRHOP_CONNECTION_ID": "50000000-0000-0000-0000-000000000005",
            "AIRHOP_CONNECTOR_SECRET_KEY": "01" * 32,
            "TELEGRAM_BOT_TOKEN": "telegram-secret",
            "TELEGRAM_WEBHOOK_URL": "https://gateway.example/telegram",
        }
        with self.assertRaisesRegex(ValueError, "TELEGRAM_WEBHOOK_SECRET"):
            Settings.from_env(env)
        env["TELEGRAM_WEBHOOK_SECRET"] = "webhook-secret"
        settings = Settings.from_env(env)
        self.assertTrue(settings.webhook_mode)
        self.assertNotIn("telegram-secret", repr(settings))
        self.assertNotIn("webhook-secret", repr(settings))


if __name__ == "__main__":
    unittest.main()
