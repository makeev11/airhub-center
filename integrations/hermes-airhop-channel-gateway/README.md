# AirHop Hermes Channel Gateway

This deployment role reuses the official Hermes Agent Telegram transport and
keeps AirHop as the authority for conversations, Hermes turns, and outbound
delivery state. It does not run the Hermes model loop and does not copy the
Telegram Bot API implementation.

Pinned upstream:

- Hermes Agent `v2026.8.18` / `0.20.4`;
- immutable commit `e624e9fde561e1add9388384012b295fde669ade`;
- `plugins.platforms.telegram.adapter.TelegramAdapter`;
- `python-telegram-bot==22.8` plus the upstream-locked `tornado==6.5.7`
  webhook runtime;

Hermes core dependencies come from the commit's frozen `uv.lock` using the
digest-pinned upstream `uv` image. Telegram and its webhook runtime are exact
pins; the broad Discord/Slack messaging extra is not installed. The final
gateway image contains neither `git` nor `uv`.

## Hosted supervisor

Required:

```dotenv
AIRHOP_RELAY_URL=https://center.example.com
AIRHOP_CONNECTOR_SECRET_KEY=CHANGE_ME_64_HEX
```

`AIRHOP_RELAY_URL` is the tenant's public HTTP origin. It must match the URL
used by Relay when validating NIP-98. The connector public key must be an active
workspace member and must match `BUZZ_AIRHOP_TELEGRAM_CONNECTOR_PUBKEY` on
Relay. The private connector key exists only in this process.

With no `AIRHOP_CONNECTION_ID`, the process runs as a supervisor. It polls the
credential-free assignment endpoint and starts one isolated Hermes Telegram
runtime and SQLite spool per active connection. Owners paste BotFather tokens
inside Airhop Center. Relay validates and encrypts those tokens, and returns
plaintext only to this exact authenticated connector with `Cache-Control:
no-store`.

Optional tuning:

```dotenv
AIRHOP_GATEWAY_STATE_ROOT=/var/lib/airhop-channel-gateway/connections
AIRHOP_ASSIGNMENT_SYNC_SECONDS=15
```

Legacy single-connection mode remains available for migration. When
`TELEGRAM_BOT_TOKEN` is omitted, the process retrieves the encrypted credential
from Relay:

```dotenv
AIRHOP_CONNECTION_ID=00000000-0000-0000-0000-000000000001
# TELEGRAM_BOT_TOKEN=optional-legacy-override
```

Long polling is the hosted supervisor default. Webhook mode remains available
only in legacy single-connection mode when both values are present:

```dotenv
TELEGRAM_WEBHOOK_URL=https://gateway.example.com/telegram
TELEGRAM_WEBHOOK_SECRET=CHANGE_ME_HIGH_ENTROPY
TELEGRAM_WEBHOOK_PORT=8443
TELEGRAM_WEBHOOK_HOST=0.0.0.0
```

Derive the public key that must be configured on Relay without printing the
secret:

```bash
docker run --rm \
  -e AIRHOP_CONNECTOR_SECRET_KEY="$AIRHOP_CONNECTOR_SECRET_KEY" \
  airhop-hermes-channel-gateway --print-connector-pubkey
```

The connector principal must be a current workspace member and a member of each
private external-conversation channel routed through its connections.

## Failure semantics

- Inbound Telegram text is first written to a SQLite WAL with `synchronous=FULL`.
- The state directory is mode `0700`, the database is `0600`, and the deployment
  volume must use encrypted storage. Delivered rows are deleted immediately;
  dead rows are retained for seven days by default for diagnosis, then reaped.
- Route lookup never returns another connection's chat and never indexes the
  clear Telegram chat ID; Relay resolves its tenant/connection-scoped HMAC.
- The exact signed kind-9 event is persisted locally before its first upload,
  so an ambiguous HTTP retry reuses one event ID.
- Provider update ID is deduplicated again atomically by Relay.
- Outbound uses server leases. A process crash leaves the lease to expire and
  counts toward the five-attempt bound.
- Hermes `SendResult` permanent failures finish immediately; retryable errors
  use provider delay and the server retry fence.

Only private Telegram DMs and text/command/location content are readable in this
slice. Other content produces a durable, visible unsupported-attachment notice
instead of being discarded. It does not upload the original or transcribe voice;
the parent runtime asks for text and can notify staff through an internal handoff.
A previously unseen private chat creates one unverified Buzz conversation.
A valid `/start ahh_…` additionally redeems a 15-minute public-booking grant
through the authenticated route-resolution boundary. Its irreversible digest is
durably queued before provider acknowledgement, so a restart can retry binding
without persisting the raw bearer. Relay atomically binds the verified identity
and consumes the grant; gateway then publishes only a redacted service message.
Invalid links never expose booking details. Existing-family/duplicate conflicts
ask Hermes for staff verification, not repeated blind link retries. Anonymous
phone matches do not grant access to established family history.
Continuous typing projection and original media remain later capabilities.
Deploy Relay migration 0052 before this gateway revision.

## Tests

The deterministic fake-Telegram round trip needs no Telegram or Hermes install:

```bash
cd integrations/hermes-airhop-channel-gateway
PYTHONPATH=src python3 -m unittest discover -s tests -v
```
