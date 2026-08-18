-- Retry-stable per-payment Buzz confirmation cards.

ALTER TABLE airhop_payment_buzz_summary_state
    ADD COLUMN pending_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD CONSTRAINT airhop_payment_buzz_summary_pending_actions_check
        CHECK (jsonb_typeof(pending_actions) = 'array');

-- One card per payment version and calendar thread. This prevents an unrelated
-- overdue snapshot change from reposting every unchanged confirmation card.
CREATE TABLE airhop_payment_buzz_action_state (
    community_id          UUID        NOT NULL REFERENCES communities(id),
    organization_id       UUID        NOT NULL,
    payment_id            UUID        NOT NULL,
    channel_id            UUID        NOT NULL,
    period_start          DATE        NOT NULL,
    payment_version       BIGINT      NOT NULL CHECK (payment_version > 0),
    event_id              BYTEA       NOT NULL CHECK (length(event_id) = 32),
    event_created_at      TIMESTAMPTZ NOT NULL,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, organization_id, payment_id),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    FOREIGN KEY (community_id, organization_id, payment_id)
        REFERENCES airhop_payment_expectations (community_id, organization_id, id),
    FOREIGN KEY (community_id, channel_id)
        REFERENCES channels (community_id, id),
    CHECK (date_trunc('month', period_start::timestamp)::date = period_start)
);

CREATE INDEX airhop_payment_buzz_action_scope_idx
    ON airhop_payment_buzz_action_state
       (community_id, organization_id, channel_id, period_start);
