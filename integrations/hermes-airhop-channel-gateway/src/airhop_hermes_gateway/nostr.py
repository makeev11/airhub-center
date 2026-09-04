"""Minimal Nostr signing needed by the AirHop gateway boundary."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import time
from typing import Any
from uuid import uuid4

from coincurve import PrivateKey


def canonical_json(value: Any) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, separators=(",", ":"), sort_keys=False
    ).encode("utf-8")


class NostrSigner:
    """BIP-340 signer for canonical Buzz events and NIP-98 requests."""

    def __init__(self, secret_key_hex: str):
        self._key = PrivateKey(bytes.fromhex(secret_key_hex))
        compressed = self._key.public_key.format(compressed=True)
        self.public_key_hex = compressed[1:].hex()

    def sign_event(
        self,
        *,
        kind: int,
        content: str,
        tags: list[list[str]],
        created_at: int | None = None,
    ) -> dict[str, Any]:
        timestamp = int(time.time()) if created_at is None else int(created_at)
        event_id = hashlib.sha256(
            canonical_json([0, self.public_key_hex, timestamp, kind, tags, content])
        ).digest()
        signature = self._key.sign_schnorr(event_id, aux_randomness=os.urandom(32))
        return {
            "id": event_id.hex(),
            "pubkey": self.public_key_hex,
            "created_at": timestamp,
            "kind": kind,
            "tags": tags,
            "content": content,
            "sig": signature.hex(),
        }

    def nip98_header(self, method: str, url: str, body: bytes | None) -> str:
        tags = [["u", url], ["method", method.upper()], ["nonce", str(uuid4())]]
        if body is not None:
            tags.append(["payload", hashlib.sha256(body).hexdigest()])
        event = self.sign_event(kind=27235, content="", tags=tags)
        encoded = base64.b64encode(canonical_json(event)).decode("ascii")
        return f"Nostr {encoded}"

