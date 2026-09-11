# WhatsApp own Meta app onboarding — implementation plan

Status on 2026-09-11: slices A, B, and C are implemented. Slice D credential
rotation is implemented and verified locally. The Meta application is published;
real-number inbound, Hermes outbound, and staff outbound acceptance passed. The
self-`p`-tag routing defect is fixed, DB-tested, deployed, and live-tested on the
demo Center. Production ingress, live credential rotation, billing,
closed-window acceptance, and template lifecycle remain release gates. A live
Meta outage/retry exercise covers restart recovery and inbound deduplication.
Credential intake stays disabled unless a public hosted adapter callback prefix
is explicitly configured.

## Live infrastructure checkpoint — 2026-09-11

The first real center-owned Meta connection is provisioned and reports
`ready` in AirHop Center:

- Meta accepted the callback verification request;
- the `whatsapp_business_account.messages` webhook field is subscribed;
- AirHop completed the WABA app subscription;
- the hosted adapter reports a fresh heartbeat and the Center card shows
  `Работает`.

Meta publication was completed in the live developer dashboard on 2026-09-11.
The application now shows **Published** and is available for public use. Before
publication, the following public pt-BR legal pages were deployed, independently
checked for HTTP 200, installed in Basic Settings, and saved successfully:

- `https://airhop.com.br/privacidade`;
- `https://airhop.com.br/termos`;
- `https://airhop.com.br/exclusao-de-dados`.

The live **Required actions** page reports that no actions are required. App
category and icon still need a product-owner review, and temporary ingress hosts
remain in App Domains until the webhook cutover; neither prevented publication.

The WhatsApp setup page confirms that the Brazilian number is registered and
its WABA webhook subscription is enabled. Billing is still absent: Meta offers
the **Add payment method** action and states that it is required for
business-initiated messages. Business verification has not been started; Meta
currently labels it optional but recommended and requires documents carrying
the legal business name. Do not guess the registration country or submit legal
documents without the owner choosing the correct company identity.

The working public route is intentionally temporary:

```text
Meta
  -> https://airhop-center.srv1610606.hstgr.cloud/webhooks/whatsapp/{connection_id}
  -> exact-path reverse proxy on the existing Hostinger VPS in Lithuania
  -> https://demo.airhop.ru/webhooks/whatsapp/{connection_id}
  -> hosted WhatsApp adapter
```

Do not remove this exact-path proxy until the Brazilian replacement has passed
the real inbound and reply acceptance test. It exposes only the current opaque
callback path; it is not a wildcard proxy.

Observed evidence:

- Meta rejected the direct `demo.airhop.ru` callback before any request reached
  the application;
- the same callback verification reached the unchanged adapter through
  Hostinger and returned HTTP 200;
- a dashboard-generated `messages` POST also reached the adapter with valid
  Meta HMAC headers. It is expected to be rejected as `connection mismatch`
  because Meta's dashboard sample contains a synthetic Phone Number ID instead
  of the connection's real Phone Number ID.
- after publication, a real WhatsApp message reached the AirHop Center client
  inbox and its `#parents` thread; Hermes replied automatically and that reply
  arrived in the originating WhatsApp chat;
- the first staff reply was not visible in WhatsApp after an initial eight-second
  observation, but later evidence showed it was not lost: its outbox row was
  delivered after about 92 seconds. Do not cite that early observation as proof
  of a routing failure;
- a separate real defect was found in the production-shaped thread-reply path:
  the conventional author `p` tag could be misclassified as a third-party mention
  and suppress the external outbox row. The rule is fixed and covered by unit and
  PostgreSQL integration tests;
- the combined source SHA `ef4b6b21bee454cad35343dd037a9a6eeec2ea50` was
  deployed to the demo Relay as image
  `sha256:821747c7dc483c17b00302cb3b526b9a6a776354c5a6bd9c6e044e71f3c3ae3f`.
  Migration 69 was preflighted on a restored database copy before live apply;
  the Channel Gateway and Hermes containers were not restarted;
- after that deployment, a new staff reply was delivered to the originating
  native WhatsApp chat in about two seconds, with a `staff / delivered` outbox
  row and no error code. This closes the real-number staff-outbound gate on the
  current temporary ingress;
- a live retry test held the gateway offline long enough for the temporary
  ingress to return HTTP 502 to Meta several times. The gateway restarted at
  `2026-09-11 23:30:42 UTC`; Meta retried successfully at
  `2026-09-11 23:35:23 UTC`. The unique test message `--20260911-2029` produced
  exactly one inbound receipt and one AirHop event (`1|1`), closing the
  restart/retry and inbound-deduplication gate.

This isolates the original failure to the public endpoint/address path rather
than the AirHop webhook implementation. It does not prove which undisclosed
Meta network or risk rule rejected the old endpoint.

### Resume here: Brazilian production ingress

Deployment artifacts and the single-supervisor cutover runbook now live in
`deploy/airhop/whatsapp-edge/`. They are ready for validation on a clean VPS;
provisioning the Brazilian host and changing DNS remain external actions. The
included `preflight.sh` fences the expected VPS address, public TLS/health, and
closed unknown paths without ever sending the Meta Verify Token; its current
expected result is a DNS mismatch until the `hooks` record is created.

The bundle now also includes an Ubuntu 24.04/Docker bootstrap, checksum-verified
gateway-image transport, guarded state-volume backup/restore, and a disposable
state-transfer self-test. The self-test passed on the live host with the accepted
gateway image, including content, `10001:10001` ownership, and refusal of a
non-empty restore target. The accepted image was exported without stopping the
gateway to
`/opt/airhop/backups/whatsapp-edge-ba9434e6b970/channel-gateway-image.tar.gz`:

```text
archive_size=150239003
archive_sha256=879343f9b9eafaec5d70c357b47ac4a5524d5cce21cd14fee3c61fbb1263869f
image_id=sha256:9b433fe2e7cc85b88d7147b2aeb8280aef6c0cbf98fd971a8a60394edd395032
```

The checksum and same-host load test passed and reproduced the exact image ID.
The edge Compose renders with the intended CPU, memory, and PID limits. Its
multi-architecture Caddy `2.11.4-alpine` image is pinned to
`sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648`;
the pinned image was pulled and returned `Valid configuration` for the bundled
Caddyfile.
The final state-volume backup is intentionally not taken yet: it must happen
after the old single supervisor stops during the actual cutover window.

1. Provision a Hostinger VPS in the Brazil/Sao Paulo location. The existing
   Hostinger VPS used by the bridge is in Lithuania, not Brazil. The Chrome
   Hostinger session was logged out at the latest audit, so no plan was bought
   or changed. For the edge-only deployment, select the smallest KVM 1 plan and
   plain Ubuntu 24.04. The accepted demo gateway's low-traffic snapshot was
   2.5% CPU, 77.27 MiB RAM, and 164 KiB state; Hostinger currently documents
   KVM 1 as 1 vCPU, 4 GB RAM, and 50 GB disk. This recommendation does not cover
   moving Relay, Postgres, Redis, or Hermes.
2. Point `hooks.airhop.com.br` at the Brazilian VPS and issue normal public TLS.
   The authoritative nameservers are currently GoDaddy
   (`ns71.domaincontrol.com` / `ns72.domaincontrol.com`) and the `hooks` name has
   no A, AAAA, or CNAME record yet; make this DNS change in GoDaddy, not the
   empty Cloudflare account that happened to be open in the browser.
3. Deploy the WhatsApp webhook ingress and preferably the hosted WhatsApp
   gateway there. Keep the connection-scoped callback paths and raw-body HMAC
   verification unchanged.
4. Change the hosted callback prefix to `https://hooks.airhop.com.br`, update
   the callback in Meta, and re-run verification without creating a duplicate
   AirHop connection.
5. Complete any required business verification and configure billing. The Meta
   application and legal URLs are already published. Choose the app category and
   icon after product-owner review, and remove obsolete temporary App Domains
   only after the webhook cutover.
6. Rotate the App Secret, System User Token, and Verify Token used during this
   assisted setup before production acceptance.
7. Finish the remaining Slice D real-number cases. Inbound, Hermes reply,
   post-fix staff reply, gateway restart/Meta retry, and inbound deduplication
   have passed. Still cover the closed 24-hour service window and approved
   message-template lifecycle.
8. After successful cutover, remove the Lithuania exact-path bridge and the
   temporary `sslip.io` callback alias from the old ingress.

Moving the Brazilian relay and database is a separate residency and operations
decision. It is not required for Meta callback reachability, but should be
evaluated before storing Brazilian production customer conversations at scale.

## Outcome

An AirHop owner can connect a WhatsApp Cloud API number owned by the center's
own Meta app. The setup is guided from Center, secrets cross one authenticated
request, Relay encrypts them, and the hosted WhatsApp connector owns webhook
and Graph API traffic. This path does not depend on AirHop Embedded Signup or
access to another business's WABA.

The canonical operator guide is
[`docs/AIRHOP_WHATSAPP_OWN_META_APP_SETUP.md`](../../AIRHOP_WHATSAPP_OWN_META_APP_SETUP.md).

## Product states

1. `not_started`: show prerequisites and the complete setup guide.
2. `credentials_required`: collect App ID, App Secret, WABA ID, Phone Number ID,
   and a System User Token in password fields.
3. `webhook_required`: show the connection-specific Callback URL and the
   one-time Verify Token.
4. `connecting`: Meta accepted the webhook but the connector has not reported a
   healthy heartbeat.
5. `ready`: the connector has verified credentials, webhook delivery, and Graph
   send capability.
6. `degraded`: retain the connection and show one safe error code; never expose
   Meta responses containing tokens.

`ready` is derived from connector observation, never from successful form
submission.

## Delivery slices

### Slice A — guide and Center flow

- Add Telegram/WhatsApp provider choice to Communication Channels.
- Embed the same sequence as the canonical guide in a WhatsApp setup dialog.
- Link only to official Meta surfaces.
- Keep routing selection in the setup flow.
- Never persist form secrets in localStorage, query strings, logs, toast text,
  analytics, or React Query cache.

### Slice B — self-service provisioning contract

- Add an owner/admin-only `POST .../channel-connections/whatsapp-cloud`.
- Validate the System User Token by listing the selected WABA's phone numbers.
- Require an exact Phone Number ID match.
- Encrypt one versioned credential envelope containing App ID, App Secret,
  WABA ID, Phone Number ID, Verify Token, and access token.
- Fingerprint the App ID and add a separate Phone Number ID uniqueness fence so
  neither an app-scoped callback nor a phone can be connected twice to one
  organization.
- Return Callback URL and Verify Token only in the creation response with
  `Cache-Control: no-store`.
- Add a finish action that subscribes the app to the WABA after Meta accepts the
  callback.

### Slice C — hosted WhatsApp Cloud adapter

Implemented in `integrations/hermes-airhop-channel-gateway`: one hosted gateway
per Center starts an isolated runtime and SQLite state file for each assigned
connection, while one public HTTP server routes connection-scoped callbacks.

- Use the same exact connector principal and Gateway route/inbox/outbox
  contracts as Telegram.
- Accept Meta webhooks only on connection-scoped opaque URLs.
- Verify `X-Hub-Signature-256` against that connection's App Secret before JSON
  parsing or acknowledgement.
- Durably spool inbound messages before returning HTTP 200.
- Normalize supported text into the existing kind-9 external conversation
  protocol; produce a visible unsupported-attachment notice for the first
  release.
- Send outbox text through `/{phone-number-id}/messages`, enforce the 24-hour
  service window, and fail explicitly when a template is required.
- Report `connecting`, `ready`, `degraded`, and `offline` through the existing
  heartbeat endpoint.

### Slice D — lifecycle and production acceptance

- Implemented: rotate App Secret, System User Token, and Verify Token on the
  existing connection without moving conversations. Credential revisions
  restart only the affected runtime and require fresh webhook verification.
- Pause, resume, and disable without losing routing.
- Support multiple WhatsApp numbers per organization and per branch. The first
  release requires one customer-owned Meta application per number because the
  callback is application-scoped.
- Add template synchronization and explicit template sends.
- Exercise a real Meta number for inbound, staff reply, Hermes reply, retry,
  token rotation, webhook replay, closed service window, and disconnect.

## Security invariants

- Official `whatsapp_cloud` only; no WhatsApp Web/QR automation.
- Parsed App Secret/access-token buffers are zeroized where the runtime permits;
  raw request bodies are never logged or persisted, and credentials are
  encrypted before database persistence.
- Only the exact configured connector principal can retrieve plaintext.
- Connection list, logs, errors, telemetry, screenshots, and exports remain
  credential-free.
- Callback verification uses a generated high-entropy token; provider POSTs use
  the raw-body HMAC signature, not the verify token.
- A callback path or Phone Number ID alone never authorizes inbound ingestion.

## Release gates

- Desktop typecheck, lint, file-size and text-size guards pass.
- Relay unit tests cover strict body parsing, bounds, safe Meta error mapping,
  encryption AAD, and one-time response headers.
- DB tests cover provider validation, duplicate phone fencing, and ciphertext
  bounds.
- Connector tests cover raw-body signature verification, duplicate webhook
  delivery, restart-safe spool, route fencing, Graph retry classification, and
  service-window rejection.
- A production-like E2E confirms a real inbound message and a reply from AirHop
  before the feature is advertised as available.
