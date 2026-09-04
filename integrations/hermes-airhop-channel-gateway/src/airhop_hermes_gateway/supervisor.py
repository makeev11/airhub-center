"""Hosted multi-connection supervisor for self-service Telegram channels."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
import logging
import os
from pathlib import Path
from typing import Any
from uuid import UUID

from .client import AirHopGatewayClient, GatewayAssignment
from .config import Settings, _bounded_float

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SupervisorSettings:
    relay_url: str
    connector_secret_key: str = field(repr=False)
    state_root: Path = Path("/var/lib/airhop-channel-gateway/connections")
    sync_seconds: float = 15.0
    http_timeout_seconds: float = 15.0

    @classmethod
    def from_env(
        cls, source: dict[str, str] | None = None
    ) -> "SupervisorSettings":
        env = dict(os.environ if source is None else source)
        state_root = Path(
            env.get(
                "AIRHOP_GATEWAY_STATE_ROOT",
                "/var/lib/airhop-channel-gateway/connections",
            )
        )
        if not state_root.is_absolute():
            raise ValueError("AIRHOP_GATEWAY_STATE_ROOT must be absolute")
        if env.get("TELEGRAM_WEBHOOK_URL", "").strip():
            raise ValueError("hosted Telegram supervisor currently requires polling mode")

        # Reuse the single-connection parser as the validation authority for
        # relay URL, connector key, timing bounds, and all runtime defaults.
        probe = Settings.from_env(
            env,
            connection_id=UUID(int=1),
            telegram_bot_token="bootstrap-validation-only",
            state_path=state_root / "bootstrap.sqlite3",
        )
        return cls(
            relay_url=probe.relay_url,
            connector_secret_key=probe.connector_secret_key,
            state_root=state_root,
            sync_seconds=_bounded_float(
                env, "AIRHOP_ASSIGNMENT_SYNC_SECONDS", 15.0, 5.0, 300.0
            ),
            http_timeout_seconds=probe.http_timeout_seconds,
        )


RuntimeFactory = Callable[[GatewayAssignment], Awaitable[Any]]


class GatewaySupervisor:
    """Reconciles Relay assignments into isolated Telegram runtime tasks."""

    def __init__(
        self,
        *,
        settings: SupervisorSettings,
        control_client: AirHopGatewayClient,
        runtime_factory: RuntimeFactory,
    ):
        self.settings = settings
        self.control_client = control_client
        self.runtime_factory = runtime_factory
        self._tasks: dict[UUID, tuple[asyncio.Event, asyncio.Task[None]]] = {}

    async def run(self, stop_event: asyncio.Event) -> None:
        try:
            while not stop_event.is_set():
                await self._reconcile()
                await self._wait(stop_event, self.settings.sync_seconds)
        finally:
            await self._stop_all()
            await self.control_client.close()

    async def _reconcile(self) -> None:
        for connection_id, (_, task) in list(self._tasks.items()):
            if task.done():
                self._tasks.pop(connection_id, None)
                try:
                    task.result()
                except asyncio.CancelledError:
                    pass
                except Exception:
                    logger.exception(
                        "Telegram connection runtime stopped unexpectedly",
                        extra={"connection_id": str(connection_id)},
                    )

        try:
            assignments = await self.control_client.list_assignments()
        except Exception:
            logger.warning("AirHop assignment sync failed", exc_info=True)
            return
        desired = {
            assignment.connection_id: assignment
            for assignment in assignments
            if assignment.provider == "telegram" and assignment.status == "active"
        }

        for connection_id in set(self._tasks) - set(desired):
            await self._stop(connection_id)
        for connection_id, assignment in desired.items():
            if connection_id in self._tasks:
                continue
            child_stop = asyncio.Event()
            task = asyncio.create_task(self._run_assignment(assignment, child_stop))
            self._tasks[connection_id] = (child_stop, task)

    async def _run_assignment(
        self, assignment: GatewayAssignment, stop_event: asyncio.Event
    ) -> None:
        runtime = await self.runtime_factory(assignment)
        await runtime.run(stop_event)

    async def _stop(self, connection_id: UUID) -> None:
        current = self._tasks.pop(connection_id, None)
        if current is None:
            return
        stop_event, task = current
        stop_event.set()
        await asyncio.gather(task, return_exceptions=True)

    async def _stop_all(self) -> None:
        for stop_event, _ in self._tasks.values():
            stop_event.set()
        await asyncio.gather(
            *(task for _, task in self._tasks.values()), return_exceptions=True
        )
        self._tasks.clear()

    @staticmethod
    async def _wait(stop_event: asyncio.Event, seconds: float) -> None:
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=seconds)
        except asyncio.TimeoutError:
            pass
