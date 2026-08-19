# AirHop Owner First Run Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the previously approved AirHop first-run experience on the current backend: language selection, one organization code, required owner name with optional avatar, then direct entry into private Welcome.

**Architecture:** Keep the current signed invite/owner-claim transaction and Welcome provisioning as the source of truth. Replace only the inherited Buzz presentation and machine-onboarding gate with an AirHop-owned first-run surface recovered from the earlier `codex/airhop-center-pruning` work, while preserving the current dirty agent changes. The owner flow persists one locale and uses the existing `CommunityOnboardingFlow` for claim, profile persistence, channel provisioning, and Welcome entry.

**Tech Stack:** React 19, TypeScript 6, Tailwind CSS, Tauri 2, Node test runner, Playwright/WebdriverIO.

**Spec:** `docs/AIRHOP_SOURCE_OF_TRUTH.md`

## Global Constraints

- Work only in `/Users/andreymakeev/Developer/airhop-center`; do not modify AirHub HQ.
- Work directly on `main` as requested; do not push without a separate command.
- Preserve all existing uncommitted agent and OpenAI-theme work.
- Use the canonical `airhop-mark.png`, not the hand-authored `mark.svg`.
- The first run is `language -> one code -> required name / optional avatar -> Welcome`.
- The code uses the current signed owner claim; do not restore the obsolete separate activation backend.
- The inherited `LandingBees`, community choice, BuilderLab sign-in, and generic Buzz machine onboarding must not be reachable in the owner first run.
- English and Russian are the visible first-run choices; Turkish and Brazilian Portuguese remain complete hidden dictionaries for a later launch. Before a choice, the surface is English, and every subsequent first-run message follows the explicit selection.
- Agent introductions happen as short top-level Welcome messages. Do not add a separate completion wizard, progress percentage, or checklist.
- Verification must include the real current native application path, not a detached legacy preview.

---

### Task 1: Restore the canonical visual and locale contract

**Files:**
- Create: `desktop/public/airhop/mark.png`
- Create: `desktop/public/airhop/owner-background.jpg`
- Create: `desktop/src/features/onboarding/airhopOwnerLocale.ts`
- Create: `desktop/src/features/onboarding/airhopOwnerLocale.test.mjs`
- Modify: `desktop/src/shared/brand/airhopBrand.ts`
- Modify: `desktop/src/shared/brand/airhopBrand.test.mjs`
- Modify: `desktop/index.html`

**Interfaces:**
- Consumes: locale storage and the existing `AirHopMark` component.
- Produces: `AIRHOP_OWNER_LOCALES`, `loadAirHopOwnerLocale()`, `persistAirHopOwnerLocale()`, `airHopOwnerCopy()` and canonical PNG asset paths.

- [ ] **Step 1: Write failing tests** asserting the four locale choices, stable storage key, localized language/code/profile copy, and `/airhop/mark.png` branding contract.
- [ ] **Step 2: Run** `cd desktop && node --test src/features/onboarding/airhopOwnerLocale.test.mjs src/shared/brand/airhopBrand.test.mjs` and confirm missing locale module / old SVG failures.
- [ ] **Step 3: Implement** the locale module and restore the exact saved PNG logo and chosen mountain/rainbow photograph.
- [ ] **Step 4: Re-run** the focused tests and confirm they pass.

### Task 2: Replace the generic first-community chooser with the recovered AirHop setup

**Files:**
- Create: `desktop/src/features/onboarding/ui/AirHopOwnerSetup.tsx`
- Create: `desktop/src/features/onboarding/ui/AirHopOwnerSetup.test.mjs`
- Modify: `desktop/src/features/communities/ui/WelcomeSetup.tsx`

**Interfaces:**
- Consumes: `defaultRelayUrl`, `useCommunityOnboarding()`, and the locale contract from Task 1.
- Produces: a first-run component that persists the selected locale and starts exactly one `first-community` claim transaction with the normalized organization code.

- [ ] **Step 1: Write a failing component contract test** that requires the canonical background/mark, four language buttons, one code field, no community-choice cards, no BuilderLab sign-in, and a single owner-claim start call.
- [ ] **Step 2: Run** `cd desktop && node --test src/features/onboarding/ui/AirHopOwnerSetup.test.mjs` and confirm the component is absent.
- [ ] **Step 3: Implement** the recovered glass card over the approved photograph, compact localized copy, language selection, one code input, validation, and claim handoff.
- [ ] **Step 4: Make `WelcomeSetup` delegate to `AirHopOwnerSetup`** while preserving its public prop shape for `App.tsx`.
- [ ] **Step 5: Re-run** the focused component and community-onboarding tests.

### Task 3: Bypass inherited machine onboarding only for a fresh AirHop owner

**Files:**
- Modify: `desktop/src/features/onboarding/machineOnboarding.ts`
- Modify: `desktop/src/features/onboarding/machineOnboarding.test.mjs`
- Modify: `desktop/src/app/App.tsx`

**Interfaces:**
- Consumes: `activeCommunity === null` and the current native identity.
- Produces: `markAirHopOwnerOnboardingComplete(pubkey)` plus `isAirHopOwnerFirstRun` input on `useMachineOnboardingState()`.

- [ ] **Step 1: Add failing unit cases** proving a valid fresh identity reaches community setup without `LandingBees`, while lost/locked/reset identities still use recovery gates.
- [ ] **Step 2: Run** `cd desktop && node --test src/features/onboarding/machineOnboarding.test.mjs` and confirm the new API is missing.
- [ ] **Step 3: Implement** the narrowly scoped completion voucher and pass it only while no community exists.
- [ ] **Step 4: Re-run** machine onboarding and App contract tests.

### Task 4: Continue from profile directly into Welcome

**Files:**
- Modify: `desktop/src/features/onboarding/ui/CommunityOnboardingFlow.tsx`
- Create: `desktop/src/features/onboarding/airhopOwnerJourney.ts`
- Create: `desktop/src/features/onboarding/airhopOwnerJourney.test.mjs`
- Modify: affected onboarding tests.

**Interfaces:**
- Consumes: `CommunityOnboardingTransaction.source`, selected AirHop locale, existing `updateProfile()`, `initializeStarterChannels()`, and current Welcome team provisioning.
- Produces: an owner-only transition `profile -> finalizing -> entering`, without the inherited animated team screen; non-owner/add-community flows retain their existing behavior.

- [ ] **Step 1: Write failing pure transition tests** proving `first-community` skips `team-intro` and every other source retains it.
- [ ] **Step 2: Run** the focused journey and onboarding tests and confirm failure.
- [ ] **Step 3: Localize the owner profile step** with required name, optional avatar, compact copy, and the same recovered AirHop shell.
- [ ] **Step 4: After profile save, call the existing Welcome finalization directly** for first owners; preserve retry, idempotency, membership denial, and the entering curtain.
- [ ] **Step 5: Re-run** all focused onboarding tests.

### Task 5: Verify the recovered experience in the current native app

**Files:**
- Modify/Create only the current native E2E spec/runner needed to start from a clean owner state.

**Interfaces:**
- Consumes: the current Docker-backed relay, fake LLM harness, and Tauri app.
- Produces: evidence that the real current build shows the canonical first-run UI and reaches Welcome with the four registered agents.

- [ ] **Step 1: Run** focused unit tests and `pnpm typecheck`.
- [ ] **Step 2: Build and launch** the current Tauri application with clean isolated state.
- [ ] **Step 3: Verify visually** language selection, correct logo/background, one code, name/avatar, and direct Welcome entry; capture a screenshot.
- [ ] **Step 4: Run** the existing native Welcome E2E and confirm the current backend still provisions four agents and five kickoff messages.
- [ ] **Step 5: Run** `git diff --check` and a scoped final review; do not commit or push without an explicit request.
