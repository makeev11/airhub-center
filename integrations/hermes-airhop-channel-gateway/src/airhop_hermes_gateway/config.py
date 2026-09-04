"""Environment-only runtime configuration for the Telegram adapter deployment."""

from __future__ import annotations

from dataclasses import dataclass, field
import os
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID


def _required(env: dict[str, str], name: str) -> str:
    value = env.get(name, "").strip()
    if not value:
        raise ValueError(f"{name} is required")
    return value


def _bounded_int(
    env: dict[str, str], name: str, default: int, minimum: int, maximum: int
) -> int:
    raw = env.get(name, "").strip()
    value = default if not raw else int(raw, 10)
    if not minimum <= value <= maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


def _bounded_float(
    env: dict[str, str], name: str, default: float, minimum: float, maximum: float
) -> float:
    raw = env.get(name, "").strip()
    value = default if not raw else float(raw)
    if not minimum <= value <= maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


@dataclass(frozen=True)
class Settings:
    """Validated adapter settings.

    Provider credentials and the connector signing key are accepted only from
    the deployment environment. They are never sent to AirHop control-plane
    endpoints or serialized into logs/state.
    """

    relay_url: str
    connection_id: UUID
    connector_secret_key: str = field(repr=False)
    telegram_bot_token: str = field(repr=False)
    state_path: Path = Path("/var/lib/airhop-channel-gateway/state.sqlite3")
    heartbeat_seconds: float = 30.0
    claim_interval_seconds: float = 1.0
    inbound_interval_seconds: float = 0.2
    http_timeout_seconds: float = 15.0
    claim_limit: int = 25
    lease_seconds: int = 90
    inbound_max_attempts: int = 100
    inbound_max_age_seconds: int = 7 * 24 * 60 * 60
    dead_retention_seconds: int = 7 * 24 * 60 * 60
    webhook_mode: bool = False

    @classmethod
    def from_env(
        cls,
        source: dict[str, str] | None = None,
        *,
        connection_id: UUID | None = None,
        telegram_bot_token: str | None = None,
        state_path: Path | None = None,
    ) -> "Settings":
        env = dict(os.environ if source is None else source)
        relay_url = _required(env, "AIRHOP_RELAY_URL").rstrip("/")
        parsed = urlsplit(relay_url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("AIRHOP_RELAY_URL must be an absolute HTTP(S) URL")
        if parsed.query or parsed.fragment:
            raise ValueError("AIRHOP_RELAY_URL must not contain a query or fragment")

        resolved_connection_id = connection_id or UUID(
            _required(env, "AIRHOP_CONNECTION_ID")
        )
        if resolved_connection_id.int == 0:
            raise ValueError("AIRHOP_CONNECTION_ID must not be nil")

        secret_key = _required(env, "AIRHOP_CONNECTOR_SECRET_KEY").lower()
        if len(secret_key) != 64:
            raise ValueError("AIRHOP_CONNECTOR_SECRET_KEY must be 32-byte hex")
        try:
            secret_bytes = bytes.fromhex(secret_key)
        except ValueError as exc:
            raise ValueError("AIRHOP_CONNECTOR_SECRET_KEY must be 32-byte hex") from exc
        if not any(secret_bytes):
            raise ValueError("AIRHOP_CONNECTOR_SECRET_KEY must not be zero")

        resolved_state_path = state_path or Path(
            env.get(
                "AIRHOP_GATEWAY_STATE_PATH",
                "/var/lib/airhop-channel-gateway/state.sqlite3",
            )
        )
        if not resolved_state_path.is_absolute():
            raise ValueError("AIRHOP_GATEWAY_STATE_PATH must be absolute")

        if env.get("TELEGRAM_WEBHOOK_URL", "").strip() and not env.get(
            "TELEGRAM_WEBHOOK_SECRET", ""
        ).strip():
            raise ValueError(
                "TELEGRAM_WEBHOOK_SECRET is required when TELEGRAM_WEBHOOK_URL is set"
            )

        resolved_token = (
            telegram_bot_token.strip()
            if telegram_bot_token is not None
            else _required(env, "TELEGRAM_BOT_TOKEN")
        )
        if not resolved_token:
            raise ValueError("TELEGRAM_BOT_TOKEN is required")

        return cls(
            relay_url=relay_url,
            connection_id=resolved_connection_id,
            connector_secret_key=secret_key,
            telegram_bot_token=resolved_token,
            state_path=resolved_state_path,
            heartbeat_seconds=_bounded_float(
                env, "AIRHOP_HEARTBEAT_SECONDS", 30.0, 5.0, 300.0
            ),
            claim_interval_seconds=_bounded_float(
                env, "AIRHOP_CLAIM_INTERVAL_SECONDS", 1.0, 0.1, 30.0
            ),
            inbound_interval_seconds=_bounded_float(
                env, "AIRHOP_INBOUND_INTERVAL_SECONDS", 0.2, 0.05, 30.0
            ),
            http_timeout_seconds=_bounded_float(
                env, "AIRHOP_HTTP_TIMEOUT_SECONDS", 15.0, 1.0, 120.0
            ),
            claim_limit=_bounded_int(env, "AIRHOP_CLAIM_LIMIT", 25, 1, 50),
            lease_seconds=_bounded_int(env, "AIRHOP_LEASE_SECONDS", 90, 30, 300),
            inbound_max_attempts=_bounded_int(
                env, "AIRHOP_INBOUND_MAX_ATTEMPTS", 100, 1, 10_000
            ),
            inbound_max_age_seconds=_bounded_int(
                env,
                "AIRHOP_INBOUND_MAX_AGE_SECONDS",
                7 * 24 * 60 * 60,
                300,
                30 * 24 * 60 * 60,
            ),
            dead_retention_seconds=_bounded_int(
                env,
                "AIRHOP_DEAD_RETENTION_SECONDS",
                7 * 24 * 60 * 60,
                300,
                30 * 24 * 60 * 60,
            ),
            webhook_mode=bool(env.get("TELEGRAM_WEBHOOK_URL", "").strip()),
        )
