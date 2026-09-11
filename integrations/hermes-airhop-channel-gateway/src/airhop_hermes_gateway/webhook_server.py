"""Bounded HTTP ingress for connection-scoped WhatsApp Cloud webhooks."""

from __future__ import annotations

import asyncio
from concurrent.futures import TimeoutError as FutureTimeoutError
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import logging
import threading
from urllib.parse import parse_qs, urlsplit
from uuid import UUID

from .whatsapp import WebhookResponse, WhatsAppWebhookRouter

logger = logging.getLogger(__name__)


class _WebhookHttpServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


class WhatsAppWebhookServer:
    def __init__(
        self,
        *,
        router: WhatsAppWebhookRouter,
        host: str = "0.0.0.0",
        port: int = 8443,
        base_path: str = "/webhooks/whatsapp",
        max_body_bytes: int = 1024 * 1024,
        request_timeout_seconds: float = 20.0,
    ):
        self.router = router
        self.host = host
        self.port = port
        self.base_path = "/" + base_path.strip("/")
        self.max_body_bytes = max_body_bytes
        self.request_timeout_seconds = request_timeout_seconds
        self._server: _WebhookHttpServer | None = None
        self._thread: threading.Thread | None = None

    @property
    def bound_port(self) -> int | None:
        return self._server.server_port if self._server is not None else None

    async def start(self) -> None:
        if self._server is not None:
            raise RuntimeError("WhatsApp webhook server is already running")
        loop = asyncio.get_running_loop()
        owner = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def setup(self) -> None:
                super().setup()
                self.connection.settimeout(owner.request_timeout_seconds)

            def log_message(self, _format: str, *_args: object) -> None:
                # The GET query contains the Meta verify token. Never send raw
                # request targets through BaseHTTPRequestHandler logging.
                return

            def do_GET(self) -> None:
                parsed = urlsplit(self.path)
                if parsed.path == "/healthz":
                    self._respond(WebhookResponse(200, b"ok"))
                    return
                connection_id = self._connection_id(parsed.path)
                if connection_id is None:
                    self._respond(WebhookResponse(404, b"not found"))
                    return
                try:
                    query = parse_qs(
                        parsed.query,
                        keep_blank_values=True,
                        strict_parsing=False,
                        max_num_fields=16,
                    )
                except ValueError:
                    self._respond(WebhookResponse(400, b"invalid query"))
                    return
                response = self._dispatch(
                    owner.router.verification(
                        connection_id,
                        mode=self._single(query, "hub.mode"),
                        verify_token=self._single(query, "hub.verify_token"),
                        challenge=self._single(query, "hub.challenge"),
                    )
                )
                self._respond(response)

            def do_POST(self) -> None:
                parsed = urlsplit(self.path)
                connection_id = self._connection_id(parsed.path)
                if connection_id is None or parsed.query:
                    self._respond(WebhookResponse(404, b"not found"))
                    return
                if self.headers.get("transfer-encoding"):
                    self._respond(WebhookResponse(400, b"content length required"))
                    return
                content_type = self.headers.get("content-type", "")
                if content_type.split(";", 1)[0].strip().lower() != "application/json":
                    self._respond(WebhookResponse(415, b"application/json required"))
                    return
                raw_length = self.headers.get("content-length", "").strip()
                try:
                    length = int(raw_length, 10)
                except ValueError:
                    self._respond(WebhookResponse(400, b"invalid content length"))
                    return
                if not 1 <= length <= owner.max_body_bytes:
                    self._respond(WebhookResponse(413, b"payload too large"))
                    return
                try:
                    body = self.rfile.read(length)
                except TimeoutError:
                    self._respond(WebhookResponse(408, b"request timeout"))
                    return
                except OSError:
                    self._respond(WebhookResponse(400, b"incomplete payload"))
                    return
                if len(body) != length:
                    self._respond(WebhookResponse(400, b"incomplete payload"))
                    return
                response = self._dispatch(
                    owner.router.notification(
                        connection_id,
                        signature=self.headers.get("x-hub-signature-256", "").strip(),
                        body=body,
                    )
                )
                self._respond(response)

            def _connection_id(self, path: str) -> UUID | None:
                prefix = owner.base_path + "/"
                if not path.startswith(prefix) or "/" in path[len(prefix) :]:
                    return None
                try:
                    connection_id = UUID(path[len(prefix) :])
                except ValueError:
                    return None
                return connection_id if connection_id.int != 0 else None

            @staticmethod
            def _single(query: dict[str, list[str]], key: str) -> str:
                values = query.get(key, [])
                return values[0] if len(values) == 1 else ""

            def _dispatch(self, coroutine) -> WebhookResponse:
                future = asyncio.run_coroutine_threadsafe(coroutine, loop)
                try:
                    return future.result(timeout=owner.request_timeout_seconds)
                except FutureTimeoutError:
                    future.cancel()
                    return WebhookResponse(503, b"temporarily unavailable")
                except Exception:
                    logger.exception("WhatsApp webhook processing failed")
                    return WebhookResponse(503, b"temporarily unavailable")

            def _respond(self, response: WebhookResponse) -> None:
                self.send_response(response.status)
                self.send_header("Content-Type", response.content_type)
                self.send_header("Content-Length", str(len(response.body)))
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Connection", "close")
                self.end_headers()
                self.wfile.write(response.body)
                self.close_connection = True

        server = _WebhookHttpServer((self.host, self.port), Handler)
        thread = threading.Thread(
            target=server.serve_forever,
            kwargs={"poll_interval": 0.2},
            name="airhop-whatsapp-webhook",
            daemon=True,
        )
        self._server = server
        self._thread = thread
        thread.start()
        logger.info("WhatsApp webhook server started")

    async def close(self) -> None:
        server = self._server
        thread = self._thread
        self._server = None
        self._thread = None
        if server is None:
            return
        await asyncio.to_thread(server.shutdown)
        await asyncio.to_thread(server.server_close)
        if thread is not None:
            await asyncio.to_thread(thread.join, 5.0)
        logger.info("WhatsApp webhook server stopped")
