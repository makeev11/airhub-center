# Airhop Hermes Parent Runtime

This image runs the hosted, always-on Hermes parent administrator behind the
Buzz ACP supervisor. It combines:

- the pinned upstream Hermes Agent ACP adapter for model execution and durable
  per-channel session history;
- `buzz-acp` for Buzz subscriptions, queueing, typing/presence and supervisor
  turn claims;
- the role-scoped `airhop-agent-mcp` as the only action surface.

The upstream `hermes-acp` preset normally includes shell, filesystem, browser,
code execution and subagent tools. A small fail-closed patch, pinned to the
exact upstream commit, allows this deployment to start with no built-in
toolsets. The ACP-provided Airhop MCP server is then added per session. Image
builds fail if the upstream source no longer matches the reviewed patch.
Python dependencies are installed with that commit's frozen `uv.lock` using
the digest-pinned upstream `uv` image. The final runtime contains neither
`git` nor `uv`.

Required runtime secrets:

```dotenv
AIRHOP_HERMES_RELAY_URL=wss://center.example.com
AIRHOP_HERMES_AGENT_SECRET_KEY=CHANGE_ME_64_HEX
DEEPSEEK_API_KEY=CHANGE_ME
```

The public relay URL is deliberate: its host selects the Center tenant and is
also the exact URL covered by NIP-98 authentication. The Hermes private key and
DeepSeek key exist only in this container.

The persistent volume contains Hermes session history. It must use encrypted
storage and must not be shared between organizations. Airhop family, booking
and knowledge data remain in Airhop and are retrieved through short-lived,
turn-scoped grants; they are not copied into the Hermes profile.

The existing `airhop_send_parent_reply` tool accepts an optional `handoffReason`.
MCP resolves current server-authorized owner/admin recipients already in the
private conversation and signs a separate internal mention. The relay commits
the parent reply, internal notification, and human ownership atomically. The
internal note uses Buzz publication/recovery but never the provider delivery
outbox. If recipients are unavailable or have changed, the entire operation is
rejected rather than falsely promising a handoff. This is the unknown-branch
fallback, not an implementation of branch-specific responsibility settings.

An explicitly tagged staff resume recognizes the current Hermes display name
and creates a new internal trigger receipt. It does not forward the command to
the parent or re-author old parent messages. Its new turn may process unanswered
conversation context immediately, without waiting for another parent message.

ACP sends the bounded input batch to the existing supervisor claim in one
request. The relay selects the newest trigger with a current receipt in the
same channel, skipping internal notes without extra model calls. Deploy the
matching migrated relay before updating this runtime; older single-event
runtime claims remain supported by the new relay.

## Runtime recovery checks

`airhop_get_turn_context` now supplies a bounded server-side transcript (40
messages, 2,000 Unicode characters per message) from the exact leased
conversation. Incoming messages stop at the source event, while parent-facing
replies delivered before this lease attempt are also included. The server stores
`historySnapshotAt` in the turn's configuration snapshot when acquiring or rotating
a lease; context read-set updates and same-lease replays cannot move that cutoff.
Legacy leases fall back to `started_at`, without a schema migration. This avoids
losing an in-flight reply when a parent's follow-up arrives just before delivery,
without consuming newer parent inputs that still belong to queued batches.
The transcript survives session resets and includes
previous ownership cycles, with parent/staff/Hermes and internal-message labels.
This does not enable cross-conversation profile memory or generic history tools.

Every ACP completion releases its exact database lease. A successful tool reply
or human takeover remains authoritative; a model end-turn without a committed
reply is recorded as `runtime_finished_without_reply` and can retry at most three
lease attempts. Busy leases and transport failures defer queued input without
consuming model retries. Panics/aborts are finalized before redispatch too.

Keep `tools.tool_search.enabled: "off"`: this small role has only nine tools.
Upstream's default otherwise hides all nine behind three discovery tools, adding
unnecessary model round trips. The image/live `check-booking-mcp.py` preflight
exercises upstream's actual tool assembler and a negative control reproducing
the old default, without calling a model or sending a parent message.

CI runs the ACP queue/finalization/config tests and the database
`airhop::external_conversation::integration_tests` suite (including ignored
Postgres tests explicitly). Locally use a dedicated database:

```sh
cargo test -p buzz-acp --lib
BUZZ_TEST_DATABASE_URL=postgres://... cargo test -p buzz-db \
  airhop::external_conversation::integration_tests -- --ignored --test-threads=1
python3 deploy/airhop/check-booking-mcp.py <candidate-runtime-image>
```

Exact signed staff commands now include colloquial handover phrases such as
«делай дальше», «давай сам», «работай», «забирай клиента», «забирай», plus common
commands in several languages. This finite fast path is **not** universal
language understanding. Free-form classification is opt-in through
`AIRHOP_STAFF_INTENT_ENABLED=1`, enabled in the reviewed demo rollout after the
operator's explicit approval. Only a relay-authorized, signed staff mention of
this agent (up to 1,000 Unicode characters) goes to DeepSeek v4 Flash. The text
may contain personal data typed by staff; approval must cover that risk. No
conversation history or tools accompany the classifier request. Its output is
limited to resume/pause/other, rechecked against current server-side authority,
ownership version and newer staff messages before changing anything. Provider
failure cannot resume the conversation. Quotes, hypotheticals and capability
questions stay internal; an immediate instruction not to answer means pause.

Parent messages coalesced after a semantic command retain their identity and
are re-fenced into the resumed cycle, so the newest question can be handled.
Staff commands are never parent booking consent. Classifier input expires after
10 minutes; an older command cannot override a newer staff message.

`deploy/airhop/eval-staff-intent.py` is an opt-in, paid synthetic provider eval,
separate from offline CI. Pass the reviewed `staff_intent.rs` source and make
the existing provider key available only inside the isolated runtime. Its 40
examples cover 19 languages, colloquial commands, negatives, quotations and
prompt-injection attempts. Passing this sample is not a guarantee for every
possible language or wording.
CI checks the prompt/case fingerprints against the successful synthetic
baseline without a provider key. Changing either requires repeating the eval.

## Booking in a conversation

Migration 0055 and the matching relay/MCP/runtime add three Parent Administrator
tools: `airhop_save_booking_draft`, `airhop_commit_booking_draft`, and
`airhop_cancel_booking_draft`. `get_turn_context` returns the durable
`bookingDraft` and the `create_booking` capability whenever the existing master
booking-management switch is enabled, including for an unverified new contact.
It still does not grant access to another family's records.

Saving collects a versioned full snapshot without reserving a seat. A ready
draft returns the exact localized summary that must be delivered unchanged
through `airhop_send_parent_reply` as the last parent-facing message. Only a direct
explicit parent confirmation from the authenticated gateway can commit it; the
summary expires after 24 hours.
Edits or changed lesson conditions require a new summary and confirmation.
Staff resume is an internal trigger, not parent consent.

Commit creates identity, consent, booking, audit/outbox and (for a genuinely new
identity) the current-chat binding atomically. The current grant remains
unverified; the next turn obtains the newly bound family. Phone matches create
a separate pending review case, never access to an existing family. Retries are
idempotent per conversation/draft revision. The existing auto-confirm switch
also covers conversational trial bookings after current Core checks. Single
visits have no modeled price yet and remain pending staff confirmation; their
summary never substitutes the trial price.

For a supervised diagnostic session, the same typed backend is available as
`buzz airhop parent --request '{"operation":"get_turn_context"}'`. It requires
the supervisor-issued grant file and the current agent's NIP-98 identity; it
does not accept caller-selected organization, conversation or family scope.
No generic shell tool is added to the parent runtime.
