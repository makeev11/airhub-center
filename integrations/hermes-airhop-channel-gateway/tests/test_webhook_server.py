from __future__ import annotations

import unittest
from uuid import UUID

import httpx

from airhop_hermes_gateway.webhook_server import WhatsAppWebhookServer
from airhop_hermes_gateway.whatsapp import WebhookResponse


class FakeRouter:
    def __init__(self):
        self.verifications = []
        self.notifications = []

    async def verification(self, connection_id, **values):
        self.verifications.append((connection_id, values))
        return WebhookResponse(200, values["challenge"].encode())

    async def notification(self, connection_id, **values):
        self.notifications.append((connection_id, values))
        return WebhookResponse(200, b"ok")


class WhatsAppWebhookServerTest(unittest.IsolatedAsyncioTestCase):
    async def test_connection_scoped_get_and_post_are_bounded(self):
        router = FakeRouter()
        connection_id = UUID("50000000-0000-0000-0000-000000000005")
        server = WhatsAppWebhookServer(
            router=router,
            host="127.0.0.1",
            port=0,
            max_body_bytes=64,
            request_timeout_seconds=2,
        )
        await server.start()
        try:
            base = f"http://127.0.0.1:{server.bound_port}"
            async with httpx.AsyncClient(trust_env=False) as client:
                health = await client.get(f"{base}/healthz")
                self.assertEqual(health.status_code, 200)
                verified = await client.get(
                    f"{base}/webhooks/whatsapp/{connection_id}",
                    params={
                        "hub.mode": "subscribe",
                        "hub.verify_token": "secret-token",
                        "hub.challenge": "challenge-value",
                    },
                )
                self.assertEqual(verified.text, "challenge-value")
                self.assertEqual(verified.headers["cache-control"], "no-store")
                delivered = await client.post(
                    f"{base}/webhooks/whatsapp/{connection_id}",
                    content=b'{"object":"whatsapp_business_account"}',
                    headers={
                        "content-type": "application/json",
                        "x-hub-signature-256": "sha256=" + "ab" * 32,
                    },
                )
                self.assertEqual(delivered.status_code, 200)
                wrong_type = await client.post(
                    f"{base}/webhooks/whatsapp/{connection_id}",
                    content=b"{}",
                    headers={"content-type": "text/plain"},
                )
                self.assertEqual(wrong_type.status_code, 415)
                oversized = await client.post(
                    f"{base}/webhooks/whatsapp/{connection_id}",
                    content=b"x" * 65,
                    headers={"content-type": "application/json"},
                )
                self.assertEqual(oversized.status_code, 413)
                missing = await client.post(
                    f"{base}/webhooks/whatsapp/not-a-uuid",
                    content=b"{}",
                    headers={"content-type": "application/json"},
                )
                self.assertEqual(missing.status_code, 404)
        finally:
            await server.close()
        self.assertEqual(len(router.verifications), 1)
        self.assertEqual(router.verifications[0][0], connection_id)
        self.assertEqual(len(router.notifications), 1)
        self.assertEqual(
            router.notifications[0][1]["signature"], "sha256=" + "ab" * 32
        )


if __name__ == "__main__":
    unittest.main()
