from __future__ import annotations

import hashlib
import hmac
import json
from pathlib import Path
import tempfile
import time
import unittest
from uuid import UUID

import httpx

from airhop_hermes_gateway.client import RouteResolution, WhatsAppCredential
from airhop_hermes_gateway.config import WhatsAppSettings
from airhop_hermes_gateway.whatsapp import (
    GraphHealth,
    WhatsAppGatewayRuntime,
    WhatsAppGraphClient,
    WhatsAppSendResult,
    WhatsAppWebhookRouter,
)


class FakeSigner:
    def __init__(self):
        self.counter = 0

    def sign_event(self, *, kind, content, tags):
        self.counter += 1
        return {
            "id": f"event-{self.counter}",
            "kind": kind,
            "content": content,
            "tags": tags,
        }


class FakeClient:
    def __init__(self):
        self.ingested = []
        self.heartbeats = []
        self.completed = []
        self.closed = False

    async def resolve_route(self, provider_chat_id):
        self.provider_chat_id = provider_chat_id
        return RouteResolution(
            conversation_id="10000000-0000-0000-0000-000000000001",
            channel_id="20000000-0000-0000-0000-000000000002",
            route_status="active",
            connection_status="active",
        )

    async def ingest(self, provider_event_id, event):
        self.ingested.append((provider_event_id, event))
        return {"accepted": True}

    async def heartbeat(self, **values):
        self.heartbeats.append(values)
        return {}

    async def claim(self, **_values):
        return []

    async def complete_delivered(self, **values):
        self.completed.append(("delivered", values))
        return {}

    async def complete_failed(self, **values):
        self.completed.append(("failed", values))
        return {}

    async def close(self):
        self.closed = True


class FakeGraph:
    def __init__(self, send_result=None):
        self.send_result = send_result or WhatsAppSendResult(
            True, message_id="wamid.sent"
        )
        self.sent = []
        self.closed = False

    async def healthcheck(self):
        return GraphHealth(True)

    async def send_text(self, recipient, content):
        self.sent.append((recipient, content))
        return self.send_result

    async def close(self):
        self.closed = True


def webhook_payload(*, message_type="text", waba_id=None, phone_number_id=None):
    message = {
        "from": "5511999990000",
        "id": "wamid.inbound.1",
        "timestamp": str(int(time.time())),
        "type": message_type,
    }
    if message_type == "text":
        message["text"] = {"body": "Olá, quero marcar uma aula"}
    else:
        message[message_type] = {"id": "provider-secret-media-id"}
    return {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "id": waba_id or "234567890123456",
                "changes": [
                    {
                        "field": "messages",
                        "value": {
                            "metadata": {
                                "phone_number_id": phone_number_id
                                or "345678901234567"
                            },
                            "messages": [message],
                        },
                    }
                ],
            }
        ],
    }


def outbound_job(connection_id):
    return {
        "outboxId": "30000000-0000-0000-0000-000000000003",
        "leaseToken": "40000000-0000-0000-0000-000000000004",
        "connectionId": str(connection_id),
        "provider": "whatsapp_cloud",
        "providerChatId": "5511999990000",
        "event": {"content": "Tudo certo, a aula está confirmada."},
    }


class WhatsAppGatewayRuntimeTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.connection_id = UUID("50000000-0000-0000-0000-000000000005")
        self.settings = WhatsAppSettings(
            relay_url="https://center.example",
            connection_id=self.connection_id,
            state_path=Path(self.tempdir.name) / "state.sqlite3",
            heartbeat_seconds=0.05,
            claim_interval_seconds=0.01,
            inbound_interval_seconds=0.01,
        )
        self.credential = WhatsAppCredential(
            app_id="123456789012345",
            app_secret="meta-app-secret-1234567890",
            waba_id="234567890123456",
            phone_number_id="345678901234567",
            access_token="system-user-token-1234567890",
            verify_token="ab" * 32,
        )
        self.router = WhatsAppWebhookRouter()
        self.client = FakeClient()
        self.graph = FakeGraph()
        self.runtime = WhatsAppGatewayRuntime(
            settings=self.settings,
            credential=self.credential,
            client=self.client,
            signer=FakeSigner(),
            router=self.router,
            graph=self.graph,
        )
        await self.runtime.spool.initialize()
        await self.router.register(self.connection_id, self.runtime)
        self.runtime._graph_ready = True

    async def asyncTearDown(self):
        await self.router.unregister(self.connection_id, self.runtime)
        self.tempdir.cleanup()

    def signature(self, body):
        return "sha256=" + hmac.new(
            self.credential.app_secret.encode(), body, hashlib.sha256
        ).hexdigest()

    async def test_verification_signature_durability_and_relay_ingest(self):
        rejected = await self.router.verification(
            self.connection_id,
            mode="subscribe",
            verify_token="wrong",
            challenge="challenge-value",
        )
        self.assertEqual(rejected.status, 403)
        accepted = await self.router.verification(
            self.connection_id,
            mode="subscribe",
            verify_token=self.credential.verify_token,
            challenge="challenge-value",
        )
        self.assertEqual((accepted.status, accepted.body), (200, b"challenge-value"))
        self.assertEqual(
            await self.runtime.spool.get_runtime_state(
                "whatsapp_webhook_verified"
            ),
            "true",
        )

        invalid = await self.router.notification(
            self.connection_id,
            signature="sha256=" + "00" * 32,
            body=b"not-json",
        )
        self.assertEqual(invalid.status, 401)

        body = json.dumps(webhook_payload(), separators=(",", ":")).encode()
        for _ in range(2):
            response = await self.router.notification(
                self.connection_id,
                signature=self.signature(body),
                body=body,
            )
            self.assertEqual(response.status, 200)
        self.assertEqual(await self.runtime.spool.counts(), (1, 0))
        item = await self.runtime.spool.claim()
        await self.runtime._deliver_inbound(item)
        self.assertEqual(len(self.client.ingested), 1)
        provider_event_id, event = self.client.ingested[0]
        self.assertEqual(provider_event_id, "whatsapp:message:wamid.inbound.1")
        self.assertIn(
            ["airhop-provider", "whatsapp_cloud"], event["tags"]
        )
        self.assertNotIn(self.credential.app_secret, repr(event))
        self.assertNotIn(self.credential.access_token, repr(event))

    async def test_payload_is_fenced_to_exact_waba_and_phone(self):
        for payload in (
            webhook_payload(waba_id="999999999999999"),
            webhook_payload(phone_number_id="999999999999999"),
        ):
            body = json.dumps(payload, separators=(",", ":")).encode()
            response = await self.router.notification(
                self.connection_id,
                signature=self.signature(body),
                body=body,
            )
            self.assertEqual(response.status, 403)
        self.assertEqual(await self.runtime.spool.counts(), (0, 0))

    async def test_oversized_message_batch_is_rejected_before_spooling(self):
        payload = webhook_payload()
        messages = payload["entry"][0]["changes"][0]["value"]["messages"]
        messages.extend(dict(messages[0], id=f"wamid.inbound.{index}") for index in range(101))
        body = json.dumps(payload, separators=(",", ":")).encode()
        response = await self.router.notification(
            self.connection_id,
            signature=self.signature(body),
            body=body,
        )
        self.assertEqual(response.status, 400)
        self.assertEqual(await self.runtime.spool.counts(), (0, 0))

    async def test_unsupported_media_becomes_safe_visible_notice(self):
        body = json.dumps(
            webhook_payload(message_type="audio"), separators=(",", ":")
        ).encode()
        response = await self.router.notification(
            self.connection_id,
            signature=self.signature(body),
            body=body,
        )
        self.assertEqual(response.status, 200)
        item = await self.runtime.spool.claim()
        self.assertIn("неподдерживаемое вложение", item.content)
        self.assertNotIn("provider-secret", item.content)

    async def test_outbound_service_window_and_durable_send_receipt(self):
        await self.runtime.spool.put(
            provider_event_id="activity",
            provider_chat_id="5511999990000",
            content="inbound",
            received_at=int(time.time()),
            touch_inbound_at=int(time.time()),
        )
        await self.runtime.spool.delivered("activity")
        job = outbound_job(self.connection_id)
        await self.runtime._deliver_outbound(job)
        await self.runtime._deliver_outbound(job)
        self.assertEqual(len(self.graph.sent), 1)
        self.assertEqual(
            [status for status, _ in self.client.completed],
            ["delivered", "delivered"],
        )

    async def test_outbound_outside_service_window_requires_template(self):
        old = int(time.time()) - 25 * 60 * 60
        await self.runtime.spool.put(
            provider_event_id="old-activity",
            provider_chat_id="5511999990000",
            content="inbound",
            received_at=old,
            touch_inbound_at=old,
        )
        await self.runtime.spool.delivered("old-activity")
        await self.runtime._deliver_outbound(outbound_job(self.connection_id))
        self.assertEqual(self.graph.sent, [])
        status, completion = self.client.completed[0]
        self.assertEqual(status, "failed")
        self.assertEqual(completion["error_code"], "whatsapp_template_required")
        self.assertFalse(completion["retryable"])


class WhatsAppGraphClientTest(unittest.IsolatedAsyncioTestCase):
    async def test_graph_requests_are_bearer_scoped_and_errors_are_safe(self):
        requests = []
        mode = "success"

        def handler(request):
            requests.append(request)
            if request.method == "GET":
                return httpx.Response(200, json={"id": "345678901234567"})
            if mode == "success":
                return httpx.Response(200, json={"messages": [{"id": "wamid.sent"}]})
            return httpx.Response(
                400,
                json={
                    "error": {
                        "message": "provider detail must stay hidden",
                        "code": 131047,
                    }
                },
            )

        credential = WhatsAppCredential(
            app_id="123456789012345",
            app_secret="meta-app-secret-1234567890",
            waba_id="234567890123456",
            phone_number_id="345678901234567",
            access_token="system-user-token-1234567890",
            verify_token="ab" * 32,
        )
        http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        graph = WhatsAppGraphClient(
            credential=credential,
            graph_origin="https://graph.example/v24.0",
            timeout_seconds=5,
            http_client=http,
        )
        self.assertTrue((await graph.healthcheck()).ok)
        sent = await graph.send_text("5511999990000", "Tudo certo")
        self.assertEqual(sent.message_id, "wamid.sent")
        mode = "template"
        rejected = await graph.send_text("5511999990000", "Fora da janela")
        self.assertEqual(rejected.error_code, "whatsapp_template_required")
        self.assertNotIn("provider detail", repr(rejected))
        for request in requests:
            self.assertEqual(
                request.headers["authorization"],
                "Bearer system-user-token-1234567890",
            )
        post_body = json.loads(requests[1].content)
        self.assertEqual(post_body["messaging_product"], "whatsapp")
        self.assertEqual(post_body["to"], "5511999990000")
        self.assertFalse(post_body["text"]["preview_url"])
        await http.aclose()


if __name__ == "__main__":
    unittest.main()
