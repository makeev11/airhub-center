from __future__ import annotations

import asyncio
from pathlib import Path
import unittest
from uuid import UUID

from airhop_hermes_gateway.client import GatewayAssignment
from airhop_hermes_gateway.supervisor import GatewaySupervisor, SupervisorSettings


class FakeControlClient:
    def __init__(self, assignments):
        self.assignments = assignments
        self.closed = False

    async def list_assignments(self):
        return list(self.assignments)

    async def close(self):
        self.closed = True


class FakeRuntime:
    def __init__(self):
        self.started = asyncio.Event()
        self.stopped = asyncio.Event()

    async def run(self, stop_event):
        self.started.set()
        await stop_event.wait()
        self.stopped.set()


class GatewaySupervisorTest(unittest.IsolatedAsyncioTestCase):
    async def test_active_assignments_start_and_paused_assignments_stop(self):
        connection_id = UUID("50000000-0000-0000-0000-000000000005")
        control = FakeControlClient(
            [GatewayAssignment(connection_id, "telegram", "active")]
        )
        runtimes = []

        async def runtime_factory(_assignment):
            runtime = FakeRuntime()
            runtimes.append(runtime)
            return runtime

        supervisor = GatewaySupervisor(
            settings=SupervisorSettings(
                relay_url="https://center.example",
                connector_secret_key="01" * 32,
                state_root=Path("/tmp/airhop-test"),
                sync_seconds=5,
                http_timeout_seconds=5,
            ),
            control_client=control,
            runtime_factory=runtime_factory,
        )
        await supervisor._reconcile()
        await asyncio.sleep(0)
        await asyncio.wait_for(runtimes[0].started.wait(), timeout=1)

        control.assignments = [
            GatewayAssignment(connection_id, "telegram", "paused")
        ]
        await supervisor._reconcile()
        self.assertTrue(runtimes[0].stopped.is_set())
        self.assertEqual(supervisor._tasks, {})


if __name__ == "__main__":
    unittest.main()
