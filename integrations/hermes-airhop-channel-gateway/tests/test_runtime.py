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
        self.handoff_digests = []
        self.handoff_status = "connected"

    async def resolve_route(self, provider_chat_id, handoff_token_digest=None):
        await self.resolve_gate.wait()
        self.handoff_digests.append(handoff_token_digest)
        return RouteResolution(
            conversation_id="10000000-0000-0000-0000-000000000001",
            channel_id="20000000-0000-0000-0000-000000000002",
            route_status="active",
            connection_status="active",
            handoff_status=self.handoff_status if handoff_token_digest else None,
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

    async def test_booking_start_survives_restart_without_persisting_raw_grant(self):
        client = FakeClient()
        runtime = TelegramGatewayRuntime(settings=self.settings, adapter=FakeAdapter(), client=client, signer=FakeSigner())
        await runtime.spool.initialize()
        token = "ahh_" + "a" * 43
        incoming = FakeEvent("/start " + token, 701, FakeSource("42"), message_type="command")
        runtime.handle_message_sync(incoming)
        runtime.handle_message_sync(incoming)
        for path in Path(self.tempdir.name).iterdir():
            if path.is_file(): self.assertNotIn(token.encode(), path.read_bytes())
        restarted = TelegramGatewayRuntime(settings=self.settings, adapter=FakeAdapter(), client=client, signer=FakeSigner())
        await restarted.spool.initialize()
        item = await restarted.spool.claim()
        self.assertEqual(item.content, "/start")
        self.assertEqual(item.handoff_token_digest, hashlib.sha256(token.encode()).hexdigest())
        await restarted._deliver_inbound(item)
        self.assertEqual(client.handoff_digests, [item.handoff_token_digest])
        self.assertEqual(len(client.ingested), 1)
        self.assertIn("Чат подтверждён", client.ingested[0][1]["content"])
        self.assertNotIn(token, repr(client.ingested))
        self.assertNotIn(item.handoff_token_digest, repr(client.ingested))
        self.assertIsNone(await restarted.spool.claim())

    async def test_invalid_start_never_claims_binding_success(self):
        client = FakeClient()
        client.handoff_status = "invalid"
        runtime = TelegramGatewayRuntime(settings=self.settings, adapter=FakeAdapter(), client=client, signer=FakeSigner())
        await runtime.spool.initialize()
        await runtime.handle_message(FakeEvent("/start ahh_" + "b" * 43, 702, FakeSource("42")))
        await runtime._deliver_inbound(await runtime.spool.claim())
        self.assertNotIn("Чат подтверждён", client.ingested[0][1]["content"])
        self.assertIn("недействительна", client.ingested[0][1]["content"])

    async def test_pasted_link_is_redacted_without_authenticating_the_sender(self):
        client = FakeClient()
        runtime = TelegramGatewayRuntime(settings=self.settings, adapter=FakeAdapter(), client=client, signer=FakeSigner())
        await runtime.spool.initialize()
        token = "ahh_" + "d" * 43
        await runtime.handle_message(FakeEvent("Помогите открыть https://t.me/center_bot?start=" + token, 704, FakeSource("42")))
        item = await runtime.spool.claim()
        self.assertNotIn(token, item.content)
        self.assertIsNone(item.handoff_token_digest)
        await runtime._deliver_inbound(item)
        self.assertEqual(client.handoff_digests, [None])
        self.assertNotIn(token, repr(client.ingested))

    async def test_conflicting_start_requests_staff_without_claiming_identity(self):
        client = FakeClient()
        client.handoff_status = "conflict"
        runtime = TelegramGatewayRuntime(settings=self.settings, adapter=FakeAdapter(), client=client, signer=FakeSigner())
        await runtime.spool.initialize()
        token = "ahh_" + "c" * 43
        await runtime.handle_message(FakeEvent("/start@center_bot " + token, 703, FakeSource("42"), message_type="command"))
        await runtime._deliver_inbound(await runtime.spool.claim())
        content = client.ingested[0][1]["content"]
        self.assertIn("проверка сотрудника", content)
        self.assertIn("handoffReason", content)
        self.assertNotIn("Чат подтверждён", content)
        self.assertNotIn(token, repr(client.ingested))

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

    async def test_unsupported_attachment_is_visible_durable_and_deduplicated(self):
        client = FakeClient()
        runtime = TelegramGatewayRuntime(settings=self.settings, adapter=FakeAdapter(), client=client, signer=FakeSigner())
        await runtime.spool.initialize()
        for index, media_type in enumerate(["voice", "audio", "photo", "document", "video"], start=800):
            event = FakeEvent("provider-secret-file-url", index, FakeSource("42"), message_type=media_type)
            await runtime.handle_message(event)
            await runtime.handle_message(event)
            item = await runtime.spool.claim()
            self.assertIsNotNone(item)
            await runtime._deliver_inbound(item)
        self.assertEqual(len(client.ingested), 5)
        for _, event in client.ingested:
            self.assertIn("неподдерживаемое вложение", event["content"])
            self.assertNotIn("provider-secret", event["content"])
        self.assertEqual(await runtime.spool.counts(), (0, 0))


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
