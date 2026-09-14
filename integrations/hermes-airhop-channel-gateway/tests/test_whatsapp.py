from __future__ import annotations

import hashlib
import hmac
import json
from dataclasses import replace
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

    async def resolve_route(self, provider_chat_id, handoff_token_digest=None):
        self.handoff_token_digest = handoff_token_digest
        self.provider_chat_id = provider_chat_id
        return RouteResolution(
            conversation_id="10000000-0000-0000-0000-000000000001",
            channel_id="20000000-0000-0000-0000-000000000002",
            route_status="active",
            connection_status="active",
            handoff_status="connected" if handoff_token_digest else None,
        )

    async def ingest(self, provider_event_id, event):
        self.ingested.append((provider_event_id, event))
        return {"accepted": True}

    async def heartbeat(self, **values):
        self.heartbeats.append(values)
        return {}

    async def claim(self, **_values):
        return []

    async def whatsapp_status(self, receipt):
        self.completed.append(("receipt", receipt))
        return True

    async def complete_accepted(self, **values):
        self.completed.append(("accepted", values))
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

    async def list_templates(self):
        return getattr(self, "templates", [])

    async def send_template(self, recipient, template, parameters):
        self.sent.append((recipient, template, parameters))
        return self.send_result

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
                                "phone_number_id": phone_number_id or "345678901234567"
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
        return (
            "sha256="
            + hmac.new(
                self.credential.app_secret.encode(), body, hashlib.sha256
            ).hexdigest()
        )

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
            await self.runtime.spool.get_runtime_state("whatsapp_webhook_verified"),
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
        self.assertIn(["airhop-provider", "whatsapp_cloud"], event["tags"])
        self.assertNotIn(self.credential.app_secret, repr(event))
        self.assertNotIn(self.credential.access_token, repr(event))

    async def test_credential_rotation_requires_fresh_webhook_verification(self):
        await self.runtime.spool.set_runtime_state("whatsapp_webhook_verified", "true")
        await self.runtime._load_webhook_verification_state()
        self.assertTrue(self.runtime._webhook_verified)
        self.assertEqual(
            await self.runtime.spool.get_runtime_state("whatsapp_credential_version"),
            "1",
        )

        self.runtime.settings = replace(self.settings, credential_version=2)
        await self.runtime._load_webhook_verification_state()
        self.assertFalse(self.runtime._webhook_verified)
        self.assertEqual(
            await self.runtime.spool.get_runtime_state("whatsapp_webhook_verified"),
            "false",
        )

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
        messages.extend(
            dict(messages[0], id=f"wamid.inbound.{index}") for index in range(101)
        )
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
            ["accepted", "accepted"],
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


class WhatsAppReceiptAndTemplateTest(WhatsAppGatewayRuntimeTest):
    async def push(self, payload):
        body = json.dumps(payload, separators=(",", ":")).encode()
        return await self.runtime.accept_webhook(
            signature=self.signature(body), body=body
        )

    async def test_status_survives_restart_and_does_not_open_service_window(self):
        payload = webhook_payload()
        value = payload["entry"][0]["changes"][0]["value"]
        value.pop("messages")
        value["statuses"] = [
            {
                "id": "wamid.sent",
                "status": "failed",
                "recipient_id": "5511999990000",
                "timestamp": str(int(time.time())),
                "errors": [{"code": 131026, "message": "private error"}],
            }
        ]
        self.assertEqual((await self.push(payload)).status, 200)
        self.assertEqual((await self.push(payload)).status, 200)
        self.assertIsNone(await self.runtime.spool.last_inbound_at("5511999990000"))
        from airhop_hermes_gateway.whatsapp_status import WhatsAppStatusSpool

        self.runtime.status_spool = WhatsAppStatusSpool(self.runtime.status_spool.path)
        self.assertEqual(len(await self.runtime.status_spool.due_statuses()), 1)
        await self.runtime._flush_statuses()
        self.assertEqual(self.client.completed[0][1]["errorCode"], "whatsapp_131026")
        self.assertNotIn("private", json.dumps(self.client.completed))
        self.assertEqual(await self.runtime.status_spool.due_statuses(), [])

    async def test_early_receipt_waits_for_acceptance(self):
        receipt = {
            "providerMessageId": "wamid.early",
            "recipient": "5511999990000",
            "status": "read",
            "timestamp": int(time.time()),
            "errorCode": None,
        }
        await self.runtime.status_spool.put_statuses([receipt])

        async def not_yet(_):
            return False

        self.client.whatsapp_status = not_yet
        await self.runtime._flush_statuses()
        with self.runtime.status_spool._connect() as db:
            self.assertEqual(
                db.execute("SELECT done FROM whatsapp_statuses").fetchone()[0], 0
            )
            db.execute("UPDATE whatsapp_statuses SET next_attempt_at=0")
        self.assertEqual(len(await self.runtime.status_spool.due_statuses()), 1)

    async def test_booking_token_is_hashed_and_redacted_before_ack(self):
        payload = webhook_payload()
        token = "ahh_" + "a" * 43
        payload["entry"][0]["changes"][0]["value"]["messages"][0]["text"]["body"] = (
            token
        )
        self.assertEqual((await self.push(payload)).status, 200)
        item = await self.runtime.spool.claim()
        self.assertEqual(
            item.handoff_token_digest, hashlib.sha256(token.encode()).hexdigest()
        )
        self.assertNotIn(token, item.content)
        await self.runtime._deliver_inbound(item)
        self.assertEqual(self.client.handoff_token_digest, item.handoff_token_digest)
        self.assertIn("Чат подтверждён", self.client.ingested[0][1]["content"])
        self.assertNotIn(token, json.dumps(self.client.ingested))

    async def test_template_outside_window_preserves_exact_reviewed_content(self):
        template = {
            "name": "lesson_update",
            "language": "pt_BR",
            "body": "Sua aula: {{1}}",
            "header": "AirHop",
            "footer": "Obrigado",
            "parameterCount": 1,
        }
        self.graph.templates = [template]
        job = outbound_job(self.connection_id)
        job["actorKind"] = "staff"
        job["event"]["content"] = "AirHop\nSua aula: 10:00\nObrigado"
        job["event"]["tags"] = [
            [
                "airhop-whatsapp-template",
                json.dumps(
                    {
                        "name": "lesson_update",
                        "language": "pt_BR",
                        "parameters": ["10:00"],
                    }
                ),
            ]
        ]
        await self.runtime._deliver_outbound(job)
        self.assertEqual(self.graph.sent[0][2], ["10:00"])
        self.assertEqual(self.client.completed[0][0], "accepted")
        self.assertIsNone(await self.runtime.spool.last_inbound_at("5511999990000"))

    async def test_changed_or_revoked_template_is_not_sent(self):
        job = outbound_job(self.connection_id)
        job["actorKind"] = "staff"
        job["event"]["tags"] = [
            [
                "airhop-whatsapp-template",
                json.dumps({"name": "revoked", "language": "pt_BR", "parameters": []}),
            ]
        ]
        await self.runtime._deliver_outbound(job)
        self.assertEqual(self.graph.sent, [])
        self.assertEqual(
            self.client.completed[0][1]["error_code"], "whatsapp_template_changed"
        )

    async def test_uncertain_provider_response_is_never_automatically_resent(self):
        await self.runtime.spool.put(
            provider_event_id="activity",
            provider_chat_id="5511999990000",
            content="oi",
            received_at=int(time.time()),
            touch_inbound_at=int(time.time()),
        )
        calls = []

        async def timeout(*args):
            calls.append(args)
            raise httpx.ReadTimeout("response lost")

        self.graph.send_text = timeout
        job = outbound_job(self.connection_id)
        await self.runtime._deliver_outbound(job)
        await self.runtime._deliver_outbound(job)
        self.assertEqual(len(calls), 1)
        self.assertTrue(
            all(
                values["error_code"] == "whatsapp_send_uncertain"
                and not values["retryable"]
                for _, values in self.client.completed
            )
        )

    async def test_graph_template_catalog_and_send_never_follow_foreign_paging_urls(
        self,
    ):
        requests = []

        def handler(request):
            requests.append(request)
            if request.method == "POST":
                return httpx.Response(
                    200, json={"messages": [{"id": "wamid.template"}]}
                )
            if "after" in request.url.params:
                return httpx.Response(200, json={"data": []})
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "name": "lesson",
                            "language": "pt_BR",
                            "status": "APPROVED",
                            "category": "UTILITY",
                            "components": [{"type": "BODY", "text": "Aula {{1}}"}],
                        }
                    ],
                    "paging": {
                        "next": "https://foreign.invalid/private",
                        "cursors": {"after": "cursor"},
                    },
                },
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            graph = WhatsAppGraphClient(
                credential=self.credential,
                graph_origin="https://graph.example/v25.0",
                timeout_seconds=5,
                http_client=http,
            )
            catalog = await graph.list_templates()
            result = await graph.send_template("5511999990000", catalog[0], ["10:00"])
        self.assertTrue(result.success)
        self.assertEqual(len(requests), 3)
        self.assertTrue(all(r.url.host == "graph.example" for r in requests))
        payload = json.loads(requests[-1].content)
        self.assertEqual(payload["type"], "template")
        self.assertEqual(
            payload["template"],
            {
                "name": "lesson",
                "language": {"code": "pt_BR"},
                "components": [
                    {"type": "body", "parameters": [{"type": "text", "text": "10:00"}]}
                ],
            },
        )


class WhatsAppTemplateValidationTest(unittest.TestCase):
    def test_only_approved_utility_text_with_contiguous_parameters(self):
        from airhop_hermes_gateway.whatsapp_templates import (
            normalize_template,
            render_template,
        )

        value = {
            "name": "lesson",
            "language": "pt_BR",
            "category": "UTILITY",
            "status": "APPROVED",
            "components": [{"type": "BODY", "text": "Aula {{1}}, {{2}}"}],
        }
        template = normalize_template(value)
        self.assertEqual(render_template(template, ["Ana", "10:00"]), "Aula Ana, 10:00")
        for field, replacement in [
            ("status", "PAUSED"),
            ("category", "MARKETING"),
            ("language", "bad/locale"),
        ]:
            self.assertIsNone(normalize_template({**value, field: replacement}))
        for text in ["{{2}}", "{{name}}", "{{1}} {broken}", "{{11}}"]:
            self.assertIsNone(
                normalize_template(
                    {**value, "components": [{"type": "BODY", "text": text}]}
                )
            )
        with self.assertRaises(ValueError):
            render_template(template, ["{{2}}", "secret"])
        self.assertIsNone(
            normalize_template(
                {
                    **value,
                    "components": value["components"]
                    + [{"type": "BUTTONS", "buttons": []}],
                }
            )
        )
