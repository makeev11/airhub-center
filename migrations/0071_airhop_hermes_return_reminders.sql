-- Durable, server-authored reminders for human-owned parent conversations.
-- The counter advances only while Hermes is available and resets on resume.

ALTER TABLE airhop_external_conversations
    ADD COLUMN human_staff_outbound_count BIGINT NOT NULL DEFAULT 0
        CHECK (human_staff_outbound_count >= 0);

CREATE TABLE airhop_human_takeover_reminders (
    community_id        UUID        NOT NULL REFERENCES communities(id),
    organization_id     UUID        NOT NULL,
    conversation_id     UUID        NOT NULL,
    cycle_id            UUID        NOT NULL,
    ordinal             BIGINT      NOT NULL CHECK (ordinal > 0 AND ordinal % 3 = 0),
    source_event_id     BYTEA       NOT NULL CHECK (octet_length(source_event_id) = 32),
    reminder_event_id   BYTEA       NOT NULL CHECK (octet_length(reminder_event_id) = 32),
    dispatched_at       TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, conversation_id, cycle_id, ordinal),
    UNIQUE (community_id, source_event_id),
    UNIQUE (community_id, reminder_event_id),
    FOREIGN KEY (community_id, organization_id, conversation_id)
        REFERENCES airhop_external_conversations
            (community_id, organization_id, id),
    FOREIGN KEY (community_id, organization_id, conversation_id, cycle_id)
        REFERENCES airhop_external_conversation_cycles
            (community_id, organization_id, conversation_id, id)
);

CREATE INDEX airhop_human_takeover_reminders_pending_idx
    ON airhop_human_takeover_reminders (created_at, community_id)
    WHERE dispatched_at IS NULL;
