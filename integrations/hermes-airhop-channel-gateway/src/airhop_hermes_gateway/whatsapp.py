"""Official WhatsApp Cloud API runtime on the AirHop gateway contract."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
import hashlib
import hmac
import json
import logging
import re
import time
from typing import Any
from uuid import UUID

import httpx

from .client import GatewayHttpError, WhatsAppCredential
from .config import WhatsAppSettings
from .spool import InboundItem, InboundSpool

logger = logging.getLogger(__name__)

_SERVICE_WINDOW_SECONDS = 24 * 60 * 60
_MAX_MESSAGES_PER_WEBHOOK = 100
_WEBHOOK_VERIFIED_KEY = "whatsapp_webhook_verified"
_UNSUPPORTED_NOTICE = (
    "[WhatsApp: получено неподдерживаемое вложение. "
    "Содержимое и оригинал файла недоступны в AirHop Center.]"
)


@dataclass(frozen=True)
class WebhookResponse:
    status: int
    body: bytes
    content_type: str = "text/plain; charset=utf-8"


@dataclass(frozen=True)
class GraphHealth:
    ok: bool
    error_code: str | None = None


@dataclass(frozen=True)
class WhatsAppSendResult:
    success: bool
    message_id: str | None = None
    error_code: str = "whatsapp_unknown"
    retryable: bool = False
    retry_after_seconds: int = 0


class WhatsAppGraphClient:
    """Small, bounded Cloud API client that never exposes provider errors."""

    def __init__(
        self,
        *,
        credential: WhatsAppCredential,
        graph_origin: str,
        timeout_seconds: float,
        http_client: httpx.AsyncClient | None = None,
    ):
        self.credential = credential
        self.graph_origin = graph_origin.rstrip("/")
        self._owns_http = http_client is None
        self._http = http_client or httpx.AsyncClient(
            timeout=httpx.Timeout(timeout_seconds), follow_redirects=False
        )

    async def close(self) -> None:
        if self._owns_http:
            await self._http.aclose()

    @property
    def _headers(self) -> dict[str, str]:
        return {
            "authorization": f"Bearer {self.credential.access_token}",
            "accept": "application/json",
        }

    async def healthcheck(self) -> GraphHealth:
        url = f"{self.graph_origin}/{self.credential.phone_number_id}"
        try:
            response = await self._http.get(
                url,
                params={"fields": "id"},
                headers=self._headers,
            )
        except (httpx.TimeoutException, httpx.TransportError):
            return GraphHealth(False, "whatsapp_graph_unavailable")
        if not response.is_success:
            result = self._failure(response)
            return GraphHealth(False, result.error_code)
        try:
            value = response.json()
        except (UnicodeDecodeError, json.JSONDecodeError):
            return GraphHealth(False, "whatsapp_graph_invalid_response")
        if not isinstance(value, dict) or str(value.get("id")) != self.credential.phone_number_id:
            return GraphHealth(False, "whatsapp_graph_identity_mismatch")
        return GraphHealth(True)

    async def send_text(self, recipient: str, content: str) -> WhatsAppSendResult:
        url = f"{self.graph_origin}/{self.credential.phone_number_id}/messages"
        headers = {**self._headers, "content-type": "application/json"}
        response = await self._http.post(
            url,
            headers=headers,
            json={
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": recipient,
                "type": "text",
                "text": {"preview_url": False, "body": content},
            },
        )
        if not response.is_success:
            return self._failure(response)
        try:
            value = response.json()
        except (UnicodeDecodeError, json.JSONDecodeError):
            return WhatsAppSendResult(
                False,
                error_code="whatsapp_graph_invalid_response",
                retryable=True,
                retry_after_seconds=30,
            )
        messages = value.get("messages") if isinstance(value, dict) else None
        message = messages[0] if isinstance(messages, list) and messages else None
        message_id = message.get("id") if isinstance(message, dict) else None
        if not isinstance(message_id, str) or not 1 <= len(message_id) <= 200:
            return WhatsAppSendResult(
                False,
                error_code="whatsapp_graph_invalid_response",
                retryable=True,
                retry_after_seconds=30,
            )
        return WhatsAppSendResult(True, message_id=message_id)

    @staticmethod
    def _failure(response: httpx.Response) -> WhatsAppSendResult:
        status = response.status_code
        provider_code: int | None = None
        transient = False
        try:
            value = response.json()
            error = value.get("error") if isinstance(value, dict) else None
            if isinstance(error, dict):
                raw_code = error.get("code")
                provider_code = raw_code if isinstance(raw_code, int) else None
                transient = error.get("is_transient") is True
        except (UnicodeDecodeError, json.JSONDecodeError):
            pass
        retry_after = response.headers.get("retry-after", "").strip()
        retry_after_seconds = (
            int(retry_after)
            if retry_after.isdigit() and 1 <= int(retry_after) <= 3600
            else 30
        )
        if status == 429 or provider_code in {4, 17, 32, 613, 131048, 131056}:
            return WhatsAppSendResult(
                False,
                error_code="whatsapp_rate_limited",
                retryable=True,
                retry_after_seconds=retry_after_seconds,
            )
        if status >= 500 or transient:
            return WhatsAppSendResult(
                False,
                error_code="whatsapp_transient",
                retryable=True,
                retry_after_seconds=retry_after_seconds,
            )
        if provider_code == 131047:
            return WhatsAppSendResult(False, error_code="whatsapp_template_required")
        if provider_code == 131026:
            return WhatsAppSendResult(False, error_code="whatsapp_undeliverable")
        if status in {401, 403}:
            return WhatsAppSendResult(False, error_code="whatsapp_auth_rejected")
        return WhatsAppSendResult(False, error_code="whatsapp_rejected")


class WhatsAppWebhookRouter:
    """Connection-scoped registry used by the one public webhook server."""

    def __init__(self):
        self._runtimes: dict[UUID, WhatsAppGatewayRuntime] = {}
        self._lock = asyncio.Lock()

    async def register(
        self, connection_id: UUID, runtime: "WhatsAppGatewayRuntime"
    ) -> None:
        async with self._lock:
            current = self._runtimes.get(connection_id)
            if current is not None and current is not runtime:
                raise RuntimeError("WhatsApp connection is already registered")
            self._runtimes[connection_id] = runtime

    async def unregister(
        self, connection_id: UUID, runtime: "WhatsAppGatewayRuntime"
    ) -> None:
        async with self._lock:
            if self._runtimes.get(connection_id) is runtime:
                self._runtimes.pop(connection_id, None)

    async def verification(
        self,
        connection_id: UUID,
        *,
        mode: str,
        verify_token: str,
        challenge: str,
    ) -> WebhookResponse:
        async with self._lock:
            runtime = self._runtimes.get(connection_id)
        if runtime is None:
            return WebhookResponse(404, b"not found")
        return await runtime.verify_webhook(
            mode=mode,
            verify_token=verify_token,
            challenge=challenge,
        )

    async def notification(
        self, connection_id: UUID, *, signature: str, body: bytes
    ) -> WebhookResponse:
        async with self._lock:
            runtime = self._runtimes.get(connection_id)
        if runtime is None:
            return WebhookResponse(404, b"not found")
        return await runtime.accept_webhook(signature=signature, body=body)


class WhatsAppGatewayRuntime:
    def __init__(
        self,
        *,
        settings: WhatsAppSettings,
        credential: WhatsAppCredential,
        client: Any,
        signer: Any,
        router: WhatsAppWebhookRouter,
        spool: InboundSpool | None = None,
        graph: WhatsAppGraphClient | None = None,
    ):
        self.settings = settings
        self.credential = credential
        self.client = client
        self.signer = signer
        self.router = router
        self.spool = spool or InboundSpool(settings.state_path)
        self.graph = graph or WhatsAppGraphClient(
            credential=credential,
            graph_origin=settings.graph_origin,
            timeout_seconds=settings.http_timeout_seconds,
        )
        self._webhook_verified = False
        self._graph_ready = False
        self._last_graph_error: str | None = None

    @property
    def capabilities(self) -> dict[str, Any]:
        return {
            "text": True,
            "polling": False,
            "webhook": True,
            "webhook_verified": self._webhook_verified,
            "typing": False,
            "media": [],
            "templates": False,
            "unsupported_attachment_notice": True,
            "transport": "meta-whatsapp-cloud-api",
        }

    async def run(self, stop_event: asyncio.Event) -> None:
        await self.spool.initialize()
        self._webhook_verified = (
            await self.spool.get_runtime_state(_WEBHOOK_VERIFIED_KEY) == "true"
        )
        await self.router.register(self.settings.connection_id, self)
        await self._safe_heartbeat("connecting", None)
        try:
            await self._refresh_graph_health()
            await self._report_current_health()
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
            await self.router.unregister(self.settings.connection_id, self)
            await self._safe_heartbeat("offline", None)
            await self.graph.close()
            await self.client.close()

    async def verify_webhook(
        self, *, mode: str, verify_token: str, challenge: str
    ) -> WebhookResponse:
        if (
            mode != "subscribe"
            or not challenge
            or len(challenge) > 512
            or not hmac.compare_digest(verify_token, self.credential.verify_token)
        ):
            return WebhookResponse(403, b"forbidden")
        await self.spool.set_runtime_state(_WEBHOOK_VERIFIED_KEY, "true")
        self._webhook_verified = True
        await self._report_current_health()
        return WebhookResponse(200, challenge.encode("utf-8"))

    async def accept_webhook(
        self, *, signature: str, body: bytes
    ) -> WebhookResponse:
        expected = "sha256=" + hmac.new(
            self.credential.app_secret.encode("utf-8"), body, hashlib.sha256
        ).hexdigest()
        if not re.fullmatch(r"sha256=[0-9a-f]{64}", signature) or not hmac.compare_digest(
            signature, expected
        ):
            return WebhookResponse(401, b"invalid signature")
        try:
            payload = json.loads(body)
        except (UnicodeDecodeError, json.JSONDecodeError):
            return WebhookResponse(400, b"invalid payload")
        try:
            messages = self._normalize_webhook(payload)
        except PermissionError:
            return WebhookResponse(403, b"connection mismatch")
        except ValueError:
            return WebhookResponse(400, b"payload is too complex")
        for provider_event_id, chat_id, content, received_at in messages:
            await self.spool.put(
                provider_event_id=provider_event_id,
                provider_chat_id=chat_id,
                content=content,
                received_at=received_at,
                touch_inbound_at=received_at,
            )
        return WebhookResponse(200, b"ok")

    def _normalize_webhook(
        self, payload: Any
    ) -> list[tuple[str, str, str, int]]:
        if not isinstance(payload, dict) or payload.get("object") != "whatsapp_business_account":
            return []
        entries = payload.get("entry")
        if not isinstance(entries, list):
            return []
        if len(entries) > _MAX_MESSAGES_PER_WEBHOOK:
            raise ValueError("too many WhatsApp entries")
        normalized: list[tuple[str, str, str, int]] = []
        now = int(time.time())
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            if str(entry.get("id", "")) != self.credential.waba_id:
                raise PermissionError("WhatsApp WABA mismatch")
            changes = entry.get("changes")
            if not isinstance(changes, list):
                continue
            if len(changes) > _MAX_MESSAGES_PER_WEBHOOK:
                raise ValueError("too many WhatsApp changes")
            for change in changes:
                if not isinstance(change, dict) or change.get("field") != "messages":
                    continue
                value = change.get("value")
                if not isinstance(value, dict):
                    continue
                metadata = value.get("metadata")
                if not isinstance(metadata, dict) or str(
                    metadata.get("phone_number_id", "")
                ) != self.credential.phone_number_id:
                    raise PermissionError("WhatsApp phone mismatch")
                messages = value.get("messages")
                if not isinstance(messages, list):
                    continue
                if (
                    len(messages) > _MAX_MESSAGES_PER_WEBHOOK
                    or len(normalized) + len(messages) > _MAX_MESSAGES_PER_WEBHOOK
                ):
                    raise ValueError("too many WhatsApp messages")
                for message in messages:
                    item = self._normalize_message(message, now)
                    if item is not None:
                        normalized.append(item)
        return normalized

    @staticmethod
    def _normalize_message(
        message: Any, now: int
    ) -> tuple[str, str, str, int] | None:
        if not isinstance(message, dict):
            return None
        message_id = message.get("id")
        chat_id = message.get("from")
        if (
            not isinstance(message_id, str)
            or not 1 <= len(message_id) <= 200
            or not isinstance(chat_id, str)
            or not re.fullmatch(r"\d{5,20}", chat_id)
        ):
            return None
        message_type = message.get("type")
        if message_type == "text":
            text = message.get("text")
            content = text.get("body") if isinstance(text, dict) else None
            if not isinstance(content, str) or not content.strip():
                return None
            content = content.strip()
            if len(content) > 4096:
                content = content[:4096]
        else:
            content = _UNSUPPORTED_NOTICE
        raw_timestamp = message.get("timestamp")
        try:
            received_at = int(raw_timestamp)
        except (TypeError, ValueError, OverflowError):
            received_at = now
        if received_at < 0 or received_at > now + 300:
            received_at = now
        return f"whatsapp:message:{message_id}", chat_id, content, received_at

    async def _heartbeat_loop(self, stop_event: asyncio.Event) -> None:
        while not stop_event.is_set():
            await self._wait(stop_event, self.settings.heartbeat_seconds)
            if stop_event.is_set():
                return
            await self.spool.prune_dead(self.settings.dead_retention_seconds)
            await self.spool.prune_outbound_receipts(
                self.settings.dead_retention_seconds
            )
            await self._refresh_graph_health()
            await self._report_current_health()

    async def _refresh_graph_health(self) -> None:
        health = await self.graph.healthcheck()
        self._graph_ready = health.ok
        self._last_graph_error = health.error_code

    async def _report_current_health(self) -> None:
        _, dead = await self.spool.counts()
        if dead:
            await self._safe_heartbeat("degraded", "inbound_dead_letter")
        elif not self._graph_ready:
            await self._safe_heartbeat(
                "degraded", self._last_graph_error or "whatsapp_graph_unavailable"
            )
        elif not self._webhook_verified:
            await self._safe_heartbeat("connecting", None)
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
            logger.warning("AirHop WhatsApp heartbeat failed", exc_info=True)

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
                tags = [
                    ["h", route.channel_id],
                    ["airhop-direction", "inbound"],
                    ["airhop-provider", "whatsapp_cloud"],
                    ["airhop-connection", str(self.settings.connection_id)],
                    ["airhop-conversation", route.conversation_id],
                ]
                if route.root_event_id:
                    tags.extend(
                        [
                            ["e", route.root_event_id, "", "root"],
                            ["e", route.root_event_id, "", "reply"],
                        ]
                    )
                event = self.signer.sign_event(
                    kind=9,
                    content=item.content,
                    tags=tags,
                )
                await self.spool.persist_event(item.provider_event_id, event)
            await self.client.ingest(item.provider_event_id, event)
            await self.spool.delivered(item.provider_event_id)
        except GatewayHttpError as exc:
            if exc.status_code == 409 and str(exc) == "airhop_thread_changed":
                await self.spool.reject_thread_candidate(item.provider_event_id)
            elif exc.status_code == 404 and item.event is None:
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
            logger.exception("WhatsApp inbound delivery failed")
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
                logger.warning("AirHop WhatsApp outbound claim failed", exc_info=True)
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
            if job.get("provider") != "whatsapp_cloud":
                raise ValueError("outbound provider mismatch")
            event = job.get("event")
            if not isinstance(event, dict):
                raise ValueError("outbound event is missing")
            content = event.get("content")
            if not isinstance(content, str) or not content.strip():
                raise ValueError("outbound content is empty")
            provider_chat_id = str(job.get("providerChatId", ""))
            if not re.fullmatch(r"\d{5,20}", provider_chat_id):
                raise ValueError("outbound recipient is invalid")
            receipt = await self.spool.outbound_receipt(outbox_id)
            if receipt is not None:
                await self.client.complete_delivered(
                    outbox_id=outbox_id,
                    lease_token=lease_token,
                    provider_message_id=receipt,
                )
                return
            last_inbound = await self.spool.last_inbound_at(provider_chat_id)
            if (
                last_inbound is None
                or int(time.time()) - last_inbound > _SERVICE_WINDOW_SECONDS
            ):
                await self.client.complete_failed(
                    outbox_id=outbox_id,
                    lease_token=lease_token,
                    error_code="whatsapp_template_required",
                    retry_after_seconds=0,
                    retryable=False,
                )
                return
            result = await self.graph.send_text(provider_chat_id, content.strip())
            if result.success and result.message_id is not None:
                await self.spool.record_outbound_receipt(
                    outbox_id, result.message_id
                )
                await self.client.complete_delivered(
                    outbox_id=outbox_id,
                    lease_token=lease_token,
                    provider_message_id=result.message_id,
                )
                return
            await self.client.complete_failed(
                outbox_id=outbox_id,
                lease_token=lease_token,
                error_code=result.error_code,
                retry_after_seconds=result.retry_after_seconds,
                retryable=result.retryable,
            )
        except (KeyError, TypeError, ValueError):
            logger.exception("Rejecting invalid AirHop WhatsApp outbound job")
            if outbox_id and lease_token:
                await self.client.complete_failed(
                    outbox_id=outbox_id,
                    lease_token=lease_token,
                    error_code="invalid_outbound_job",
                    retry_after_seconds=0,
                    retryable=False,
                )
        except Exception:
            # Provider/network ambiguity must not be marked delivered. If Meta
            # returned success, the durable local receipt closes the later
            # Relay-completion retry without re-sending.
            logger.exception("WhatsApp outbound delivery crashed before completion")

    @staticmethod
    async def _wait(stop_event: asyncio.Event, seconds: float) -> None:
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=seconds)
        except asyncio.TimeoutError:
            pass
