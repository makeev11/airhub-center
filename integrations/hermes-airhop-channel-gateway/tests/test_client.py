from __future__ import annotations

import base64
import hashlib
import json
import unittest
from uuid import UUID

import httpx

from airhop_hermes_gateway.client import AirHopGatewayClient
from airhop_hermes_gateway.nostr import NostrSigner


class AirHopGatewayClientTest(unittest.IsolatedAsyncioTestCase):
    async def test_supervisor_fetches_assignments_and_write_only_credentials(self):
        requests = []
        connection_id = UUID("50000000-0000-0000-0000-000000000005")

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            if request.url.path.endswith("/assignments"):
                return httpx.Response(
                    200,
                    json={
                        "schemaVersion": "airhop.channel-gateway.assignments.v1",
                        "assignments": [
                            {
                                "connectionId": str(connection_id),
                                "provider": "telegram",
                                "status": "active",
                            }
                        ],
                    },
                )
            return httpx.Response(
                200,
                headers={"cache-control": "no-store"},
                json={
                    "schemaVersion": "airhop.channel-gateway.credential.v1",
                    "connectionId": str(connection_id),
                    "provider": "telegram",
                    "token": "telegram-secret",
                },
            )

        http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        client = AirHopGatewayClient(
            relay_url="https://center.example",
            connection_id=None,
            signer=NostrSigner("01" * 32),
            timeout_seconds=5,
            http_client=http,
        )
        assignments = await client.list_assignments()
        self.assertEqual(assignments[0].connection_id, connection_id)
        self.assertEqual(await client.get_credential(connection_id), "telegram-secret")

        for request in requests:
            self.assertEqual(request.method, "GET")
            event = json.loads(
                base64.b64decode(
                    request.headers["authorization"].removeprefix("Nostr ")
                )
            )
            self.assertIn(["method", "GET"], event["tags"])
            self.assertFalse(any(tag[0] == "payload" for tag in event["tags"]))
            self.assertNotIn("telegram-secret", request.url.path)
        await http.aclose()

    async def test_runtime_requests_are_nip98_bound_and_connection_scoped(self):
        requests = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            auth = request.headers["authorization"]
            event = json.loads(base64.b64decode(auth.removeprefix("Nostr ")))
            body = request.content
            self.assertIn(["method", "POST"], event["tags"])
            self.assertIn(["u", str(request.url)], event["tags"])
            self.assertIn(["payload", hashlib.sha256(body).hexdigest()], event["tags"])
            if request.url.path.endswith("/routes/resolve"):
                return httpx.Response(
                    200,
                    json={
                        "conversationId": "10000000-0000-0000-0000-000000000001",
                        "channelId": "20000000-0000-0000-0000-000000000002",
                        "routeStatus": "active",
                        "connectionStatus": "active",
                    },
                )
            if request.url.path.endswith("/outbound/claim"):
                return httpx.Response(200, json={"jobs": []})
            return httpx.Response(200, json={"state": "failed"})

        transport = httpx.MockTransport(handler)
        http = httpx.AsyncClient(transport=transport)
        connection_id = UUID("50000000-0000-0000-0000-000000000005")
        client = AirHopGatewayClient(
            relay_url="https://center.example",
            connection_id=connection_id,
            signer=NostrSigner("01" * 32),
            timeout_seconds=5,
            http_client=http,
        )
        route = await client.resolve_route("42")
        self.assertEqual(route.channel_id, "20000000-0000-0000-0000-000000000002")
        await client.claim(limit=25, lease_seconds=90)
        await client.complete_failed(
            outbox_id="30000000-0000-0000-0000-000000000003",
            lease_token="40000000-0000-0000-0000-000000000004",
            error_code="telegram_forbidden",
            retry_after_seconds=0,
            retryable=False,
        )

        claim_body = json.loads(requests[1].content)
        self.assertEqual(claim_body["connectionId"], str(connection_id))
        failure_body = json.loads(requests[2].content)
        self.assertFalse(failure_body["retryable"])
        self.assertEqual(failure_body["retryAfterSeconds"], 0)
        nonces = []
        for request in requests:
            event = json.loads(
                base64.b64decode(request.headers["authorization"].removeprefix("Nostr "))
            )
            nonces.append(next(tag[1] for tag in event["tags"] if tag[0] == "nonce"))
        self.assertEqual(len(nonces), len(set(nonces)))
        await http.aclose()


if __name__ == "__main__":
    unittest.main()
