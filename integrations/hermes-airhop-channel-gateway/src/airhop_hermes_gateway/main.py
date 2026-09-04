"""Process entry point for the pinned Hermes Telegram deployment role."""

from __future__ import annotations

import asyncio
import argparse
import logging
import os
import signal
from uuid import UUID

from .client import AirHopGatewayClient
from .config import Settings
from .nostr import NostrSigner
from .runtime import TelegramGatewayRuntime
from .supervisor import GatewaySupervisor, SupervisorSettings


def _build_adapter(settings: Settings):
    try:
        from gateway.config import PlatformConfig
        from plugins.platforms.telegram.adapter import TelegramAdapter
    except ImportError as exc:
        raise RuntimeError(
            "Hermes Agent sources and Telegram dependencies are not installed"
        ) from exc
    class AirHopTelegramAdapter(TelegramAdapter):
        """Pinned adapter seam that commits each update before PTB can ACK it.

        Hermes normally debounces text in an in-memory task before invoking its
        model handler. AirHop owns batching later in Relay, so this deployment
        bypasses that model-oriented debounce and synchronously commits each
        provider update to the local durable inbox instead.
        """

        def set_durable_message_handler(self, handler):
            self._airhop_durable_message_handler = handler

        def _enqueue_text_event(self, event):
            handler = getattr(self, "_airhop_durable_message_handler", None)
            if handler is None:
                return super()._enqueue_text_event(event)
            handler(event)

        async def handle_message(self, event):
            handler = getattr(self, "_airhop_durable_message_handler", None)
            if handler is None:
                return await super().handle_message(event)
            handler(event)

    config = PlatformConfig(
        enabled=True,
        token=settings.telegram_bot_token,
        reply_to_mode="off",
        gateway_restart_notification=False,
        typing_indicator=False,
        extra={
            "disable_link_previews": True,
            "rich_messages": False,
            "unauthorized_dm_behavior": "ignore",
        },
    )
    return AirHopTelegramAdapter(config)


async def _run() -> None:
    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()
    for signum in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(signum, stop_event.set)
        except NotImplementedError:
            pass

    env = dict(os.environ)
    if env.get("AIRHOP_CONNECTION_ID", "").strip():
        connection_id = UUID(env["AIRHOP_CONNECTION_ID"].strip())
        if not env.get("TELEGRAM_BOT_TOKEN", "").strip():
            probe = Settings.from_env(
                env,
                connection_id=connection_id,
                telegram_bot_token="bootstrap-validation-only",
            )
            signer = NostrSigner(probe.connector_secret_key)
            credential_client = AirHopGatewayClient(
                relay_url=probe.relay_url,
                connection_id=None,
                signer=signer,
                timeout_seconds=probe.http_timeout_seconds,
            )
            try:
                token = await credential_client.get_credential(connection_id)
            finally:
                await credential_client.close()
            settings = Settings.from_env(
                env, connection_id=connection_id, telegram_bot_token=token
            )
        else:
            settings = Settings.from_env(env)
        signer = NostrSigner(settings.connector_secret_key)
        client = AirHopGatewayClient(
            relay_url=settings.relay_url,
            connection_id=settings.connection_id,
            signer=signer,
            timeout_seconds=settings.http_timeout_seconds,
        )
        runtime = TelegramGatewayRuntime(
            settings=settings,
            adapter=_build_adapter(settings),
            client=client,
            signer=signer,
        )
        await runtime.run(stop_event)
        return

    supervisor_settings = SupervisorSettings.from_env(env)
    signer = NostrSigner(supervisor_settings.connector_secret_key)
    control_client = AirHopGatewayClient(
        relay_url=supervisor_settings.relay_url,
        connection_id=None,
        signer=signer,
        timeout_seconds=supervisor_settings.http_timeout_seconds,
    )

    async def runtime_factory(assignment):
        token = await control_client.get_credential(assignment.connection_id)
        settings = Settings.from_env(
            env,
            connection_id=assignment.connection_id,
            telegram_bot_token=token,
            state_path=(
                supervisor_settings.state_root
                / f"{assignment.connection_id}.sqlite3"
            ),
        )
        client = AirHopGatewayClient(
            relay_url=settings.relay_url,
            connection_id=settings.connection_id,
            signer=signer,
            timeout_seconds=settings.http_timeout_seconds,
        )
        return TelegramGatewayRuntime(
            settings=settings,
            adapter=_build_adapter(settings),
            client=client,
            signer=signer,
        )

    supervisor = GatewaySupervisor(
        settings=supervisor_settings,
        control_client=control_client,
        runtime_factory=runtime_factory,
    )
    await supervisor.run(stop_event)


def main() -> None:
    parser = argparse.ArgumentParser(description="AirHop Hermes Channel Gateway")
    parser.add_argument(
        "--print-connector-pubkey",
        action="store_true",
        help="print the x-only public key for AIRHOP_CONNECTOR_SECRET_KEY and exit",
    )
    args = parser.parse_args()
    if args.print_connector_pubkey:
        secret = os.environ.get("AIRHOP_CONNECTOR_SECRET_KEY", "").strip()
        if not secret:
            parser.error("AIRHOP_CONNECTOR_SECRET_KEY is required")
        print(NostrSigner(secret).public_key_hex)
        return
    level = os.environ.get("AIRHOP_GATEWAY_LOG_LEVEL", "INFO").upper()
    logging.basicConfig(
        level=getattr(logging, level, logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    asyncio.run(_run())


if __name__ == "__main__":
    main()
