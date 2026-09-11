"""Authenticated HTTP client for the provider-neutral AirHop gateway contract."""

from __future__ import annotations

from dataclasses import dataclass, field
import json
import re
from typing import Any, TYPE_CHECKING
from uuid import UUID

import httpx

if TYPE_CHECKING:
    from .nostr import NostrSigner


def _canonical_json(value: Any) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, separators=(",", ":"), sort_keys=False
    ).encode("utf-8")


class GatewayHttpError(RuntimeError):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code

    @property
    def retryable(self) -> bool:
        return self.status_code in {408, 425, 429} or self.status_code >= 500


@dataclass(frozen=True)
class RouteResolution:
    conversation_id: str
    channel_id: str
    route_status: str
    connection_status: str
    handoff_status: str | None = None
    root_event_id: str | None = None
    threaded: bool = False


@dataclass(frozen=True)
class GatewayAssignment:
    connection_id: UUID
    provider: str
    status: str


@dataclass(frozen=True)
class GatewayCredential:
    connection_id: UUID
    provider: str
    token: str = field(repr=False)


@dataclass(frozen=True)
class WhatsAppCredential:
    """Validated center-owned Meta credential without secret repr output."""

    app_id: str
    waba_id: str
    phone_number_id: str
    app_secret: str = field(repr=False)
    access_token: str = field(repr=False)
    verify_token: str = field(repr=False)


class AirHopGatewayClient:
    def __init__(
        self,
        *,
        relay_url: str,
        connection_id: UUID | None,
        signer: "NostrSigner",
        timeout_seconds: float,
        http_client: httpx.AsyncClient | None = None,
    ):
        self.relay_url = relay_url.rstrip("/")
        self.connection_id = str(connection_id) if connection_id is not None else None
        self.signer = signer
        self._owns_http = http_client is None
        self._http = http_client or httpx.AsyncClient(
            timeout=httpx.Timeout(timeout_seconds), follow_redirects=False
        )

    async def close(self) -> None:
        if self._owns_http:
            await self._http.aclose()

    async def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        url = f"{self.relay_url}{path}"
        body = _canonical_json(payload)
        auth = self.signer.nip98_header("POST", url, body)
        try:
            response = await self._http.post(
                url,
                content=body,
                headers={
                    "authorization": auth,
                    "content-type": "application/json",
                    "accept": "application/json",
                },
            )
        except httpx.TimeoutException as exc:
            raise GatewayHttpError(408, "AirHop gateway request timed out") from exc
        except httpx.TransportError as exc:
            raise GatewayHttpError(503, "AirHop gateway transport unavailable") from exc
        try:
            result = response.json()
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise GatewayHttpError(
                response.status_code,
                f"AirHop gateway returned non-JSON HTTP {response.status_code}",
            ) from exc
        if response.is_error:
            message = result.get("error") if isinstance(result, dict) else None
            raise GatewayHttpError(
                response.status_code,
                str(message or f"AirHop gateway returned HTTP {response.status_code}"),
            )
        if not isinstance(result, dict):
            raise GatewayHttpError(502, "AirHop gateway returned an invalid envelope")
        return result

    async def _get(self, path: str) -> dict[str, Any]:
        url = f"{self.relay_url}{path}"
        auth = self.signer.nip98_header("GET", url, None)
        try:
            response = await self._http.get(
                url,
                headers={"authorization": auth, "accept": "application/json"},
            )
        except httpx.TimeoutException as exc:
            raise GatewayHttpError(408, "AirHop gateway request timed out") from exc
        except httpx.TransportError as exc:
            raise GatewayHttpError(503, "AirHop gateway transport unavailable") from exc
        try:
            result = response.json()
        except json.JSONDecodeError as exc:
            raise GatewayHttpError(
                response.status_code,
                f"AirHop gateway returned non-JSON HTTP {response.status_code}",
            ) from exc
        if response.is_error:
            message = result.get("error") if isinstance(result, dict) else None
            raise GatewayHttpError(
                response.status_code,
                str(message or f"AirHop gateway returned HTTP {response.status_code}"),
            )
        if not isinstance(result, dict):
            raise GatewayHttpError(502, "AirHop gateway returned an invalid envelope")
        return result

    def _required_connection_id(self) -> str:
        if self.connection_id is None:
            raise RuntimeError("AirHop gateway operation requires a connection id")
        return self.connection_id

    async def list_assignments(self) -> list[GatewayAssignment]:
        result = await self._get(
            "/api/airhop/integrations/v1/channel-gateway/assignments"
        )
        assignments = result.get("assignments")
        if not isinstance(assignments, list):
            raise GatewayHttpError(502, "AirHop gateway returned invalid assignments")
        parsed: list[GatewayAssignment] = []
        for value in assignments:
            if not isinstance(value, dict):
                raise GatewayHttpError(502, "AirHop gateway returned invalid assignment")
            parsed.append(
                GatewayAssignment(
                    connection_id=UUID(str(value["connectionId"])),
                    provider=str(value["provider"]),
                    status=str(value["status"]),
                )
            )
        return parsed

    async def get_gateway_credential(
        self, connection_id: UUID
    ) -> GatewayCredential:
        result = await self._get(
            "/api/airhop/integrations/v1/channel-gateway/connections/"
            f"{connection_id}/credential"
        )
        if str(result.get("connectionId")) != str(connection_id):
            raise GatewayHttpError(502, "AirHop gateway credential scope mismatch")
        token = result.get("token")
        provider = result.get("provider")
        if (
            provider not in {"telegram", "whatsapp_cloud"}
            or not isinstance(token, str)
            or not token
        ):
            raise GatewayHttpError(502, "AirHop gateway returned invalid credential")
        return GatewayCredential(
            connection_id=connection_id,
            provider=provider,
            token=token,
        )

    async def get_credential(self, connection_id: UUID) -> str:
        """Returns a Telegram token for the legacy Telegram runtime seam."""
        credential = await self.get_gateway_credential(connection_id)
        if credential.provider != "telegram":
            raise GatewayHttpError(502, "AirHop gateway returned invalid credential")
        return credential.token

    async def get_whatsapp_credential(
        self, connection_id: UUID
    ) -> WhatsAppCredential:
        credential = await self.get_gateway_credential(connection_id)
        if credential.provider != "whatsapp_cloud":
            raise GatewayHttpError(502, "AirHop gateway returned invalid credential")
        try:
            value = json.loads(credential.token)
        except (json.JSONDecodeError, TypeError) as exc:
            raise GatewayHttpError(
                502, "AirHop gateway returned invalid WhatsApp credential"
            ) from exc
        expected = {
            "schemaVersion",
            "appId",
            "appSecret",
            "wabaId",
            "phoneNumberId",
            "accessToken",
            "verifyToken",
        }
        if not isinstance(value, dict) or set(value) != expected:
            raise GatewayHttpError(
                502, "AirHop gateway returned invalid WhatsApp credential"
            )
        app_id = value.get("appId")
        app_secret = value.get("appSecret")
        waba_id = value.get("wabaId")
        phone_number_id = value.get("phoneNumberId")
        access_token = value.get("accessToken")
        verify_token = value.get("verifyToken")
        valid_id = lambda item: isinstance(item, str) and bool(
            re.fullmatch(r"\d{5,40}", item)
        )
        if (
            value.get("schemaVersion") != "airhop.whatsapp-cloud-credential.v1"
            or not valid_id(app_id)
            or not valid_id(waba_id)
            or not valid_id(phone_number_id)
            or not isinstance(app_secret, str)
            or not 16 <= len(app_secret) <= 512
            or not re.fullmatch(r"[A-Za-z0-9_-]+", app_secret)
            or not isinstance(access_token, str)
            or not 16 <= len(access_token) <= 4096
            or any(
                character.isspace() or not character.isprintable()
                for character in access_token
            )
            or not isinstance(verify_token, str)
            or not re.fullmatch(r"[0-9a-f]{64}", verify_token)
        ):
            raise GatewayHttpError(
                502, "AirHop gateway returned invalid WhatsApp credential"
            )
        return WhatsAppCredential(
            app_id=app_id,
            app_secret=app_secret,
            waba_id=waba_id,
            phone_number_id=phone_number_id,
            access_token=access_token,
            verify_token=verify_token,
        )

    async def resolve_route(self, provider_chat_id: str, handoff_token_digest: str | None = None) -> RouteResolution:
        connection_id = self._required_connection_id()
        result = await self._post(
            "/api/airhop/integrations/v1/channel-gateway/routes/resolve",
            {
                "connectionId": connection_id,
                "providerChatId": provider_chat_id,
                **({"handoffTokenDigest": handoff_token_digest} if handoff_token_digest else {}),
            },
        )
        return RouteResolution(
            conversation_id=str(result["conversationId"]),
            channel_id=str(result["channelId"]),
            route_status=str(result["routeStatus"]),
            connection_status=str(result["connectionStatus"]),
            handoff_status=result.get("handoffStatus"),
            root_event_id=result.get("rootEventId"),
            threaded=result.get("threaded", False),
        )

    async def ingest(self, provider_event_id: str, event: dict[str, Any]) -> dict[str, Any]:
        connection_id = self._required_connection_id()
        return await self._post(
            "/api/airhop/integrations/v1/channel-gateway/inbound",
            {
                "connectionId": connection_id,
                "providerEventId": provider_event_id,
                "event": event,
            },
        )

    async def heartbeat(
        self,
        *,
        observed_status: str,
        observed_capabilities: dict[str, Any],
        error_code: str | None,
    ) -> dict[str, Any]:
        connection_id = self._required_connection_id()
        return await self._post(
            "/api/airhop/integrations/v1/channel-gateway/connections/"
            f"{connection_id}/heartbeat",
            {
                "observedStatus": observed_status,
                "observedCapabilities": observed_capabilities,
                "errorCode": error_code,
            },
        )

    async def claim(self, *, limit: int, lease_seconds: int) -> list[dict[str, Any]]:
        connection_id = self._required_connection_id()
        result = await self._post(
            "/api/airhop/integrations/v1/channel-gateway/outbound/claim",
            {
                "connectionId": connection_id,
                "limit": limit,
                "leaseSeconds": lease_seconds,
            },
        )
        jobs = result.get("jobs")
        if not isinstance(jobs, list):
            raise GatewayHttpError(502, "AirHop gateway returned invalid outbound jobs")
        return [job for job in jobs if isinstance(job, dict)]

    async def complete_delivered(
        self, *, outbox_id: str, lease_token: str, provider_message_id: str | None
    ) -> dict[str, Any]:
        self._required_connection_id()
        return await self._post(
            f"/api/airhop/integrations/v1/channel-gateway/outbound/{outbox_id}/complete",
            {
                "status": "delivered",
                "leaseToken": lease_token,
                "providerMessageId": provider_message_id,
            },
        )

    async def complete_failed(
        self,
        *,
        outbox_id: str,
        lease_token: str,
        error_code: str,
        retry_after_seconds: int,
        retryable: bool,
    ) -> dict[str, Any]:
        self._required_connection_id()
        return await self._post(
            f"/api/airhop/integrations/v1/channel-gateway/outbound/{outbox_id}/complete",
            {
                "status": "failed",
                "leaseToken": lease_token,
                "errorCode": error_code,
                "retryAfterSeconds": retry_after_seconds,
                "retryable": retryable,
            },
        )
