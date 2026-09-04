"""Telegram vertical slice using Hermes transport and AirHop-owned state."""

from __future__ import annotations

import asyncio
from datetime import datetime
import logging
import time
from typing import Any

from .client import GatewayHttpError
from .config import Settings
from .spool import InboundItem, InboundSpool

logger = logging.getLogger(__name__)


def _enum_value(value: Any) -> str:
    return str(getattr(value, "value", value) or "").strip().lower()


def _provider_event_id(event: Any, chat_id: str) -> str:
    update_id = getattr(event, "platform_update_id", None)
    if update_id is not None:
        return f"telegram:update:{update_id}"
    message_id = str(getattr(event, "message_id", "") or "").strip()
    if message_id:
        return f"telegram:message:{chat_id}:{message_id}"
    raise ValueError("Telegram event has no stable provider identifier")


def _received_at(event: Any) -> int:
    value = getattr(event, "timestamp", None)
    if isinstance(value, datetime):
        try:
            return int(value.timestamp())
        except (OverflowError, OSError, ValueError):
            pass
    return int(time.time())


def _normalized_content(event: Any) -> str | None:
    message_type = _enum_value(getattr(event, "message_type", "text"))
    if message_type not in {"text", "command", "location"}:
        return None
    content = str(getattr(event, "text", "") or "").strip()
    if not content:
        return None
    # Telegram deep-link payloads are bearer material. The binding endpoint
    # consumes them in the dedicated handoff slice; they must never appear in
    # Buzz history or logs. A pre-bound route records only the service command.
    if content.lower().startswith("/start"):
        return "/start"
    return content


class TelegramGatewayRuntime:
    def __init__(
        self,
        *,
        settings: Settings,
        adapter: Any,
        client: Any,
        signer: Any,
        spool: InboundSpool | None = None,
    ):
        self.settings = settings
        self.adapter = adapter
        self.client = client
        self.signer = signer
        self.spool = spool or InboundSpool(settings.state_path)
        self._connected = False

    @property
    def capabilities(self) -> dict[str, Any]:
        return {
            "text": True,
            "polling": not self.settings.webhook_mode,
            "webhook": self.settings.webhook_mode,
            "typing": False,
            "media": [],
            "transport": "hermes-agent-telegram",
        }

    async def handle_message(self, event: Any) -> None:
        normalized = self._normalize_inbound(event)
        if normalized is None:
            return None
        provider_event_id, chat_id, content, received_at = normalized
        inserted = await self.spool.put(
            provider_event_id=provider_event_id,
            provider_chat_id=chat_id,
            content=content,
            received_at=received_at,
        )
        if inserted:
            logger.info("Durably queued Telegram inbound")
        return None

    def handle_message_sync(self, event: Any) -> None:
        """Synchronous SDK seam used before Telegram acknowledges an update."""
        normalized = self._normalize_inbound(event)
        if normalized is None:
            return
        provider_event_id, chat_id, content, received_at = normalized
        inserted = self.spool.put_sync(
            provider_event_id=provider_event_id,
            provider_chat_id=chat_id,
            content=content,
            received_at=received_at,
        )
        if inserted:
            logger.info("Durably queued Telegram inbound")

    @staticmethod
    def _normalize_inbound(event: Any) -> tuple[str, str, str, int] | None:
        source = getattr(event, "source", None)
        chat_id = str(getattr(source, "chat_id", "") or "").strip()
        chat_type = _enum_value(getattr(source, "chat_type", ""))
        thread_id = getattr(source, "thread_id", None)
        if not chat_id or chat_type != "dm" or thread_id not in {None, "", 0}:
            logger.warning("Ignoring non-DM or threaded Telegram inbound")
            return None
        content = _normalized_content(event)
        if content is None:
            logger.info("Ignoring unsupported Telegram content type")
            return None
        try:
            provider_event_id = _provider_event_id(event, chat_id)
        except ValueError:
            logger.error("Telegram inbound cannot be durably identified")
            return None
        return provider_event_id, chat_id, content, _received_at(event)

    async def run(self, stop_event: asyncio.Event) -> None:
        await self.spool.initialize()
        self.adapter.set_message_handler(self.handle_message)
        durable_handler = getattr(self.adapter, "set_durable_message_handler", None)
        if callable(durable_handler):
            durable_handler(self.handle_message_sync)
        await self._safe_heartbeat("connecting", None)
        try:
            self._connected = bool(await self.adapter.connect())
            if not self._connected:
                await self._safe_heartbeat("degraded", "provider_connect_failed")
                raise RuntimeError("Hermes Telegram adapter failed to connect")
            await self._safe_heartbeat("ready", None)
            tasks = [
                asyncio.create_task(self._heartbeat_loop(stop_event)),
                asyncio.create_task(self._inbound_loop(stop_event)),
                asyncio.create_task(self._outbound_loop(stop_event)),
            ]
            try:
                await stop_event.wait()
            finally:
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
        finally:
            self._connected = False
            try:
                await self.adapter.disconnect()
            except Exception:
                logger.exception("Hermes Telegram adapter disconnect failed")
            await self._safe_heartbeat("offline", None)
            await self.client.close()

    async def _heartbeat_loop(self, stop_event: asyncio.Event) -> None:
        while not stop_event.is_set():
            try:
                await asyncio.wait_for(
                    stop_event.wait(), timeout=self.settings.heartbeat_seconds
                )
                continue
            except asyncio.TimeoutError:
                pass
            await self.spool.prune_dead(self.settings.dead_retention_seconds)
            _, dead = await self.spool.counts()
            adapter_connected = bool(getattr(self.adapter, "is_connected", self._connected))
            if dead:
                await self._safe_heartbeat("degraded", "inbound_dead_letter")
            elif not adapter_connected:
                await self._safe_heartbeat("degraded", "provider_disconnected")
            else:
                await self._safe_heartbeat("ready", None)

    async def _safe_heartbeat(self, status: str, error_code: str | None) -> None:
        try:
            await self.client.heartbeat(
                observed_status=status,
                observed_capabilities=self.capabilities,
                error_code=error_code,
            )
        except Exception:
            logger.warning("AirHop heartbeat failed", exc_info=True)

    async def _inbound_loop(self, stop_event: asyncio.Event) -> None:
        while not stop_event.is_set():
            item = await self.spool.claim()
            if item is None:
                await self._wait(stop_event, self.settings.inbound_interval_seconds)
                continue
            await self._deliver_inbound(item)

    async def _deliver_inbound(self, item: InboundItem) -> None:
        age = max(0, int(time.time()) - item.received_at)
        if age > self.settings.inbound_max_age_seconds:
            await self.spool.dead(item.provider_event_id, "inbound_expired")
            return
        if item.event is not None and item.attempts > self.settings.inbound_max_attempts:
            await self.spool.dead(item.provider_event_id, "inbound_attempts_exhausted")
            return
        try:
            event = item.event
            if event is None:
                route = await self.client.resolve_route(item.provider_chat_id)
                event = self.signer.sign_event(
                    kind=9,
                    content=item.content,
                    tags=[
                        ["h", route.channel_id],
                        ["airhop-direction", "inbound"],
                        ["airhop-provider", "telegram"],
                        ["airhop-connection", str(self.settings.connection_id)],
                        ["airhop-conversation", route.conversation_id],
                    ],
                )
                await self.spool.persist_event(item.provider_event_id, event)
            await self.client.ingest(item.provider_event_id, event)
            await self.spool.delivered(item.provider_event_id)
        except GatewayHttpError as exc:
            if exc.status_code == 404 and item.event is None:
                # A handoff may bind the route shortly after /start. Keep the
                # provider update durable and retry without exposing its code.
                await self.spool.retry(
                    item.provider_event_id,
                    "route_unbound",
                    min(300.0, max(5.0, 2 ** min(item.attempts, 8))),
                )
            elif exc.retryable:
                await self.spool.retry(
                    item.provider_event_id,
                    "relay_unavailable",
                    min(300.0, max(1.0, 2 ** min(item.attempts, 8))),
                )
            else:
                await self.spool.dead(item.provider_event_id, "inbound_rejected")
        except Exception:
            logger.exception("Telegram inbound delivery failed")
            await self.spool.retry(
                item.provider_event_id,
                "inbound_internal_error",
                min(300.0, max(1.0, 2 ** min(item.attempts, 8))),
            )

    async def _outbound_loop(self, stop_event: asyncio.Event) -> None:
        while not stop_event.is_set():
            try:
                jobs = await self.client.claim(
                    limit=self.settings.claim_limit,
                    lease_seconds=self.settings.lease_seconds,
                )
            except Exception:
                logger.warning("AirHop outbound claim failed", exc_info=True)
                await self._wait(stop_event, self.settings.claim_interval_seconds)
                continue
            if not jobs:
                await self._wait(stop_event, self.settings.claim_interval_seconds)
                continue
            for job in jobs:
                if stop_event.is_set():
                    return
                await self._deliver_outbound(job)

    async def _deliver_outbound(self, job: dict[str, Any]) -> None:
        outbox_id = str(job.get("outboxId", ""))
        lease_token = str(job.get("leaseToken", ""))
        try:
            if str(job.get("connectionId")) != str(self.settings.connection_id):
                raise ValueError("outbound connection mismatch")
            if job.get("provider") != "telegram":
                raise ValueError("outbound provider mismatch")
            event = job.get("event")
            if not isinstance(event, dict):
                raise ValueError("outbound event is missing")
            content = event.get("content")
            if not isinstance(content, str) or not content.strip():
                raise ValueError("outbound content is empty")
            result = await self.adapter.send(
                str(job["providerChatId"]),
                content,
                metadata={"notify": True, "airhop_idempotency_key": job.get("idempotencyKey")},
            )
            if bool(getattr(result, "success", False)):
                await self.client.complete_delivered(
                    outbox_id=outbox_id,
                    lease_token=lease_token,
                    provider_message_id=(
                        str(getattr(result, "message_id"))
                        if getattr(result, "message_id", None) is not None
                        else None
                    ),
                )
                return
            error_kind = str(getattr(result, "error_kind", "") or "unknown").lower()
            retryable = bool(getattr(result, "retryable", False)) or error_kind in {
                "rate_limited",
                "transient",
                "unknown",
            }
            retry_after = getattr(result, "retry_after", None)
            retry_after_seconds = int(retry_after) if retry_after is not None else 30
            await self.client.complete_failed(
                outbox_id=outbox_id,
                lease_token=lease_token,
                error_code=f"telegram_{error_kind}" if error_kind else "telegram_unknown",
                retry_after_seconds=max(5, min(3600, retry_after_seconds)) if retryable else 0,
                retryable=retryable,
            )
        except (KeyError, TypeError, ValueError):
            logger.exception("Rejecting invalid AirHop outbound job")
            if outbox_id and lease_token:
                await self.client.complete_failed(
                    outbox_id=outbox_id,
                    lease_token=lease_token,
                    error_code="invalid_outbound_job",
                    retry_after_seconds=0,
                    retryable=False,
                )
        except Exception:
            # Do not acknowledge an ambiguous provider/API failure. The durable
            # server lease expires and counts as the bounded attempt.
            logger.exception("Telegram outbound delivery crashed before completion")

    @staticmethod
    async def _wait(stop_event: asyncio.Event, seconds: float) -> None:
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=seconds)
        except asyncio.TimeoutError:
            pass
