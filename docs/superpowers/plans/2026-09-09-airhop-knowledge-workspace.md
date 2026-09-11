# Knowledge workspace

Scope: current Center checkout; preserve conversational booking and analytics.
No deployment or installed-app replacement until the candidate is verified.

- [x] Versioned durable authoring, publication projection, history, tenant isolation.
- [x] Nostr edit commands; private source-file and Markdown artifact transport.
- [x] Optional questionnaire, two-step onboarding, import/review/publication UI.
- [x] Shared published retrieval for Hermes and registered internal agents.
- [x] Unit, PostgreSQL integration, desktop build and browser E2E/visual checks.

Historical reference: 48443fb2 (2026-08-10), recovery branches only. Do not
cherry-pick its legacy schema/API or overwrite the current application.

Acceptance: a saved draft is not visible to Hermes; publication makes it
retrievable; subsequent draft edits leave the published version unchanged;
archive removes it; stale edits conflict; staff-only documents and other
organizations' files never reach parent-facing retrieval. Imported originals
remain privately downloadable; failed conversion never silently becomes a
published empty document. The website bundle must not import document parsers.

Implementation and verification record:
`docs/superpowers/reviews/2026-09-09-airhop-knowledge-workspace.md`.
