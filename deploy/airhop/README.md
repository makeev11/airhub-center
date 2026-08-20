# AirHop Center demo deployment

This stack is isolated from inherited Buzz deployments by its Compose project
name, network, containers, and four named volumes. It runs the authoritative
Booking Core, PostgreSQL, Redis, MinIO, and the same React public booking flow
at `/booking`. The employee UI remains the native AirHop Center application and
connects to this relay via `RELAY_URL`.

## Prepare

1. Copy `.env.example` to `.env` on the server.
2. Replace every `CHANGE_ME` and set the real domain.
3. Put an HTTPS reverse proxy or Cloudflare Tunnel in front of
   `127.0.0.1:3300`; WebSocket upgrades must be preserved.
4. Point the desktop deployment configuration at the public `wss://` URL.

Validate without starting anything:

```bash
AIRHOP_ENV_FILE=.env docker compose --env-file deploy/airhop/.env \
  -f deploy/airhop/compose.yml config --quiet
```

Start or update:

```bash
AIRHOP_ENV_FILE=.env docker compose --env-file deploy/airhop/.env \
  -f deploy/airhop/compose.yml pull
AIRHOP_ENV_FILE=.env docker compose --env-file deploy/airhop/.env \
  -f deploy/airhop/compose.yml up -d --wait
```

Do not reuse the old `buzz-prod` database or volumes. A demo tenant and AirHop
organization must be provisioned deliberately; the real owner activation code
is then issued through the signed operator API described in
`docs/AIRHUB_CENTER_HQ_ACTIVATION_CONTRACT.md`.

## Local demo data

For an isolated development stack, seed a small center and current schedule in
the real Booking Core tables (the UI and HTTP API are not mocked):

```bash
AIRHOP_ENV_FILE=/absolute/path/to/.env ./scripts/seed-airhop-demo.sh
```

The script is idempotent and only owns rows with its reserved demo UUIDs. It is
not an HQ replacement and does not issue an owner enrollment code. Production
organizations and codes continue to use the signed operator contract above.
