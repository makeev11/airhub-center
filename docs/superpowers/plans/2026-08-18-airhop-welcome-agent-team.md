# Airhop Welcome Agent Team Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic Welcome trio and kickoff thread with Airhop's localized four-agent product team, a flat one-responder Welcome conversation, authoritative Booking Core context, and preview/✅ specialist actions.

**Architecture:** The desktop provisions stable product personas and registers the private Welcome channel plus exact agent pubkeys with the relay. Every product ACP instance subscribes to unmentioned messages only in that registered channel, but a tenant-scoped relay router atomically assigns each human event to one agent before a model turn starts; outside Welcome the existing mention/thread path is unchanged. A role-aware `airhop-agent-mcp` personality supplies top-level messaging, read models, delegation, and specialist-only action preparation; relay-signed action cards commit through the existing single-transaction reaction path.

**Tech Stack:** Rust, Axum, SQLx/PostgreSQL, Nostr events, Buzz ACP, rmcp, Tauri 2, React 19, TypeScript 6, Node test runner, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-18-airhop-welcome-agent-team-design.md`

## Global Constraints

- Welcome opens automatically after owner claim and remains a private owner-plus-agents channel.
- Invited employees do not receive or provision this owner Welcome experience in this slice.
- Welcome messages are top-level events with no NIP-10 thread tags.
- Outside Welcome a new task still requires `@agent`; subsequent work stays in the source thread.
- Exactly one agent receives each human Welcome event; route creation is atomic and replay-safe.
- Физ/Fizz coordinates and delegates but has no Booking Core mutation capability.
- Administrator owns operational setup and administration; Analyst owns authoritative analytics; Content Marketer owns content discussion but has no site-publishing tool in this slice.
- Hermes is not provisioned into Welcome and is not referenced by any Welcome runtime manifest.
- Facts come from Welcome history and authoritative Booking Core read models; do not create an extracted organization brief or shared knowledge-base table.
- Mutations require a relay-signed preview card and a human `✅`; stale, fake, replayed, expired, or agent-authored confirmations do not mutate state.
- Locale controls names, roles, prompts, kickoff, normal replies, preview/errors, dates, time, and money. Russian starts with friendly «вы»; direct user language changes are respected.
- One message carries one thought; a turn may send two or three short messages; queued kickoff stages stop when the owner starts replying.
- No checklist, progress percentage, or terminal onboarding state is introduced.
- All four product instances keep Buzz `respond_to=owner-only`; trusted targeted kickoff and Fizz handoff events use the separate registered-agent path, not a broader author allowlist.
- Every commit uses `git commit -s`; activate Hermit before Git, hooks, Rust, Node, or Playwright commands.

## File and Interface Map

### Product identity and provisioning

- `desktop/src-tauri/src/managed_agents/personas.rs` owns stable built-in persona IDs and role prompts.
- `desktop/src-tauri/src/managed_agents/teams.rs` owns the built-in Airhop Welcome team seed and pristine legacy-team migration.
- `desktop/src/features/onboarding/welcomeTeamLocale.ts` owns locale resolution, display names, aliases, failure copy, and semantic kickoff instructions.
- `desktop/src/features/onboarding/welcomeGuide.ts` provisions four relay-scoped instances, reconciles role env, and removes obsolete Welcome-only agents.
- `desktop/src/features/onboarding/welcomeTeamRegistration.ts` signs the owner registration request for the relay.

### Relay routing and state

- `migrations/0042_airhop_welcome_agent_team.sql` stores the tenant-scoped Welcome manifest, route decisions, conversation state, kickoff stage receipts, and pending actions.
- `crates/buzz-db/src/airhop/welcome_agents.rs` owns manifest registration, route selection/claim, turn-state updates, and kickoff receipts.
- `crates/buzz-relay/src/api/airhop_agents.rs` exposes signed owner/agent endpoints without weakening existing staff API admission.
- `crates/buzz-relay/src/router.rs` mounts those endpoints.
- `crates/buzz-acp/src/airhop.rs` performs the pre-queue route gate and recognizes the flat Welcome channel.
- `crates/buzz-acp/src/config.rs`, `relay.rs`, `pool.rs`, and `queue.rs` carry the registered-channel subscription, flat reply mode, and recent channel history.

### Model-driven kickoff and role tools

- `crates/buzz-core/src/kind.rs` defines one ephemeral owner-to-agent task kind for kickoff stages.
- `desktop/src-tauri/src/commands/messages.rs` signs and publishes a kickoff task without placing it in the visible timeline.
- `desktop/src/features/onboarding/welcomeKickoff.ts` becomes a durable semantic stage orchestrator.
- `crates/buzz-dev-mcp/src/airhop.rs` implements the role-aware `airhop-agent-mcp` personality.
- `crates/buzz-dev-mcp/src/lib.rs` dispatches the additional multicall personality.
- `crates/sprig/src/main.rs`, `scripts/build-sprig.sh`, `scripts/bundle-sidecars.sh`, `justfile`, and Tauri configs package the personality.

### Booking Core bridge and confirmation

- `crates/buzz-db/src/airhop/agent_actions.rs` owns typed setup commands, previews, pending action persistence, optimistic validation, commit, and audit attribution.
- `crates/buzz-relay/src/airhop_agent_actions.rs` publishes retry-stable relay-signed preview cards.
- `crates/buzz-db/src/event.rs` recognizes trusted `airhop-action` cards in the existing atomic reaction transaction.
- `desktop/src/features/booking/actions/airhopActionSchemas.ts` generalizes the actor surface for the workspace/demo adapter without becoming production authority.

### Verification

- Rust unit tests live beside each module.
- Relay/database integration coverage extends `crates/buzz-test-client/tests/e2e_airhop_welcome_agents.rs`.
- Desktop behavior extends `desktop/src/features/onboarding/*.test.mjs` and `desktop/src/testing/e2eBridge.ts`.
- Real app coverage lives in `desktop/tests/e2e/airhop-welcome-agent-team.spec.ts` and must run against Tauri, not a browser-only mock, for final readiness.

---

### Task 1: Seed Airhop Product Personas and Locale Contract

**Files:**
- Modify: `desktop/src-tauri/src/managed_agents/personas.rs`
- Modify: `desktop/src-tauri/src/managed_agents/personas/tests.rs`
- Modify: `desktop/src-tauri/src/managed_agents/teams.rs`
- Modify: `desktop/src-tauri/src/managed_agents/teams_tests.rs`
- Create: `desktop/src/features/onboarding/welcomeTeamLocale.ts`
- Create: `desktop/src/features/onboarding/welcomeTeamLocale.test.mjs`

**Interfaces:**
- Produces: `AirhopWelcomeRole = "fizz" | "administrator" | "analyst" | "content_marketer"`.
- Produces: stable persona IDs `builtin:airhop-fizz`, `builtin:airhop-administrator`, `builtin:airhop-analyst`, and `builtin:airhop-content-marketer`.
- Produces: `resolveWelcomeLocale(locale): WelcomeLocalePack` and `welcomeRoleDefinition(role, locale)`.
- Consumes: organization BCP-47 locale; no localStorage language source.

- [ ] **Step 1: Add failing Rust seed and migration tests**

Assert exact ordered membership and that a pristine legacy `Fizz/Honey/Bumble` seed upgrades while a user-customized team remains untouched:

```rust
assert_eq!(
    welcome.persona_ids,
    vec![
        "builtin:airhop-fizz",
        "builtin:airhop-administrator",
        "builtin:airhop-analyst",
        "builtin:airhop-content-marketer",
    ]
);
assert_eq!(upgraded.name, "Airhop Team");
assert_eq!(customized.persona_ids, vec!["custom:owner-agent"]);
```

- [ ] **Step 2: Run the focused Rust tests and observe RED**

Run:

```bash
. ./bin/activate-hermit
cargo test --manifest-path desktop/src-tauri/Cargo.toml managed_agents::personas::tests
cargo test --manifest-path desktop/src-tauri/Cargo.toml managed_agents::teams_tests
```

Expected: FAIL because the four product IDs and pristine legacy migration do not exist.

- [ ] **Step 3: Add failing locale-pack tests**

Cover Russian, English, Portuguese, unknown-locale fallback, aliases, and concise failure copy:

```js
assert.deepEqual(resolveWelcomeLocale("ru-RU").names, {
  fizz: "Физ",
  administrator: "Администратор",
  analyst: "Аналитик",
  content_marketer: "Контент-маркетолог",
});
assert.equal(resolveWelcomeLocale("en-US").names.fizz, "Fizz");
assert.equal(resolveWelcomeLocale("pt-BR").names.administrator, "Administrador");
assert.equal(resolveWelcomeLocale("de-DE").language, "en");
assert.ok(resolveWelcomeLocale("ru-RU").providerRequired.length < 180);
```

Run:

```bash
cd desktop
node --import ./test-loader.mjs --experimental-strip-types --test src/features/onboarding/welcomeTeamLocale.test.mjs
```

Expected: FAIL because the module does not exist.

- [ ] **Step 4: Implement the product seeds and exhaustive locale pack**

Use stable role definitions rather than localized identity keys:

```ts
export type AirhopWelcomeRole =
  | "fizz"
  | "administrator"
  | "analyst"
  | "content_marketer";

export type WelcomeLocalePack = Readonly<{
  language: "ru" | "en" | "pt";
  names: Record<AirhopWelcomeRole, string>;
  roleLabels: Record<AirhopWelcomeRole, string>;
  aliases: Record<AirhopWelcomeRole, readonly string[]>;
  providerRequired: string;
  specialistUnavailable: (role: AirhopWelcomeRole) => string;
  kickoffInstruction: (stage: WelcomeKickoffStage, ownerName?: string) => string;
}>;
```

Prompts must state each role's domain, the short-message contract, locale mirroring, Booking Core authority, and explicit exclusions. The Fizz prompt must say that it cannot prepare or commit mutations. Content Marketer must say that publishing is unavailable.

- [ ] **Step 5: Re-run focused tests and commit**

Run:

```bash
. ./bin/activate-hermit
cargo test --manifest-path desktop/src-tauri/Cargo.toml managed_agents::personas::tests
cargo test --manifest-path desktop/src-tauri/Cargo.toml managed_agents::teams_tests
cd desktop
node --import ./test-loader.mjs --experimental-strip-types --test src/features/onboarding/welcomeTeamLocale.test.mjs
cd ..
git add desktop/src-tauri/src/managed_agents/personas.rs desktop/src-tauri/src/managed_agents/personas/tests.rs desktop/src-tauri/src/managed_agents/teams.rs desktop/src-tauri/src/managed_agents/teams_tests.rs desktop/src/features/onboarding/welcomeTeamLocale.ts desktop/src/features/onboarding/welcomeTeamLocale.test.mjs
git commit -s -m "feat(airhop): define localized product agent team"
```

Expected: all focused tests PASS.

---

### Task 2: Persist the Welcome Team Manifest on the Relay

**Files:**
- Create: `migrations/0042_airhop_welcome_agent_team.sql`
- Create: `crates/buzz-db/src/airhop/welcome_agents.rs`
- Modify: `crates/buzz-db/src/airhop.rs`
- Create: `crates/buzz-relay/src/api/airhop_agents.rs`
- Modify: `crates/buzz-relay/src/api/mod.rs`
- Modify: `crates/buzz-relay/src/router.rs`

**Interfaces:**
- Consumes: stable persona IDs and `AirhopWelcomeRole` from Task 1 at the desktop boundary.
- Produces: `PutWelcomeTeamInput`, `AirhopWelcomeTeam`, and `Db::put_airhop_welcome_team`.
- Produces: `PUT /api/airhop/agents/v1/welcome-team` and `GET /api/airhop/agents/v1/welcome-team`.
- Invariant: only the claimed community owner may register; all four pubkeys must be active bot members of the same private stream.

- [ ] **Step 1: Write the migration and failing database tests**

Create tenant-scoped tables with explicit keys:

```sql
CREATE TABLE airhop_welcome_teams (
    community_id UUID PRIMARY KEY,
    organization_id UUID NOT NULL,
    channel_id UUID NOT NULL,
    locale TEXT NOT NULL,
    fizz_pubkey BYTEA NOT NULL CHECK (octet_length(fizz_pubkey) = 32),
    administrator_pubkey BYTEA NOT NULL CHECK (octet_length(administrator_pubkey) = 32),
    analyst_pubkey BYTEA NOT NULL CHECK (octet_length(analyst_pubkey) = 32),
    content_marketer_pubkey BYTEA NOT NULL CHECK (octet_length(content_marketer_pubkey) = 32),
    registered_by_pubkey BYTEA NOT NULL CHECK (octet_length(registered_by_pubkey) = 32),
    version BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL,
    UNIQUE (community_id, channel_id)
);
```

The same migration also creates the route/state/action tables specified in Tasks 5 and 8 so schema rollout remains one atomic migration.

- [ ] **Step 2: Add the DB contract and validation tests**

Define:

```rust
pub struct PutWelcomeTeamInput {
    pub organization_id: Uuid,
    pub channel_id: Uuid,
    pub locale: String,
    pub members: BTreeMap<AirhopWelcomeRole, [u8; 32]>,
    pub registered_by_pubkey: [u8; 32],
}

pub enum AirhopWelcomeRole {
    Fizz,
    Administrator,
    Analyst,
    ContentMarketer,
}
```

Tests prove tenant isolation, idempotent same-manifest replay, version increment on a changed pubkey, rejection of duplicate role pubkeys, non-private channels, and missing bot membership.

- [ ] **Step 3: Run DB tests and observe RED**

Run:

```bash
. ./bin/activate-hermit
cargo test -p buzz-db airhop::welcome_agents -- --nocapture
```

Expected: FAIL because the module and schema contract are absent.

- [ ] **Step 4: Implement owner-authenticated relay endpoints**

Factor the shared NIP-98/member lookup from `airhop_staff.rs` into `api/airhop_auth.rs` and return an authenticated principal:

```rust
pub(crate) struct AirhopPrincipal {
    pub tenant: TenantContext,
    pub pubkey: PublicKey,
    pub member_role: String,
}

pub(crate) async fn authenticate_airhop(
    state: &Arc<AppState>,
    headers: &HeaderMap,
    method: &str,
    path: &str,
    body: Option<&[u8]>,
) -> ApiResult<AirhopPrincipal>;
```

`PUT welcome-team` verifies the authenticated principal is the claimed community owner, then verifies organization identity, private stream metadata, and exact bot membership before calling the DB. An invited employee or non-owner admin is rejected. The response returns channel ID, locale, role/pubkey map, and version; it never returns agent secrets or auth tags.

- [ ] **Step 5: Run focused relay/DB tests and commit**

Run:

```bash
. ./bin/activate-hermit
cargo test -p buzz-db airhop::welcome_agents
cargo test -p buzz-relay airhop_agents
cargo fmt --all -- --check
git add migrations/0042_airhop_welcome_agent_team.sql crates/buzz-db/src/airhop.rs crates/buzz-db/src/airhop/welcome_agents.rs crates/buzz-relay/src/api/airhop_auth.rs crates/buzz-relay/src/api/airhop_agents.rs crates/buzz-relay/src/api/mod.rs crates/buzz-relay/src/router.rs
git commit -s -m "feat(airhop): register Welcome agent team"
```

Expected: focused tests PASS and route registration is tenant-safe.

---

### Task 3: Provision Four Localized Instances and Register Them

**Files:**
- Modify: `desktop/src/features/onboarding/welcomeGuide.ts`
- Modify: `desktop/src/features/onboarding/welcomeGuide.test.mjs`
- Create: `desktop/src/features/onboarding/welcomeTeamRegistration.ts`
- Create: `desktop/src/features/onboarding/welcomeTeamRegistration.test.mjs`
- Modify: `desktop/src/features/onboarding/hooks.ts`
- Create: `desktop/src/features/onboarding/hooks.test.mjs`
- Modify: `desktop/src/shared/api/tauriManagedAgents.ts`
- Modify: `desktop/src/testing/e2eBridge.ts`

**Interfaces:**
- Consumes: Task 1 persona/locale definitions and Task 2 registration endpoint.
- Produces: `WelcomeTeamAgents` keyed by `AirhopWelcomeRole`, not a tuple.
- Produces: role env `BUZZ_AIRHOP_ROLE`, `BUZZ_AIRHOP_WELCOME_CHANNEL_ID`, `BUZZ_ACP_FLAT_CHANNELS`, and `BUZZ_ACP_ROUTE_GATE=airhop`.
- Produces: `registerWelcomeTeam(input): Promise<RegisteredWelcomeTeam>`.

- [ ] **Step 1: Replace tuple assumptions with failing role-map tests**

Pin the desired manifest:

```js
assert.deepEqual(WELCOME_TEAM_STARTERS.map(({ role, personaId }) => [role, personaId]), [
  ["fizz", "builtin:airhop-fizz"],
  ["administrator", "builtin:airhop-administrator"],
  ["analyst", "builtin:airhop-analyst"],
  ["content_marketer", "builtin:airhop-content-marketer"],
]);
assert.ok(inputs.every((input) => input.respondTo === "owner-only"));
assert.ok(inputs.every((input) => input.respondToAllowlist.length === 0));
```

All four instances use `owner-only` and `mcpCommand: "airhop-agent-mcp"`. Trusted Fizz delegation reaches one specialist through its registered `p`-tagged handoff path; it must not broaden normal inbound author admission.

- [ ] **Step 2: Add failing registration and reconciliation tests**

Tests must show that provisioning:

```js
assert.deepEqual(registration.members, {
  fizz: fizz.pubkey,
  administrator: administrator.pubkey,
  analyst: analyst.pubkey,
  content_marketer: content.pubkey,
});
assert.equal(registration.channelId, welcome.id);
assert.equal(registration.locale, "ru-RU");
assert.deepEqual(removedLegacyPubkeys, [oldHoney.pubkey, oldBumble.pubkey]);
```

A retry must reuse all four instances and repeat only the idempotent manifest PUT. Add an eligibility test proving the successful owner-claim/readiness path seeds and focuses Welcome, while an invited employee never calls `ensureWelcomeTeam` and receives the existing ordinary member entry path.

- [ ] **Step 3: Run the tests and observe RED**

Run:

```bash
cd desktop
node --import ./test-loader.mjs --experimental-strip-types --test src/features/onboarding/welcomeGuide.test.mjs src/features/onboarding/welcomeTeamRegistration.test.mjs src/features/onboarding/hooks.test.mjs
```

Expected: FAIL because provisioning still assumes three generic agents and no server manifest.

- [ ] **Step 4: Implement role-keyed provisioning and registration**

Use:

```ts
export type WelcomeTeamAgents = Readonly<Record<AirhopWelcomeRole, ManagedAgent>>;

export async function ensureWelcomeTeam(
  channelId: string,
  organization: { id: string; locale: string },
  ownerPubkey: string,
  relayUrl?: string | null,
): Promise<WelcomeTeamAgents>;
```

Reconcile localized instance names and exact role env on every run. Wire `initializeStarterChannels`/the onboarding readiness hook to authoritative community-owner membership: a successful owner claim starts or retries this sequence, including on restart, but employee onboarding skips it. Remove obsolete generic Welcome agents from this channel only after the new four are present and registered; do not delete user-created agents or generic personas. Start runtimes after registration and invalidate managed-agent queries once.

- [ ] **Step 5: Re-run tests and commit**

Run:

```bash
cd desktop
node --import ./test-loader.mjs --experimental-strip-types --test src/features/onboarding/welcomeGuide.test.mjs src/features/onboarding/welcomeTeamRegistration.test.mjs src/features/onboarding/hooks.test.mjs
pnpm typecheck
cd ..
git add desktop/src/features/onboarding/welcomeGuide.ts desktop/src/features/onboarding/welcomeGuide.test.mjs desktop/src/features/onboarding/welcomeTeamRegistration.ts desktop/src/features/onboarding/welcomeTeamRegistration.test.mjs desktop/src/features/onboarding/hooks.ts desktop/src/features/onboarding/hooks.test.mjs desktop/src/shared/api/tauriManagedAgents.ts desktop/src/testing/e2eBridge.ts
git commit -s -m "feat(airhop): provision product Welcome team"
```

Expected: role-map, locale, owner eligibility, employee exclusion, cleanup, retry, and type checks PASS.

---

### Task 4: Add Model-Driven Top-Level Kickoff Stages

**Files:**
- Modify: `crates/buzz-core/src/kind.rs`
- Modify: `desktop/src-tauri/src/commands/messages.rs`
- Modify: `desktop/src-tauri/src/lib.rs`
- Modify: `desktop/src/shared/api/tauri.ts`
- Rewrite: `desktop/src/features/onboarding/welcomeKickoff.ts`
- Rewrite: `desktop/src/features/onboarding/welcomeKickoff.test.mjs`
- Modify: `desktop/src/features/onboarding/useWelcomeKickoffEntrance.ts`

**Interfaces:**
- Produces: `KIND_AIRHOP_AGENT_TASK = 21021` as an ephemeral, non-timeline kind.
- Produces: `dispatch_airhop_agent_task(channel_id, agent_pubkey, task_id, stage, instruction)` signed by the owner.
- Produces: `WelcomeKickoffStage = "fizz_intro" | "administrator_intro" | "analyst_intro" | "content_marketer_intro" | "fizz_first_question"`.
- Consumes: durable stage markers written by `airhop-agent-mcp` in Task 7.

- [ ] **Step 1: Add failing kind and command tests**

The event must contain exact tags and no NIP-10 tags:

```rust
assert_eq!(event.kind.as_u16() as u32, KIND_AIRHOP_AGENT_TASK);
assert!(has_tag(&event, "h", channel_id));
assert!(has_tag(&event, "p", agent_pubkey));
assert!(has_tag(&event, "airhop-task", task_id));
assert!(!event.tags.iter().any(|tag| tag.as_slice()[0] == "e"));
```

The relay already treats 20000–29999 as ephemeral, so the task never appears after a history query.

- [ ] **Step 2: Replace old opener/closer tests with stage-machine RED tests**

Pin semantic order, restart behavior, and owner interruption:

```js
assert.deepEqual(nextKickoffStages([]), ["fizz_intro"]);
assert.deepEqual(nextKickoffStages(["fizz_intro"]), ["administrator_intro"]);
assert.deepEqual(nextKickoffStages(ALL_STAGES), []);
assert.equal(shouldDispatchKickoff({ ownerHasSpoken: true }), false);
assert.equal(buildKickoffTask(stage, locale).parentEventId, null);
```

Provider failure returns one localized Fizz message marker; it does not mark any semantic stage complete.

- [ ] **Step 3: Run focused tests and observe RED**

Run:

```bash
. ./bin/activate-hermit
cargo test -p buzz-core airhop_agent_task
cargo test --manifest-path desktop/src-tauri/Cargo.toml airhop_agent_task
cd desktop
node --import ./test-loader.mjs --experimental-strip-types --test src/features/onboarding/welcomeKickoff.test.mjs
```

Expected: FAIL because the current kickoff posts one opener thread and a closer.

- [ ] **Step 4: Implement the durable semantic stage coordinator**

Represent state without a completion concept:

```ts
export type WelcomeKickoffSnapshot = Readonly<{
  observedStages: ReadonlySet<WelcomeKickoffStage>;
  ownerHasSpoken: boolean;
  inFlightStage: WelcomeKickoffStage | null;
}>;
```

Dispatch one stage only after its target runtime is ready. Each stage instruction tells the model the semantic purpose, owner name, locale, known organization data, maximum three short top-level messages, and the required stage receipt. Abort not-yet-dispatched stages when any non-agent owner message appears. After `fizz_first_question`, the coordinator simply has no scheduled stage; it does not write “completed”.

- [ ] **Step 5: Re-run tests and commit**

Run:

```bash
. ./bin/activate-hermit
cargo test -p buzz-core airhop_agent_task
cargo test --manifest-path desktop/src-tauri/Cargo.toml airhop_agent_task
cd desktop
node --import ./test-loader.mjs --experimental-strip-types --test src/features/onboarding/welcomeKickoff.test.mjs
pnpm typecheck
cd ..
git add crates/buzz-core/src/kind.rs desktop/src-tauri/src/commands/messages.rs desktop/src-tauri/src/lib.rs desktop/src/shared/api/tauri.ts desktop/src/features/onboarding/welcomeKickoff.ts desktop/src/features/onboarding/welcomeKickoff.test.mjs desktop/src/features/onboarding/useWelcomeKickoffEntrance.ts
git commit -s -m "feat(airhop): orchestrate model-driven Welcome kickoff"
```

Expected: stage order, flat messages, restart, interruption, and provider failure tests PASS.

---

### Task 5: Build the Atomic One-Responder Welcome Router

**Files:**
- Extend: `crates/buzz-db/src/airhop/welcome_agents.rs`
- Extend: `crates/buzz-relay/src/api/airhop_agents.rs`
- Create: `crates/buzz-acp/src/airhop.rs`
- Modify: `crates/buzz-acp/src/lib.rs`
- Modify: `crates/buzz-acp/src/config.rs`
- Modify: `crates/buzz-acp/src/relay.rs`

**Interfaces:**
- Produces: `POST /api/airhop/agents/v1/routes/{event_id}/claim` authenticated by the calling agent.
- Produces: `WelcomeRouteDecision { event_id, target_role, target_pubkey, reason, replayed }`.
- Produces: ACP config `airhop_route_gate`, `flat_channel_ids`, and `airhop_role` from Task 3 env.
- Consumes: Task 2 Welcome manifest and event history.

- [ ] **Step 1: Add failing pure routing tests**

Define deterministic precedence:

```rust
assert_eq!(select_route(explicit_admin), (Administrator, ExplicitMention));
assert_eq!(select_route(russian_admin_name), (Administrator, NaturalRole));
assert_eq!(select_route(reply_to_analyst_question), (Analyst, LastQuestion));
assert_eq!(select_route(active_content_handoff), (ContentMarketer, Handoff));
assert_eq!(select_route(ambiguous_text), (Fizz, Fallback));
```

Aliases come from the registered locale pack and use Unicode token boundaries; substring `административный` must not match `Администратор`.

- [ ] **Step 2: Add failing transactional claim tests**

Four concurrent claims for one human event must return one identical decision:

```rust
let decisions = join_all(callers.into_iter().map(claim)).await;
assert!(decisions.iter().all(|item| item.target_pubkey == admin_pubkey));
assert_eq!(count_route_rows(event_id).await, 1);
assert_eq!(decisions.iter().filter(|item| !item.replayed).count(), 1);
```

Reject an event from another tenant, an event outside the registered Welcome channel, an agent-authored input event, an unregistered claimant, and a deleted event.

- [ ] **Step 3: Add failing ACP gate tests**

Pin these outcomes:

```rust
assert_eq!(gate.evaluate(admin_event, admin_agent).await?, RouteGate::Accept);
assert_eq!(gate.evaluate(admin_event, fizz_agent).await?, RouteGate::Drop);
assert_eq!(gate.evaluate(replayed_event, admin_agent).await?, RouteGate::DropDuplicate);
assert_eq!(gate.evaluate(non_welcome_mention, fizz_agent).await?, RouteGate::Bypass);
```

A route endpoint failure drops the event and logs a bounded error; it never falls back to prompting all agents.

- [ ] **Step 4: Run focused tests and observe RED**

Run:

```bash
. ./bin/activate-hermit
cargo test -p buzz-db welcome_route
cargo test -p buzz-relay welcome_route
cargo test -p buzz-acp airhop::tests
```

Expected: FAIL because no route claim or ACP gate exists.

- [ ] **Step 5: Implement route claim and pre-queue gate**

Persist:

```rust
pub struct WelcomeRouteDecision {
    pub event_id: [u8; 32],
    pub channel_id: Uuid,
    pub target_role: AirhopWelcomeRole,
    pub target_pubkey: [u8; 32],
    pub reason: WelcomeRouteReason,
    pub replayed: bool,
}
```

Use `INSERT ... ON CONFLICT (community_id, event_id) DO NOTHING`, then read the winner in the same transaction. ACP must call the claim endpoint before `EventQueue::push`; only the matching pubkey enters the queue. Ephemeral kickoff tasks and Fizz-authored handoff events bypass human routing only when their author/target match the registered manifest and they carry the matching `p` tag and registered channel.

- [ ] **Step 6: Re-run tests and commit**

Run:

```bash
. ./bin/activate-hermit
cargo test -p buzz-db welcome_route
cargo test -p buzz-relay welcome_route
cargo test -p buzz-acp airhop::tests
cargo fmt --all -- --check
git add crates/buzz-db/src/airhop/welcome_agents.rs crates/buzz-relay/src/api/airhop_agents.rs crates/buzz-acp/src/airhop.rs crates/buzz-acp/src/lib.rs crates/buzz-acp/src/config.rs crates/buzz-acp/src/relay.rs
git commit -s -m "feat(airhop): route one Welcome agent per message"
```

Expected: precedence, concurrency, replay, failure, and non-Welcome bypass tests PASS.

---

### Task 6: Make Welcome Flat and Supply Relevant Conversation Context

**Files:**
- Modify: `crates/buzz-acp/src/queue.rs`
- Modify: `crates/buzz-acp/src/pool.rs`
- Modify: `crates/buzz-acp/src/relay.rs`
- Modify: `crates/buzz-acp/src/base_prompt.md`

**Interfaces:**
- Consumes: `flat_channel_ids` from Task 5.
- Produces: `ReplyMode::FlatChannel | ThreadedChannel | DirectMessage`.
- Produces: recent top-level Welcome `ConversationContext` capped by existing context limits.
- Invariant: no Welcome prompt tells an agent to use `--reply-to`; other channel prompts remain byte-for-byte compatible where tests pin them.

- [ ] **Step 1: Add failing reply-mode tests**

```rust
assert_eq!(resolve_reply_mode(welcome_id, &flat_ids, false), ReplyMode::FlatChannel);
assert_eq!(resolve_reply_mode(general_id, &flat_ids, false), ReplyMode::ThreadedChannel);
assert!(!welcome_prompt.contains("--reply-to"));
assert!(welcome_prompt.contains("send top-level"));
assert!(general_prompt.contains("--reply-to"));
```

- [ ] **Step 2: Add failing Welcome history tests**

For a plain Welcome event, fetch recent top-level messages, preserve author/agent identity, keep the triggering event last, and exclude ephemeral tasks, deleted events, and another tenant:

```rust
assert_eq!(context.messages.last().unwrap().event_id, triggering_id);
assert!(context.messages.iter().all(|message| message.depth == 0));
assert!(context.messages.iter().all(|message| message.kind == KIND_STREAM_MESSAGE));
```

- [ ] **Step 3: Run ACP tests and observe RED**

Run:

```bash
. ./bin/activate-hermit
cargo test -p buzz-acp flat_channel
cargo test -p buzz-acp welcome_context
```

Expected: FAIL because human-facing top-level messages currently force a new thread and channel history is not fetched for this case.

- [ ] **Step 4: Implement flat hints and bounded channel context**

For `ReplyMode::FlatChannel`, emit:

```text
[Context]
Scope: Airhop Welcome
Reply with top-level messages in this channel. Do not use --reply-to.
Use one thought per message and no more than three short messages unless the human asks for detail.
```

Reuse the existing Nostr query/client and trimming budget. Do not merge NIP-AE per-agent memory or Nest files into the organization context.

- [ ] **Step 5: Re-run regression tests and commit**

Run:

```bash
. ./bin/activate-hermit
cargo test -p buzz-acp flat_channel
cargo test -p buzz-acp welcome_context
cargo test -p buzz-acp queue::tests
cargo test -p buzz-acp pool::tests
git add crates/buzz-acp/src/queue.rs crates/buzz-acp/src/pool.rs crates/buzz-acp/src/relay.rs crates/buzz-acp/src/base_prompt.md
git commit -s -m "feat(airhop): keep Welcome agent turns top-level"
```

Expected: Welcome is flat, context is bounded and tenant-safe, and existing thread tests PASS.

---

### Task 7: Add the Role-Aware `airhop-agent-mcp` Personality

**Files:**
- Create: `crates/buzz-dev-mcp/src/airhop.rs`
- Modify: `crates/buzz-dev-mcp/src/lib.rs`
- Modify: `crates/buzz-dev-mcp/Cargo.toml`
- Modify: `crates/sprig/src/main.rs`
- Modify: `scripts/build-sprig.sh`
- Modify: `scripts/bundle-sidecars.sh`
- Modify: `scripts/test-sprig-image.sh`
- Modify: `justfile`
- Modify: `desktop/src-tauri/tauri.conf.json`
- Modify: `desktop/src-tauri/tauri.windows.conf.json`

**Interfaces:**
- Consumes: `BUZZ_AIRHOP_ROLE`, registered Welcome channel ID, relay URL, agent key, and NIP-OA auth tag.
- Produces tools: `airhop_send_messages`, `airhop_delegate`, `airhop_read`, `airhop_prepare_action`.
- Capability matrix:
  - Fizz: send, delegate, read summaries; no prepare action.
  - Administrator: send, read operations, prepare setup action.
  - Analyst: send, read analytics; no mutation.
  - Content Marketer: send, read public-content settings; no publish or mutation.

- [ ] **Step 1: Add failing role-capability tests**

```rust
assert_eq!(tools_for(Fizz), set!["airhop_send_messages", "airhop_delegate", "airhop_read"]);
assert!(tools_for(Fizz).get("airhop_prepare_action").is_none());
assert!(tools_for(Administrator).contains("airhop_prepare_action"));
assert!(!tools_for(ContentMarketer).contains("airhop_publish"));
```

Reject missing/unknown role and any channel ID other than the registered Welcome channel.

- [ ] **Step 2: Add failing message/delegation contract tests**

Define:

```rust
pub struct SendMessagesParams {
    pub channel_id: Uuid,
    pub messages: Vec<String>, // 1..=3, each <= 1200 chars
    pub expects_reply: bool,
    pub kickoff_stage: Option<WelcomeKickoffStage>,
}

pub struct DelegateParams {
    pub channel_id: Uuid,
    pub target_role: AirhopWelcomeRole,
    pub assignment: String,
}
```

Signed messages have `h`, `airhop-agent-turn`, optional `airhop-question`, `airhop-handoff`, and `airhop-kickoff-stage` tags, but never `e` tags in Welcome. Delegation includes the target agent `p` tag and is rejected for non-Fizz callers.

- [ ] **Step 3: Add failing authoritative read tests**

Use a mock NIP-98 server and assert role allowlists:

```rust
assert!(Administrator.allows(ReadResource::Families));
assert!(Administrator.allows(ReadResource::Schedule));
assert!(Analyst.allows(ReadResource::PaymentAnalytics));
assert!(Analyst.allows(ReadResource::BookingFunnel));
assert!(ContentMarketer.allows(ReadResource::PublicBookingSettings));
assert!(!ContentMarketer.allows(ReadResource::FamilyDetail));
```

Responses include locale/time zone and structured JSON; the MCP does not persist a separate summary.

- [ ] **Step 4: Run tests and observe RED**

Run:

```bash
. ./bin/activate-hermit
cargo test -p buzz-dev-mcp airhop
```

Expected: FAIL because the personality and tools do not exist.

- [ ] **Step 5: Implement role-filtered MCP routing and packaging**

`buzz-dev-mcp::run()` dispatches by argv0:

```rust
match cmd.as_str() {
    "airhop-agent-mcp" => airhop::run().await,
    _ => run_dev_mcp().await,
}
```

Expose only allowed tools in `list_tools`; do not merely return a runtime error from a visible forbidden tool. Add the multicall alias to Sprig archives, desktop sidecars, stubs, release builds, and image contract tests.

- [ ] **Step 6: Re-run tests and commit**

Run:

```bash
. ./bin/activate-hermit
cargo test -p buzz-dev-mcp airhop
cargo test -p sprig
bash scripts/test-sprig-image.sh buzz-sprig:contract-test
cargo fmt --all -- --check
git add crates/buzz-dev-mcp/src/airhop.rs crates/buzz-dev-mcp/src/lib.rs crates/buzz-dev-mcp/Cargo.toml crates/sprig/src/main.rs scripts/build-sprig.sh scripts/bundle-sidecars.sh scripts/test-sprig-image.sh justfile desktop/src-tauri/tauri.conf.json desktop/src-tauri/tauri.windows.conf.json
git commit -s -m "feat(airhop): add role-scoped agent tools"
```

Expected: capability, signing, message tags, read allowlists, and packaging tests PASS.

---

### Task 8: Implement Server-Side Pending Setup Actions

**Files:**
- Create: `crates/buzz-db/src/airhop/agent_actions.rs`
- Modify: `crates/buzz-db/src/airhop.rs`
- Extend: `crates/buzz-relay/src/api/airhop_agents.rs`
- Create: `crates/buzz-relay/src/airhop_agent_actions.rs`
- Modify: `crates/buzz-relay/src/lib.rs`
- Extend: `crates/buzz-dev-mcp/src/airhop.rs`

**Interfaces:**
- Produces: `AirhopAgentCommand` for the initial setup path.
- Produces: `POST /api/airhop/agents/v1/actions/prepare` authenticated by a registered specialist.
- Produces: relay-signed top-level preview tagged `airhop-action`.
- Consumes: existing DB command services for organization settings, branches, rooms, teachers, groups, tariffs, families, enrollments, and payments.

- [ ] **Step 1: Define exact typed command variants and failing parse tests**

```rust
#[serde(tag = "type", content = "input", rename_all = "snake_case")]
pub enum AirhopAgentCommand {
    PutOrganizationSettings(PutOrganizationSettingsBody),
    CreateBranch(CreateBranchBody),
    CreateRoom { branch_id: Uuid, body: CreateRoomBody },
    CreateTeacher(CreateTeacherBody),
    CreateGroup(CreateGroupBody),
    CreateTariff(CreateTariffBody),
    CreateFamily(CreateFamilyBody),
    EnrollParticipant(EnrollStaffParticipantBody),
    MutatePayment { payment_id: Uuid, body: MutatePaymentBody },
}
```

Move these request DTOs into a shared relay module so staff HTTP and agent action preparation parse the same structures. Unknown fields and unsupported variants fail closed.

- [ ] **Step 2: Add failing authorization and preview tests**

```rust
assert!(prepare(Fizz, command).await.is_forbidden());
assert!(prepare(Analyst, command).await.is_forbidden());
assert!(prepare(ContentMarketer, command).await.is_forbidden());
assert_eq!(prepare(Administrator, command).await?.status, Pending);
assert_eq!(preview.depth, 0);
assert!(preview.tags.contains(["airhop-action", org, action, "1", digest]));
```

The preview uses organization locale for labels/date/time/money, contains the specialist name, and ends with one concise localized confirmation instruction.

- [ ] **Step 3: Add failing persistence/idempotency tests**

Pin `PendingAction`:

```rust
pub struct PendingAgentAction {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub channel_id: Uuid,
    pub triggering_event_id: [u8; 32],
    pub prepared_by_agent_pubkey: [u8; 32],
    pub specialist_role: AirhopWelcomeRole,
    pub command: AirhopAgentCommand,
    pub command_digest: [u8; 32],
    pub expected_versions: Value,
    pub preview_event_id: Option<[u8; 32]>,
    pub status: AgentActionStatus,
    pub expires_at: DateTime<Utc>,
}
```

Same `(community, triggering_event_id, command_digest)` returns the same action and preview identity. A corrected command cancels older pending actions for that triggering event before publishing the replacement preview.

- [ ] **Step 4: Run tests and observe RED**

Run:

```bash
. ./bin/activate-hermit
cargo test -p buzz-db agent_actions
cargo test -p buzz-relay airhop_agent_actions
cargo test -p buzz-dev-mcp prepare_action
```

Expected: FAIL because the server pending-action ledger is absent.

- [ ] **Step 5: Implement preparation, localized preview, and retry-stable publication**

Preparation validates the registered Administrator pubkey, source Welcome event, tenant, command payload, current resource versions, and required fields. It writes only the pending row, reserves the deterministic preview event ID, publishes with the relay key, and then records the published ID. No Booking Core mutation runs in this endpoint.

The action tool returns:

```json
{
  "actionId": "uuid",
  "previewEventId": "64-hex",
  "status": "pending",
  "message": "Preview posted. Wait for a human ✅."
}
```

- [ ] **Step 6: Re-run tests and commit**

Run:

```bash
. ./bin/activate-hermit
cargo test -p buzz-db agent_actions
cargo test -p buzz-relay airhop_agent_actions
cargo test -p buzz-dev-mcp prepare_action
cargo fmt --all -- --check
git add crates/buzz-db/src/airhop.rs crates/buzz-db/src/airhop/agent_actions.rs crates/buzz-relay/src/api/airhop_agents.rs crates/buzz-relay/src/airhop_agent_actions.rs crates/buzz-relay/src/lib.rs crates/buzz-dev-mcp/src/airhop.rs
git commit -s -m "feat(airhop): prepare specialist setup actions"
```

Expected: authorization, parsing, idempotency, correction, preview, and publication tests PASS.

---

### Task 9: Commit the Exact Preview Atomically on Human ✅

**Files:**
- Extend: `crates/buzz-db/src/airhop/agent_actions.rs`
- Modify: `crates/buzz-db/src/event.rs`
- Modify: `crates/buzz-db/src/airhop.rs`
- Extend: `crates/buzz-relay/src/airhop_agent_actions.rs`

**Interfaces:**
- Consumes: trusted `airhop-action` card from Task 8 and existing kind:7 transaction.
- Produces: `commit_airhop_agent_action_from_reaction(&mut PgConnection, ...)`.
- Produces: audit payload with initiator event/author, preparer agent/role, confirmer pubkey, preview event, reaction event, command digest, and result IDs.

- [ ] **Step 1: Add failing trusted-tag parser tests**

```rust
assert_eq!(parse_airhop_action_tag(valid)?.action_id, action_id);
assert!(parse_airhop_action_tag(malformed).is_err());
assert!(parse_airhop_action_tag(unsigned_user_card)?.is_none());
```

Recognition requires `emoji == "✅"`, relay-signed target, exact five-part tag, same channel, and a registered pending action whose `preview_event_id` equals the reaction target.

- [ ] **Step 2: Add failing atomic commit tests**

Test each fence:

```rust
assert_eq!(confirm(valid_human).await?.status, Committed);
assert_eq!(confirm(replay).await?.status, Committed);
assert_eq!(count_domain_changes(action_id).await, 1);
assert!(confirm(agent_authored_reaction).await.is_err());
assert!(confirm(stale_preview).await.is_err());
assert!(confirm(fake_preview).await.is_err());
assert!(confirm(expired_action).await.is_err());
assert!(confirm(cross_tenant).await.is_err());
```

A failed fence rolls back both the reaction row and kind:7 event, matching the payment-card behavior.

- [ ] **Step 3: Add failing optimistic execution tests for every Task 8 variant**

For each command, change its expected version between prepare and confirm and assert `AirhopAgentActionConflict`; then run the unchanged case and assert the existing DB service wrote its normal domain event/audit record with `ActorKind::Bot`, `agent_pubkey = preparer`, and `on_behalf_of_pubkey = confirmer`.

- [ ] **Step 4: Run tests and observe RED**

Run:

```bash
. ./bin/activate-hermit
cargo test -p buzz-db airhop_agent_action_reaction -- --nocapture
cargo test -p buzz-db agent_actions::commit
```

Expected: FAIL because kind:7 handles only `airhop-payment` cards.

- [ ] **Step 5: Implement commit inside the existing reaction transaction**

Extend the current branch, without a second transaction:

```rust
let airhop_action = if emoji == "✅" && target_pubkey == relay_pubkey {
    parse_airhop_action_tag(&target_tags)?
        .map(|tag| commit_airhop_agent_action_from_reaction(
            &mut tx,
            tenant,
            tag,
            target_channel_id,
            actor_pubkey,
            reaction_event.id.as_bytes(),
            target_event_id,
        ))
        .transpose()
        .await?
} else {
    None
};
```

The executor locks the pending row, revalidates digest/version/expiry/identity, applies the typed command through existing DB primitives, records result/audit, and marks committed. Replay returns stored result without repeating the domain write.

- [ ] **Step 6: Re-run tests and commit**

Run:

```bash
. ./bin/activate-hermit
cargo test -p buzz-db airhop_agent_action_reaction
cargo test -p buzz-db agent_actions::commit
cargo test -p buzz-db airhop::payment_queue
cargo fmt --all -- --check
git add crates/buzz-db/src/airhop/agent_actions.rs crates/buzz-db/src/event.rs crates/buzz-db/src/airhop.rs crates/buzz-relay/src/airhop_agent_actions.rs
git commit -s -m "feat(airhop): confirm specialist actions from Buzz"
```

Expected: exact-preview commit, audit, stale/fake/replay/expiry/tenant fences, and payment confirmation regressions PASS.

---

### Task 10: Generalize the Workspace Actor Surface and Turn State

**Files:**
- Modify: `desktop/src/features/booking/actions/airhopActionSchemas.ts`
- Modify: `desktop/src/features/booking/actions/airhopActionService.ts`
- Modify: `desktop/src/features/booking/actions/airhopActionService.test.mjs`
- Extend: `crates/buzz-db/src/airhop/welcome_agents.rs`
- Extend: `crates/buzz-relay/src/api/airhop_agents.rs`

**Interfaces:**
- Produces: workspace/demo surface `"buzz_agent"` with `agentId` and `specialistRole`.
- Produces: server conversation state updates from trusted `airhop-question` and `airhop-handoff` tags.
- Consumes: Task 7 agent messages and Task 5 route selection.

- [ ] **Step 1: Add failing TypeScript actor tests**

```js
assert.equal(airhopActorSchema.parse({
  userId: "owner",
  surface: "buzz_agent",
  agentId: "admin-pubkey",
  specialistRole: "administrator",
  channelId: "welcome",
}).specialistRole, "administrator");
assert.throws(() => prepareAirhopAction(workspace, command, {
  surface: "buzz_agent",
  agentId: "fizz-pubkey",
  specialistRole: "fizz",
}, context), /cannot prepare mutations/);
```

Keep `staff_ui` immediate execution behavior. Remove new production references to surface `fizz` after migration tests cover old serialized workspace data.

- [ ] **Step 2: Add failing turn-state tests**

```rust
assert_eq!(state_after_question.last_question_role, Some(Analyst));
assert_eq!(state_after_handoff.handoff_role, Some(Administrator));
assert_eq!(state_after_specialist_answer.handoff_role, None);
assert_eq!(route(next_plain_human_message), Fizz);
```

Only registered agent authors may update state; a human copying the tags has no effect.

- [ ] **Step 3: Run tests and observe RED**

Run:

```bash
cd desktop
node --import ./test-loader.mjs --experimental-strip-types --test src/features/booking/actions/airhopActionService.test.mjs
cd ..
. ./bin/activate-hermit
cargo test -p buzz-db welcome_turn_state
cargo test -p buzz-relay welcome_turn_state
```

Expected: FAIL because the workspace surface is Fizz-specific and server turn state is absent.

- [ ] **Step 4: Implement generalized attribution and trusted state updates**

Store `initiatedBy`, `preparedByAgentId`, `specialistRole`, and `confirmedBy` separately. Update state as a relay side effect only after the agent message is stored and author identity matches the manifest. A specialist answer clears handoff unless it sets `expects_reply`; a Fizz delegation sets the target handoff.

- [ ] **Step 5: Re-run tests and commit**

Run:

```bash
cd desktop
node --import ./test-loader.mjs --experimental-strip-types --test src/features/booking/actions/airhopActionService.test.mjs
pnpm typecheck
cd ..
. ./bin/activate-hermit
cargo test -p buzz-db welcome_turn_state
cargo test -p buzz-relay welcome_turn_state
git add desktop/src/features/booking/actions/airhopActionSchemas.ts desktop/src/features/booking/actions/airhopActionService.ts desktop/src/features/booking/actions/airhopActionService.test.mjs crates/buzz-db/src/airhop/welcome_agents.rs crates/buzz-relay/src/api/airhop_agents.rs
git commit -s -m "refactor(airhop): attribute actions to specialist agents"
```

Expected: legacy workspace migration, Fizz prohibition, specialist attribution, and route-state tests PASS.

---

### Task 11: Cover Failures, Mock Bridge, and Dialogue Quality

**Files:**
- Modify: `desktop/src/testing/e2eBridge.ts`
- Create: `desktop/src/features/onboarding/welcomeDialogueContract.test.mjs`
- Modify: `desktop/src/features/onboarding/welcomeKickoff.test.mjs`
- Create: `crates/buzz-agent/tests/airhop_welcome_transcripts.rs`

**Interfaces:**
- Consumes: all runtime contracts from Tasks 1–10.
- Produces: deterministic test fixtures for routing, kickoff tasks, stage receipts, provider absence, degraded specialists, preview cards, and action reaction outcomes.

- [ ] **Step 1: Add mock bridge fixtures and failing failure-path tests**

Add controls:

```ts
welcomeAgentTeam: {
  locale: "ru-RU",
  routeTargetByEvent: Record<string, AirhopWelcomeRole>,
  unavailableRoles: AirhopWelcomeRole[],
  completedKickoffStages: WelcomeKickoffStage[],
  pendingActions: MockAirhopAgentAction[],
}
```

Tests assert no duplicate kickoff after reload, one localized provider message, no fallback agent reply after a specialist runtime failure, and no success message before Booking Core commit.

- [ ] **Step 2: Add dialogue contract scenarios**

Each transcript asserts observable properties, not exact prose:

```js
assert.ok(turn.messages.length >= 1 && turn.messages.length <= 3);
assert.ok(turn.messages.every((message) => sentenceCount(message) <= 3));
assert.equal(turn.respondingRoles.size, 1);
assert.equal(turn.hasHeading, false);
assert.equal(turn.reasksKnownFact, false);
```

Cover a long free-form answer, multiple facts, a counter-question, `Админ` without `@`, a correction that replaces preview, a pause, direct locale switch, and an open question left without reminders.

- [ ] **Step 3: Add golden model transcript tests**

For each persona system prompt, feed the same Russian/English/Portuguese scenarios through the fake LLM harness and assert role/tool boundaries: Fizz delegates, Administrator uses prepare, Analyst reads only, Content Marketer states publishing is unavailable. No persona mentions Hermes as a Welcome teammate or claims persistent organization memory.

- [ ] **Step 4: Run tests and observe RED, then implement fixtures**

Run:

```bash
cd desktop
node --import ./test-loader.mjs --experimental-strip-types --test src/features/onboarding/welcomeDialogueContract.test.mjs src/features/onboarding/welcomeKickoff.test.mjs
cd ..
. ./bin/activate-hermit
cargo test -p buzz-agent airhop_welcome_transcripts
```

Expected before fixture implementation: FAIL. Implement only the deterministic harness data and assertions required to exercise production contracts; do not add production-only shortcuts.

- [ ] **Step 5: Re-run tests and commit**

Run:

```bash
cd desktop
node --import ./test-loader.mjs --experimental-strip-types --test src/features/onboarding/welcomeDialogueContract.test.mjs src/features/onboarding/welcomeKickoff.test.mjs
cd ..
. ./bin/activate-hermit
cargo test -p buzz-agent airhop_welcome_transcripts
git add desktop/src/testing/e2eBridge.ts desktop/src/features/onboarding/welcomeDialogueContract.test.mjs desktop/src/features/onboarding/welcomeKickoff.test.mjs crates/buzz-agent/tests/airhop_welcome_transcripts.rs
git commit -s -m "test(airhop): cover Welcome dialogue contracts"
```

Expected: failure and dialogue-quality contracts PASS.

---

### Task 12: Add Relay Integration and Real Tauri Acceptance

**Files:**
- Create: `crates/buzz-test-client/tests/e2e_airhop_welcome_agents.rs`
- Modify: `crates/buzz-test-client/Cargo.toml`
- Create: `desktop/tests/e2e/airhop-welcome-agent-team.spec.ts`
- Modify: `desktop/playwright.config.ts`
- Update: `docs/AIRHOP_SOURCE_OF_TRUTH.md`
- Update: `docs/superpowers/specs/2026-08-18-airhop-welcome-agent-team-design.md`

**Interfaces:**
- Consumes: complete implementation.
- Produces: wire-observable proof of registration, route isolation, flat messaging, preview/✅ commit, audit, restart, and tenant isolation.
- Readiness rule: browser mock is diagnostic; final acceptance runs the packaged Tauri app with real local relay, Postgres, Redis, and fake deterministic AI provider.

- [ ] **Step 1: Write the failing relay integration scenario**

Exercise:

```rust
owner_claim();
register_welcome_team();
let route = send_human_message("Админ, добавь филиал").await;
assert_eq!(route.target_role, Administrator);
assert_eq!(count_agent_turns(route.event_id).await, 1);
let preview = prepare_create_branch().await;
react(preview.event_id, "✅", owner_keys).await;
assert_branch_created_once().await;
assert_action_audit_triplet(owner, administrator, owner).await;
```

Repeat the reaction, inject a fake relay-looking card signed by another key, supersede the preview, and run the same IDs in another community.

- [ ] **Step 2: Write the failing Tauri first-owner scenario**

The test must prove:

```ts
await expectWelcomePrivateAndFocused(page);
await expectTopLevelLocalizedTeam(page, ["Физ", "Администратор", "Аналитик", "Контент-маркетолог"]);
await expectNoThreadTagsForWelcomeMessages(page);
await sendWelcomeMessage(page, "Админ, добавь филиал Центр");
await expectSingleRespondingAgent(page, "Администратор");
await confirmLatestPreview(page);
await expectBookingCoreBranch(page, "Центр");
await restartTauriApp();
await expectNoDuplicateKickoffOrAction(page);
```

Also verify a task in `#general` requires `@Администратор` and the reply remains in a thread.

- [ ] **Step 3: Run focused integration tests and observe RED**

Run:

```bash
. ./bin/activate-hermit
just test
cargo test -p buzz-test-client --test e2e_airhop_welcome_agents -- --nocapture
cd desktop
pnpm exec playwright test airhop-welcome-agent-team.spec.ts --project=tauri
```

Expected: the new scenarios fail until all wiring and fixtures are complete.

- [ ] **Step 4: Finish wiring exposed by integration tests**

Fix only production wiring defects: route mounting, sidecar packaging, environment propagation, task subscription, marker parsing, startup ordering, and Tauri selectors. Do not weaken assertions or replace the Tauri project with the browser mock.

- [ ] **Step 5: Update product documentation with implemented evidence**

Record exact shipped persona IDs, route endpoint/table ownership, action variants, locale packs, test commands, and the deliberate absence of organization knowledge base, employee Welcome, Hermes provider actions, and content publishing.

- [ ] **Step 6: Run the full verification gate**

Run:

```bash
. ./bin/activate-hermit
just ci
just test
cargo test -p buzz-test-client --test e2e_airhop_welcome_agents -- --nocapture
cd desktop
pnpm exec playwright test airhop-welcome-agent-team.spec.ts --project=tauri
cd ..
git diff --check
git status --short
```

Expected: every command PASS; only intended documentation changes remain unstaged.

- [ ] **Step 7: Commit the acceptance slice**

```bash
. ./bin/activate-hermit
git add crates/buzz-test-client/tests/e2e_airhop_welcome_agents.rs crates/buzz-test-client/Cargo.toml desktop/tests/e2e/airhop-welcome-agent-team.spec.ts desktop/playwright.config.ts docs/AIRHOP_SOURCE_OF_TRUTH.md docs/superpowers/specs/2026-08-18-airhop-welcome-agent-team-design.md
git commit -s -m "test(airhop): verify Welcome agent team end to end"
```

Expected: branch is clean and the implementation satisfies all ten design criteria.
