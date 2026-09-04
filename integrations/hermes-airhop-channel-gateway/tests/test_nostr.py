from __future__ import annotations

import base64
import hashlib
import json
import unittest

from coincurve import PublicKeyXOnly

from airhop_hermes_gateway.nostr import NostrSigner, canonical_json


class NostrSignerTest(unittest.TestCase):
    def setUp(self):
        self.signer = NostrSigner("01" * 32)

    def test_kind_9_event_has_canonical_id_and_valid_bip340_signature(self):
        event = self.signer.sign_event(
            kind=9,
            content="Привет",
            tags=[["h", "20000000-0000-0000-0000-000000000002"]],
            created_at=1_800_000_000,
        )
        expected_id = hashlib.sha256(
            canonical_json(
                [
                    0,
                    event["pubkey"],
                    event["created_at"],
                    event["kind"],
                    event["tags"],
                    event["content"],
                ]
            )
        ).hexdigest()
        self.assertEqual(event["id"], expected_id)
        key = PublicKeyXOnly(bytes.fromhex(event["pubkey"]))
        self.assertTrue(
            key.verify(bytes.fromhex(event["sig"]), bytes.fromhex(event["id"]))
        )

    def test_nip98_header_binds_method_url_body_and_nonce(self):
        body = b'{"connectionId":"id"}'
        header = self.signer.nip98_header(
            "POST", "https://center.example/api/test", body
        )
        self.assertTrue(header.startswith("Nostr "))
        event = json.loads(base64.b64decode(header.removeprefix("Nostr ")))
        self.assertEqual(event["kind"], 27235)
        self.assertIn(["u", "https://center.example/api/test"], event["tags"])
        self.assertIn(["method", "POST"], event["tags"])
        self.assertIn(["payload", hashlib.sha256(body).hexdigest()], event["tags"])
        self.assertEqual(len([tag for tag in event["tags"] if tag[0] == "nonce"]), 1)
        key = PublicKeyXOnly(bytes.fromhex(event["pubkey"]))
        self.assertTrue(
            key.verify(bytes.fromhex(event["sig"]), bytes.fromhex(event["id"]))
        )


if __name__ == "__main__":
    unittest.main()
