# Knowledge workspace — local implementation, 2026-09-09

Status: implemented in the current checkout, not deployed or installed. No
version rollback, release tag, production mutation, or customer message was made.
The checkout also contains unrelated concurrent messaging/profile changes;
these must be reviewed as part of a single committed release candidate.

Follow-up: the same-checkout [client-thread verification](2026-09-09-airhop-client-threads.md)
completed full `just ci`, CLI/MCP unit suites, the knowledge PostgreSQL regression and
all eight knowledge browser scenarios. The historical pending-local-check notes below
describe the earlier checkpoint; real provider/native UI deployment acceptance remains open.

## User-facing behavior

- Center → **База знаний**, between Analytics and Settings.
- Two short, skippable explanation screens; seven optional question templates,
  editable question order, free text and document import.
- PDF with extractable text, DOCX, UTF-8 TXT and Markdown. Originals remain private.
  Import first persists an original-linked draft, then converts in a disposable
  worker and saves extracted text as another draft. Cancellation/parser failure
  leaves a visible recoverable draft. Nothing is published automatically.
- Explicit review and publication, separately editable draft, archive and latest
  50 historical revisions with restore-as-draft. Optimistic conflicts preserve
  unsaved input; repeat network delivery of the same signed command is idempotent.
- Parent-safe or team-only, optional website use, organization/branch/group scope.
  Website permission means content preparation; it does not publish a page.
- “Что увидит Гермес” checks actual published source retrieval, clearly not an
  AI-generated response and not an outgoing Telegram message.
- Native save dialog for original files and current Markdown text. No public
  Blossom/media upload is used for private knowledge.

## Storage, authority and agent contract

- Migration 0056 preserves existing knowledge. PostgreSQL stores original bytes,
  editable JSON, immutable revisions and retry receipts. Published Markdown remains
  in the existing `airhop_knowledge_documents` projection used by Hermes.
- Writes use signed Nostr kind **9050** through existing `/events`/WS ingestion.
  Tenant tag + host binding; current owner/admin checked transactionally. Command
  payloads are not stored in the general message event log or fanned out to members.
- HTTP is limited to authenticated private files and artifact exports. NIP-98 binds
  the exact URL and upload payload; responses are private/no-store. Drafts and
  originals require owner/admin, never the model's claimed identity.
- Hermes uses existing `airhop_search_knowledge`. It sees only published parent-safe
  organization material plus verified Family scope or validated current public
  branch/group selection. New prospects do not need Family access to read a selected
  branch's arrival instructions. Group selection includes branch instructions.
- Internal agents use `airhop_read(resource="knowledge")`; CLI:
  `buzz airhop knowledge`, `--query`, `--document-id`, `--after`.
  Catalog pages omit bodies (100 titles); query/ID reads contain up to five texts.
  Content Marketer is restricted to website-approved public/parent material.
- Retrieval supports literal keywords, PostgreSQL full text and Russian morphology,
  with fallback to organization locale. Agents are instructed to read fresh sources,
  treat text as data (not policy), avoid guessing and keep operational facts in Core.
  No vector database, embedding service or automatic website-content duplication.

## Safety and limits

10 MB/file, 100 MB of deduplicated originals/organization, 50,000 characters/material,
30 questions, 100 PDF pages, 30-second import timeout. DOCX container checks bound
entry count/declared expansion. No raw HTML, embedded image fetching or active links
in the preview. Original bytes are never rendered as a document in the app.

Scans/photos/OCR, handwriting, legacy `.doc` and password-protected PDFs are not
supported. Text order/tables require human review after extraction. Keyword search
is not semantic answer generation; source preview does not prove model answer quality.
Archiving prevents subsequent retrieval; it cannot retract messages already sent or
erase text already in an in-flight agent's context.

## Verification

- `cargo check -p buzz-relay -p buzz-cli -p buzz-dev-mcp`: passed.
- PostgreSQL 18, synthetic isolated database on loopback port 56567, all migrations:
  publication/draft separation, retries, stale/concurrent writes, restore/archive,
  two-tenant isolation, private-source reference rejection, staff/site gates,
  morphology, default locale, metadata-only catalog and prospect scope: passed.
- `pnpm check`: passed, including Biome, file-size/font rules and 20 release-identity
  tests. Extracted the existing locale type to `bookingAdminMessages.ts` instead of
  raising the oversized-file limit; public imports remain compatible.
- Complete desktop unit suite at that checkpoint: **4,487 passed**, none failed.
- Browser integration: **25 passed** across knowledge, existing analytics, settings
  and public booking. Focused follow-up: **8 passed**, including real PDF/DOCX parsing,
  scan recovery, upload-error persistence and no knowledge/parser requests from the
  public booking route. Browser tests use the native mock bridge and HTTP fixtures;
  server persistence was checked independently on PostgreSQL, not simulated SQL.
- Domain knowledge tests: **3 passed**, using a separate temporary target to avoid
  the concurrently rebuilt shared Rust target. Focused final frontend suite: **7 passed**.
- Final post-export frontend `pnpm check`, typecheck/build and focused browser run:
  passed, **8/8 scenarios**. Temporary PostgreSQL stopped after the checks.
- Native macOS crate `cargo check --manifest-path desktop/src-tauri/Cargo.toml --lib`:
  passed. Native export validation unit test: **1 passed** (size/type/encoding).
- The queued MCP/relay unit-test follow-up was not completed: another task repeatedly
  rebuilds the shared target using a different dependency path. Only our waiting
  command was stopped; no other task's process or cache was changed. Compile checks
  passed, but these unit tests must be included in the release gate below.

The full `just ci` (including the new MCP/relay unit tests), real signed HTTP/WS relay
end-to-end suite, native macOS UI smoke
and real Hermes/Telegram answer acceptance remain release gates. None is implied by
the mocked browser checks. Do not install/release this uncommitted checkout directly.

## Safe rollout

1. Integrate concurrent changes into one reviewed commit and freeze its release ID.
2. Run remaining gates, back up demo DB/private originals, deploy migration and relay
   together with the matching CLI/MCP/runtime binaries and desktop candidate.
3. Restart/version-check Hermes and internal agents so their new tools are loaded.
4. On demo: owner creates a real short instruction, publishes it, asks a test parent
   question, checks source version, edits a draft, republishes, then archives; verify
   staff-only and unrelated-tenant materials never appear. Check Mac import/save dialog.
5. Only after this acceptance deploy/replace the installed app with the same candidate.

Visual checkpoints: `desktop/test-results/knowledge-published.png` and
`desktop/test-results/knowledge-parent-preview.png` (synthetic data).
