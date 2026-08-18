-- Retry-stable monthly AirHub analytics reports in a dedicated Buzz stream.

ALTER TABLE airhop_organizations
    ADD COLUMN analytics_buzz_channel_id UUID,
    ADD CONSTRAINT airhop_organizations_analytics_buzz_channel_fk
        FOREIGN KEY (community_id, analytics_buzz_channel_id)
        REFERENCES channels (community_id, id);

CREATE TABLE airhop_analytics_buzz_report_state (
    community_id          UUID        NOT NULL REFERENCES communities(id),
    organization_id       UUID        NOT NULL,
    channel_id            UUID        NOT NULL,
    period_start          DATE        NOT NULL,
    root_event_id         BYTEA       CHECK (root_event_id IS NULL OR length(root_event_id) = 32),
    root_event_created_at TIMESTAMPTZ,
    last_report_event_id  BYTEA       CHECK (last_report_event_id IS NULL OR length(last_report_event_id) = 32),
    last_digest           BYTEA       CHECK (last_digest IS NULL OR length(last_digest) = 32),
    pending_id            UUID,
    pending_digest        BYTEA       CHECK (pending_digest IS NULL OR length(pending_digest) = 32),
    pending_root_content  TEXT,
    pending_content       TEXT,
    pending_created_at    TIMESTAMPTZ,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, organization_id),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    FOREIGN KEY (community_id, channel_id)
        REFERENCES channels (community_id, id),
    CHECK (date_trunc('month', period_start::timestamp)::date = period_start),
    CHECK (
        (root_event_id IS NULL AND root_event_created_at IS NULL)
        OR (root_event_id IS NOT NULL AND root_event_created_at IS NOT NULL)
    ),
    CHECK (
        (pending_id IS NULL AND pending_digest IS NULL AND pending_root_content IS NULL
                            AND pending_content IS NULL AND pending_created_at IS NULL)
        OR (pending_id IS NOT NULL AND pending_digest IS NOT NULL
                                AND pending_root_content IS NOT NULL
                                AND pending_content IS NOT NULL
                                AND pending_created_at IS NOT NULL)
    )
);

CREATE INDEX airhop_analytics_buzz_report_pending_idx
    ON airhop_analytics_buzz_report_state
       (community_id, organization_id, pending_created_at)
    WHERE pending_id IS NOT NULL;
