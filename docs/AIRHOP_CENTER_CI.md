# AirHop Center CI

The required desktop CI jobs exercise the AirHop Center product routes. Center
replaces the upstream Buzz agent-management screen with a four-role team and
redirects excluded routes (projects, mesh, harness management) to the schedule.
Tests expecting those upstream screens do not describe the shipped product.

## Required checks

- `airhop-center`: scheduling, public booking, client records, lesson attendance,
  Russian settings, team controls, shared messaging, and relay connectivity.
  Booking tests use an isolated demo repository and explicitly select Russian.
- `airhop-center-relay`: message persistence, two-employee real-time delivery,
  channel isolation, and channel creation against the CI PostgreSQL/Redis relay.
  These tests do not contact a production organization.
- Existing Rust, desktop JavaScript, Tauri, backend integration, relay protocol,
  security, and platform build jobs remain required.

The JSON Playwright reporter supplies the flaky-test summary and failure
artifacts; a failed product test still fails the Desktop/Integration gates.

Run `pnpm -C desktop test:e2e:airhop` locally. For relay tests, first start an
isolated test relay and run `scripts/setup-desktop-test-data.sh`, then run
`pnpm -C desktop test:e2e:airhop-relay`. Never seed the production relay.

Playwright starts its own server bound to `127.0.0.1` and refuses to reuse an
existing listener, so another checkout's preview cannot supply the tested app.
If port 4173 is occupied, set `AIRHOP_E2E_PORT` to a free port (for example 4187).

## Additional audits and release checks

The inherited `smoke` and `integration` Playwright projects remain available for
explicit upstream compatibility audits. They are not release gates for Center:
their legacy agent, onboarding, project, and feature-preview assumptions must
be ported before their results can describe this product.

The browser suite mocks native IPC; a passing run alone does not prove native
agent spawning, HQ activation, or publication on a customer's VPS. The native
welcome/team scenario is `pnpm -C desktop test:e2e:tauri`; HQ activation and the
content deployment path require their own contract tests and a controlled live
acceptance run. macOS compilation in CI uses sidecar placeholders and is not a
substitute for testing the actual release bundle with its bundled executables.
