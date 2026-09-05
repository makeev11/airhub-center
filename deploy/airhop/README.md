# AirHop Center demo deployment

This stack is isolated from inherited Buzz deployments by its Compose project
name, network, containers, and dedicated named volumes. It runs the authoritative
Booking Core, PostgreSQL, Redis, MinIO, and the same React public booking flow
at `/booking`. The employee UI remains the native AirHop Center application and
connects to this relay via `RELAY_URL`.

## Prepare

1. Copy `.env.example` to `.env` on the server.
2. Replace every `CHANGE_ME` and choose one stable host for the Center.
3. Put an HTTPS reverse proxy or Cloudflare Tunnel in front of
   `127.0.0.1:3300`; WebSocket upgrades must be preserved. When the host already
   runs Traefik's Docker provider, set `AIRHOP_TRAEFIK_ENABLED=true`,
   `AIRHOP_PUBLIC_HOST`, and a unique `AIRHOP_DOCKER_NETWORK`; the bundled
   labels route the relay without publishing its port to the internet.
4. Point the desktop deployment configuration at the public `wss://` URL.

A purchased domain is not required for a disposable Telegram engineering
pilot: long polling has no inbound webhook requirement. A stable HTTPS host is
still strongly preferred because the host is the tenant boundary, the employee
client needs `wss://`, and changing it later creates a different community.
Provider wildcard hosts are suitable for this first isolated pilot.

Validate without starting anything:

```bash
AIRHOP_ENV_FILE=.env docker compose --env-file deploy/airhop/.env \
  -f deploy/airhop/compose.yml config --quiet
```

For a fresh isolated VPS pilot, generate the stable service keys and a dedicated
Hermes/connector keypair without printing them:

```bash
./deploy/airhop/prepare-pilot-env.sh \
  airhop-center.example.com \
  OWNER_PUBLIC_KEY_HEX \
  airhop-center-pilot-relay:RELEASE \
  /opt/airhop-center-pilot/shared/.env
```

The command refuses to overwrite an existing environment. Store that file with
the database and media backups; losing its encryption keys makes encrypted
booking/channel material unrecoverable.

Start or update:

```bash
AIRHOP_ENV_FILE=.env docker compose --env-file deploy/airhop/.env \
  -f deploy/airhop/compose.yml pull
AIRHOP_ENV_FILE=.env docker compose --env-file deploy/airhop/.env \
  -f deploy/airhop/compose.yml up -d --wait
```

## Hosted Hermes administrator

The optional `hermes` profile runs the real parent-facing Hermes Agent as an
always-on service. It uses the pinned upstream ACP runtime for reasoning and
session continuity, while the role-scoped Airhop MCP is its only action
surface. Shell, filesystem, browser, code-execution and subagent toolsets are
not available in this external profile.

Generate a dedicated Nostr keypair for Hermes and add its secret/public halves,
plus the DeepSeek key, to `.env` as shown in `.env.example`. Bring up the base
stack, seed or provision the organization, then run the idempotent pilot
bootstrap once:

```bash
AIRHOP_ENV_FILE=/absolute/path/to/.env ./scripts/bootstrap-airhop-hermes.sh
```

The bootstrap registers the Hermes and Telegram connector principals, publishes
Hermes' signed Buzz profile with the product avatar and the organization's
locale, and creates the initial organization-scoped deployment. Later
enable/disable and booking-capability changes continue through the normal
**Agents → Administrator Hermes** settings card.

On the pilot VPS, enter the DeepSeek key directly in an interactive terminal so
it never appears in chat or shell history:

```bash
./deploy/airhop/set-deepseek-key.sh /opt/airhop-center-pilot/shared/.env
```

Start the model runtime and Telegram gateway together:

```bash
AIRHOP_ENV_FILE=.env docker compose \
  --env-file deploy/airhop/.env -f deploy/airhop/compose.yml \
  --profile hermes --profile telegram \
  up -d --build --wait hermes-parent-runtime telegram-gateway
```

After the bot has been connected in **Settings → Communication channels**, run
the fail-closed pilot check. It verifies the six required services, the live
Hermes deployment, a fresh Telegram gateway heartbeat and the runtime tool
isolation without printing any credential:

```bash
AIRHOP_ENV_FILE=/absolute/path/to/.env ./scripts/check-airhop-hermes-pilot.sh
```

One persistent volume holds the Hermes ACP session database. Use encrypted VPS
storage, back it up with the other stateful volumes, and never share it between
organizations. The runtime has one worker, no autonomous heartbeat, an
eight-iteration model cap and bounded idle/absolute turn deadlines by default.

For a direct Telegram contact, no manual route row is required. The first
private message atomically creates one unverified private Buzz conversation;
Hermes then asks whether the person wants to book or is already a client. This
does not by itself authenticate a family. A separate online-booking Start grant
can now bind a newly created parent identity after its one-use, expiry and
conflict checks; returning/second-parent verification remains separate.

The deployable pilot includes **Telegram text consultation and the first online
booking handoff**, published knowledge, booking-option lookup, the shared Buzz
conversation and manual staff takeover/resume. Apply migration 0052 and deploy
matching Relay, public frontend, gateway and parent runtime to test the new
default-on auto-confirm policy. A successful Core receipt is required before
reporting confirmation. This is not live acceptance, nor an implementation of
returning-parent verification, voice/media review or WhatsApp. Follow
`docs/AIRHOP_HERMES_READINESS.md` for the exact checks and remaining boundaries.

Do not reuse the old `buzz-prod` database or volumes. A demo tenant and AirHop
organization must be provisioned deliberately; the real owner activation code
is then issued through the signed operator API described in
`docs/AIRHUB_CENTER_HQ_ACTIVATION_CONTRACT.md`.

### Attach Hermes to an existing demo Center

When a deliberately isolated Center demo already owns its relay, Postgres,
Redis, MinIO, public `wss://` host, and active organization, do not create a
second data stack. Merge `compose.existing.yml` after that deployment's base
and host override files. It adds only the hosted Hermes runtime, Telegram
gateway, two dedicated state volumes, and the relay's channel-credential
configuration.

Build and pin three immutable images from the same source revision: the root
Dockerfile's `runtime-airhop` target, the parent runtime, and the Telegram
gateway. Add the channel encryption keys, dedicated Hermes/connector keypairs,
DeepSeek key, model id, public relay URLs, and those three image tags to the
existing deployment environment. The add-on explicitly blanks model/provider
private credentials in the relay container.

Validate the fully merged configuration before changing containers:

```bash
docker compose --env-file /absolute/path/to/.env \
  -f /absolute/path/to/base-compose.yml \
  -f /absolute/path/to/host-override.yml \
  -f /absolute/path/to/compose.existing.yml \
  --profile hermes --profile telegram config --quiet
```

Update the relay first and wait for readiness/migrations. Then run the normal
Hermes bootstrap against that same merged Compose project and start the two
profile services. This path is appropriate for `demo.airhop.ru`; production
remains a separate release decision.

The bootstrap and readiness scripts accept the merged file list through a
colon-separated `AIRHOP_COMPOSE_FILES` value. Use
`AIRHOP_SKIP_IMAGE_BUILD=1` when the immutable images were already built and
pinned during the release:

```bash
AIRHOP_ENV_FILE=/absolute/path/to/.env \
AIRHOP_COMPOSE_PROJECT_NAME=existing-project-name \
AIRHOP_COMPOSE_FILES=/absolute/path/to/base.yml:/absolute/path/to/host.yml:/absolute/path/to/compose.existing.yml \
AIRHOP_SKIP_IMAGE_BUILD=1 \
./scripts/bootstrap-airhop-hermes.sh
```

The relay accepts a Telegram token only through the owner/admin write-only
self-service endpoint, verifies it, and stores AES-256-GCM ciphertext. The
encryption/index keys stay in deployment secrets outside Postgres. The
optional `telegram` Compose profile runs a separate pinned Hermes messaging
adapter and retrieves plaintext only as the exact configured connector through
the NIP-98 API documented in `docs/AIRHOP_HERMES_CHANNEL_GATEWAY_CONTRACT.md`.

Before enabling it, generate the credential index/encryption keys and one
gateway signing key, configure the derived public key on Relay, and register
that public key as an active workspace member. Start the hosted supervisor;
owners can then paste BotFather tokens in **Settings → Communication channels**
without another deployment:

```bash
AIRHOP_ENV_FILE=.env docker compose --profile telegram \
  --env-file deploy/airhop/.env -f deploy/airhop/compose.yml \
  up -d --build --wait telegram-gateway
```

Polling is the hosted multi-connection default. Webhook mode is reserved for
the legacy single-connection deployment because every bot needs an independently
routed webhook URL and secret.

## Local demo data

For an isolated development stack, seed a small center and current schedule in
the real Booking Core tables (the UI and HTTP API are not mocked):

```bash
AIRHOP_ENV_FILE=/absolute/path/to/.env ./scripts/seed-airhop-demo.sh
```

The script is idempotent and only owns rows with its reserved demo UUIDs. It is
not an HQ replacement and does not issue an owner enrollment code. Production
organizations and codes continue to use the signed operator contract above.
