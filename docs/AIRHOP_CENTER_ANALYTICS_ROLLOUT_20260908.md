# Center analytics: prepared demo/local update

Status: **superseded, not deployed**. Do not deploy this 0.5.5 archive or install
its app. The current candidate is prepared from one clean 0.5.6 commit using
[the unified release process](AIRHOP_CENTER_RELEASE.md). The record below is
historical. The source upload was rejected by
the execution safety check pending explicit user approval for the payload and
destination. No retry or alternate transfer was performed.

## Exact scope

- Server: `root@46.173.25.23`, existing Compose project `buzz-demo`, relay only.
- Public host: `demo.airhop.ru`.
- Desktop: local `/Applications/AirHop Center.app`, preserve the identifier
  `ru.airhop.centers.app`, OS keyring, accounts and existing application data.
- Production and adjacent storage/agent containers must not be restarted.
- Keep the current Hygge pilot and all existing hashed public assets. Overlay
  the newly built booking assets; do not replace the pilot with an older copy.

## Verified baseline (read-only)

- Demo image: `airhub-center-relay:analytics-20260907-879f9cda-hygge`.
- Demo digest: `sha256:4a7c892f03ff8faedc4f11a047f23e9ae6613de0a640bc341d2a96e974af618b`.
- Demo database schema: 53. New release needs additive index migration 0054.
- Production: `airhub-center-relay:3e36b1c`, started
  `2026-09-04T14:41:56.130823027Z`.
- Installed desktop binary SHA-256:
  `9b5dcdabfb59dec6cedb509bb6bf444c0408fec4b69c19463cfb02c77e4814ec`.

## Prepared artifacts

Local directory: `/private/tmp/airhop-center-rollout.vCMjHi`.

- `source.tgz`: 3,241 source files selected from tracked/nonignored paths;
  `.env*`, key/certificate files, databases, build outputs, dependency directories
  and secrets directories excluded. SHA-256:
  `575a301f04cd10f632e7d8e4589a304d5896e21863c5942794c5583256ac34d5`.
- `source-manifest.json`: per-file hashes and base commit
  `3b02c58af8e061f49ab4ba0e0f7d1cd71919506c`. The archive contains the selected
  working-tree changes; the base commit alone is not its source identity.
- `public-web.tgz`: production same-origin public-booking build, SHA-256
  `ca50a28bc4380c9c0d0db7c5c804062160994a34815852991bc815e527f620ae`.
- `Dockerfile.center-analytics`: derives the demo runtime from the exact
  baseline digest, replaces freshly built relay/admin/pair binaries and overlays
  public assets. Rust build concurrency is capped at one job on the shared VPS.
- Intended image tag: `airhub-center-relay:center-analytics-20260908-575a301f`.
- Intended remote build directory:
  `/opt/airhop/relay-build-center-analytics-20260908-575a301f` (not created by the
  rejected command).

## Local verification completed

- Full `just ci` passed, including workspace/native checks and builds,
  4,475 desktop JavaScript tests and 1,138 mobile tests (one skipped).
  Log: `/private/tmp/airhop-center-rollout-ci.log`.
- Release sidecars and the production public-web build completed. All 3,241
  source-manifest entries were unchanged after the checks.
- Native release bundle completed with the default system-keyring feature:
  `desktop/src-tauri/target/release/bundle/macos/AirHop Center.app`.
  Identifier remains `ru.airhop.centers.app`; version remains `0.5.5`.
- Tauri's unsigned build retained linker-only signatures, which failed bundle
  verification. The generated sidecars and bundle were locally ad-hoc signed,
  using the repository's `Entitlements.plist` for the bundle. Final
  `codesign --verify --deep --strict` passed. This is a local test build,
  not a notarized public release or an updater publication.
- Final generated main executable SHA-256:
  `e391070d59584b3e1ec37791d3a47355516000d65c691d6272d0188f27401d2f`.
- Final generated Analyst/MCP executable SHA-256:
  `22ea1a53a67503d4b6102e7b3a2edb20ec3c679520b8b7b7689e90af6d49a43a`.
- Installed app hash still matches the baseline above. No account/keychain
  changes, installation, server upload or deployment were performed.

## Required sequence after upload approval

1. Recheck baseline and available disk space; verify source/asset checksums.
2. Build the immutable image without restarting services.
3. Back up demo DB/config, restore the DB into a separate preflight database,
   and validate migration 0054 there. Do not restore over the live database.
4. Update only demo relay with the complete existing Compose overlay chain.
   Retain an explicit rollback override with `BUZZ_AUTO_MIGRATE=false` for the
   previous SQLx binary, which does not recognize migration 54.
5. Verify schema, health, public booking, retained pilot/assets, unauthenticated
   report denial and authorized Center reports. Verify production and neighbors
   are unchanged. Do not create bookings or financial transactions for this check.
6. Back up the installed app bundle and replace it only after the server passes.
   Native smoke: existing account/history, sidebar collapse, yesterday report,
   role-scoped Analyst tool. If macOS requests keychain access, the user must
   approve the system dialog; do not automate it or alter keychain ACLs.

Do not install the new client against the old report API: it intentionally fails
closed rather than substituting demo data for the new Center report.
