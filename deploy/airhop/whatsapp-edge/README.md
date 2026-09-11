# Brazilian WhatsApp ingress and Channel Gateway

This deployment moves the public Meta webhook and the provider Channel Gateway
to a Brazilian VPS while the authoritative Center Relay may remain on its
current host. The gateway talks to Relay over authenticated HTTPS and keeps all
provider credentials out of this Compose file.

The service is a **Channel Gateway**, not a WhatsApp-only worker. Its supervisor
claims every active Telegram and WhatsApp assignment for the Center. Exactly one
supervisor may run for a connector identity. Running the old and Brazilian
gateways at the same time can duplicate Telegram polling and race outbox work.

## Prerequisites

- a Hostinger VPS created in the Brazil/Sao Paulo location;
- TCP 80 and 443 open to the internet, with SSH restricted separately;
- `hooks.airhop.com.br` A/AAAA records pointing only to the Brazilian VPS;
- an immutable, accepted Channel Gateway image with recorded source provenance
  and compatibility with the deployed Relay;
- the existing connector secret whose public key is configured on Relay and is
  an active workspace member;
- an encrypted backup of the old gateway state volume.

Do not put Meta App Secret, System User Token, Verify Token, or phone identifiers
in this environment. The gateway retrieves connection-scoped credentials from
Relay after NIP-98 authentication.

## Initial Hostinger VPS selection

For this edge-only topology, start with the smallest **KVM 1** plan in the
**Brazil** location and select plain **Ubuntu 24.04**, without a hosting control
panel. As checked on 2026-09-11, Hostinger documents KVM 1 as 1 vCPU, 4 GB RAM,
50 GB disk, and 4 TB bandwidth; Brazil is an offered Linux VPS location when
capacity is available, and Ubuntu 24.04 is an offered plain OS template:

- [Hostinger VPS plan limits](https://support.hostinger.com/pt/articles/6976044-parametros-e-limites-dos-planos-de-hospedagem)
- [Hostinger server locations](https://support.hostinger.com/pt/articles/1583267-onde-estao-localizados-os-servidores-da-hostinger)
- [Hostinger VPS operating systems](https://support.hostinger.com/pt/articles/1583571-quais-sao-os-sistemas-operacionais-disponiveis-para-vps)

This size is based on the accepted demo gateway's low-traffic snapshot, not a
synthetic load test: 2.5% CPU, 77.27 MiB resident memory, and 164 KiB of gateway
state. KVM 1 therefore leaves substantial headroom for Caddy, Docker, OS
updates, log rotation, and state growth. Monitor the new VPS after cutover and
scale vertically if real traffic changes the profile. Do not use this sizing to
justify moving Relay, Postgres, Redis, Hermes, or other workloads onto the edge.

## Prepare without changing traffic

On a new plain Ubuntu 24.04 VPS, copy this directory first and run
`bootstrap-host.sh` as root. It verifies the OS, validates the official Docker
repository signing-key fingerprint, installs Docker Engine plus Compose, and
creates the `/opt/airhop` directories. It deliberately does not change the
firewall, SSH configuration, or user accounts.

In Hostinger's firewall, allow public TCP 80 and 443, keep TCP 8443 closed, and
restrict the SSH port to trusted operator addresses where practical. Outbound
HTTPS, DNS, and time synchronization must remain available. Then copy this
directory to `/opt/airhop/whatsapp-edge`, create `.env` from `.env.example`, and
enter the connector key in an interactive server session. Never print the
rendered Compose configuration because it contains the connector key.

The currently accepted live gateway checkpoint is:

```text
image_ref=airhop-hermes-channel-gateway:whatsapp-e2e-ba9434e6b970
image_id=sha256:9b433fe2e7cc85b88d7147b2aeb8280aef6c0cbf98fd971a8a60394edd395032
source_revision=ba9434e6b970a505dec2ef2bc8c045b6807a7a36
source_volume=buzz-demo_airhop-telegram-gateway-data
transfer_archive_sha256=879343f9b9eafaec5d70c357b47ac4a5524d5cce21cd14fee3c61fbb1263869f
```

The accepted 150,239,003-byte archive, checksum, and manifest are staged on the
current gateway host under
`/opt/airhop/backups/whatsapp-edge-ba9434e6b970/`. The archive checksum and a
same-host load test both passed; loading it reproduced the accepted image ID.

If that image is not published to an authenticated registry, move the exact
accepted local image without rebuilding it. On the old host:

```bash
./image-transfer.sh export \
  airhop-hermes-channel-gateway:whatsapp-e2e-ba9434e6b970 \
  /opt/airhop/backups/channel-gateway-image.tar.gz
```

Copy the archive, adjacent `.sha256`, and `.manifest` files to the Brazilian
VPS over the approved SSH path. Then load it there:

```bash
./image-transfer.sh load \
  /opt/airhop/backups/channel-gateway-image.tar.gz \
  airhop-hermes-channel-gateway:whatsapp-e2e-ba9434e6b970
```

Use the imported tag in `AIRHOP_CHANNEL_GATEWAY_IMAGE`. Do not rebuild during
cutover: the image ID checked on the new host must equal the recorded accepted
image ID.

Validate the files without rendering secrets:

```bash
set -a
. ./.env
set +a
docker compose --env-file .env -f compose.yml config --quiet
docker image inspect "$AIRHOP_CHANNEL_GATEWAY_IMAGE" >/dev/null
docker compose --env-file .env -f compose.yml pull caddy
```

For the accepted offline-image path, do not run an unscoped `compose pull`: the
gateway tag is intentionally satisfied by the checksum-verified local import.

Do not start the service yet. Its SQLite files preserve deduplication, inbound
spooling, and WhatsApp's observed 24-hour service windows. During the cutover,
stop the old gateway and make the final consistent backup:

```bash
./state-transfer.sh backup \
  buzz-demo_airhop-telegram-gateway-data \
  /opt/airhop/backups/channel-gateway-state.tar.gz \
  airhop-hermes-channel-gateway:whatsapp-e2e-ba9434e6b970
```

Copy the state archive, adjacent `.sha256`, and `.manifest` files to Brazil.
After loading the gateway image and creating the new Compose resources without
starting them, restore only into the existing empty Compose volume:

```bash
docker compose --env-file .env -f compose.yml create
./state-transfer.sh restore \
  airhop-channel-edge-br_airhop-channel-gateway-state \
  /opt/airhop/backups/channel-gateway-state.tar.gz \
  airhop-hermes-channel-gateway:whatsapp-e2e-ba9434e6b970
```

The helper verifies the checksum, refuses a live source volume or a non-empty
target, and restores ownership as `10001:10001`.

Before the production window, validate the transfer helper against disposable
volumes on a host that already has the accepted gateway image:

```bash
./test-state-transfer.sh \
  airhop-hermes-channel-gateway:whatsapp-e2e-ba9434e6b970
```

The self-test creates uniquely named temporary volumes, proves file content and
UID/GID restoration, verifies refusal of a non-empty target, and cleans up only
its own disposable resources.

## Cut over the single active gateway

1. Pause deployment changes and outgoing operator actions for the Center.
2. Stop the old Channel Gateway gracefully. Leave Relay, Postgres, Redis,
   Hermes, and the temporary Hostinger callback bridge running.
3. Take the final gateway-volume backup and restore it on the Brazilian VPS.
   Do not reuse an earlier live copy: the final backup must be created after the
   old gateway stops so its SQLite and spool files form one consistent snapshot.
4. Start the Brazilian services:

   ```bash
   docker compose --env-file .env -f compose.yml up -d --wait
   set -a
   . ./.env
   set +a
   ./preflight.sh
   ```

   Set `AIRHOP_EXPECTED_PUBLIC_IP` in `.env` before this check. The preflight
   proves that public DNS includes that address, TLS and `/healthz` work, and
   both the public root and an unknown connection-scoped callback stay closed
   with HTTP 404. It never sends or prints a Verify Token.

5. Confirm a fresh gateway heartbeat in AirHop Center. If it does not appear,
   stop the Brazilian gateway and restore the old one; do not run both.
6. On Relay, set:

   ```text
   BUZZ_AIRHOP_WHATSAPP_WEBHOOK_BASE_URL=https://hooks.airhop.com.br/webhooks/whatsapp
   ```

   Restart only Relay and confirm readiness. This prefix is used for new
   connections; it does not silently rewrite an existing Meta callback.
7. In the existing Meta application, replace the Callback URL host with
   `hooks.airhop.com.br`, retaining the exact `/webhooks/whatsapp/{connectionId}`
   suffix. Use the existing connection's Verify Token and click **Verify and
   save**. Keep the `messages` field subscribed.
8. Confirm Meta's verification GET returns HTTP 200 and that the AirHop card
   remains `Работает`.

The Caddy configuration deliberately does not record access URLs because Meta
places the Verify Token in the verification query string. It exposes only
`/healthz` and `/webhooks/whatsapp/*`; every unknown connection is still rejected
by the gateway router, and every POST requires the raw-body Meta HMAC signature.

## Production acceptance

The Meta dashboard's sample `messages` event uses a synthetic Phone Number ID.
AirHop correctly rejects it as a connection mismatch, so it is not a real E2E
test. Production acceptance requires an actual second WhatsApp number:

1. publish the Meta application and complete any requested business review;
2. configure Meta billing and confirm the real number is active;
3. rotate credentials used during assisted setup through the supported AirHop
   credential-update flow;
4. send an inbound message from a different WhatsApp number;
5. verify it appears once in the intended AirHop client channel;
6. reply from a staff account and from Hermes inside the 24-hour window;
7. restart the Brazilian gateway and confirm no duplicate inbound delivery;
8. test and surface the template-required result after the service window.

Only after these checks pass should the Lithuania exact-path bridge and old
temporary callback aliases be removed.

## Rollback boundary

Before Meta's Callback URL is changed, rollback is simply: stop the Brazilian
gateway, restore the state volume to the old host, and restart the old gateway.
After the Callback URL is changed, restore the previous URL in Meta as well.
Never delete the AirHop connection during infrastructure rollback; doing so can
detach routing from the existing conversation history.
