-- Exact-replay guard for trusted Welcome agent turn-state transitions.

CREATE TABLE airhop_welcome_turn_receipts (
    community_id UUID NOT NULL REFERENCES communities(id),
    organization_id UUID NOT NULL,
    channel_id UUID NOT NULL,
    event_id BYTEA NOT NULL CHECK (octet_length(event_id) = 32),
    event_kind INTEGER NOT NULL CHECK (event_kind IN (9, 21021)),
    author_pubkey BYTEA NOT NULL CHECK (octet_length(author_pubkey) = 32),
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, event_id),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    FOREIGN KEY (community_id, channel_id)
        REFERENCES channels (community_id, id)
);

CREATE INDEX airhop_welcome_turn_receipts_channel_applied_idx
    ON airhop_welcome_turn_receipts (
        community_id, channel_id, applied_at DESC
    );
