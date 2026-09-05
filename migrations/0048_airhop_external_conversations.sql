-- Canonical Buzz conversation ownership for the parent-facing Hermes agent.
-- Messenger providers remain projections of these private Buzz channels.

CREATE TABLE airhop_external_conversations (
    community_id              UUID        NOT NULL REFERENCES communities(id),
    organization_id           UUID        NOT NULL,
    id                        UUID        NOT NULL,
    channel_id                UUID        NOT NULL,
    family_id                 UUID,
    representative_id         UUID,
    parent_pubkey             BYTEA       NOT NULL CHECK (octet_length(parent_pubkey) = 32),
    current_cycle_id          UUID        NOT NULL,
    owner                     TEXT        NOT NULL DEFAULT 'hermes'
        CHECK (owner IN ('hermes', 'human')),
    hermes_paused             BOOLEAN     NOT NULL DEFAULT FALSE,
    status                    TEXT        NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
    control_version           BIGINT      NOT NULL DEFAULT 1 CHECK (control_version > 0),
    opened_by_pubkey          BYTEA       NOT NULL CHECK (octet_length(opened_by_pubkey) = 32),
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id, organization_id, id),
    UNIQUE (community_id, channel_id),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    FOREIGN KEY (community_id, channel_id)
        REFERENCES channels (community_id, id),
    FOREIGN KEY (community_id, organization_id, family_id)
        REFERENCES airhop_families (community_id, organization_id, id),
    FOREIGN KEY (community_id, organization_id, family_id, representative_id)
        REFERENCES airhop_representatives
            (community_id, organization_id, family_id, id),
    CHECK (id <> '00000000-0000-0000-0000-000000000000'::uuid),
    CHECK (current_cycle_id <> '00000000-0000-0000-0000-000000000000'::uuid),
    CHECK ((family_id IS NULL) = (representative_id IS NULL)),
    CHECK (owner = 'human' OR NOT hermes_paused)
);

CREATE TABLE airhop_external_conversation_cycles (
    community_id              UUID        NOT NULL REFERENCES communities(id),
    organization_id           UUID        NOT NULL,
    conversation_id           UUID        NOT NULL,
    id                        UUID        NOT NULL,
    sequence                  BIGINT      NOT NULL CHECK (sequence > 0),
    started_by                TEXT        NOT NULL
        CHECK (started_by IN ('registration', 'staff_resume')),
    trigger_event_id          BYTEA       CHECK (
        trigger_event_id IS NULL OR octet_length(trigger_event_id) = 32
    ),
    ended_reason              VARCHAR(120),
    started_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at                  TIMESTAMPTZ,
    PRIMARY KEY (community_id, conversation_id, id),
    UNIQUE (community_id, organization_id, conversation_id, id),
    UNIQUE (community_id, conversation_id, sequence),
    FOREIGN KEY (community_id, organization_id, conversation_id)
        REFERENCES airhop_external_conversations
            (community_id, organization_id, id),
    CHECK (id <> '00000000-0000-0000-0000-000000000000'::uuid),
    CHECK (ended_reason IS NULL OR length(btrim(ended_reason)) BETWEEN 1 AND 120),
    CHECK ((ended_at IS NULL) = (ended_reason IS NULL)),
    CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE UNIQUE INDEX airhop_external_conversation_cycles_open_idx
    ON airhop_external_conversation_cycles (community_id, conversation_id)
    WHERE ended_at IS NULL;

CREATE TABLE airhop_external_inbound_receipts (
    community_id              UUID        NOT NULL REFERENCES communities(id),
    organization_id           UUID        NOT NULL,
    conversation_id           UUID        NOT NULL,
    event_id                  BYTEA       NOT NULL CHECK (octet_length(event_id) = 32),
    cycle_id                  UUID        NOT NULL,
    control_version           BIGINT      NOT NULL CHECK (control_version > 0),
    decision                  TEXT        NOT NULL
        CHECK (decision IN ('trigger', 'suppressed')),
    reason                    VARCHAR(120) NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 120),
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, event_id),
    UNIQUE (community_id, organization_id, event_id),
    FOREIGN KEY (community_id, organization_id, conversation_id)
        REFERENCES airhop_external_conversations
            (community_id, organization_id, id)
);

CREATE INDEX airhop_external_inbound_receipts_conversation_idx
    ON airhop_external_inbound_receipts
        (community_id, conversation_id, created_at DESC);

CREATE TABLE airhop_hermes_outbound_intents (
    community_id              UUID        NOT NULL REFERENCES communities(id),
    organization_id           UUID        NOT NULL,
    id                        UUID        NOT NULL DEFAULT gen_random_uuid(),
    deployment_id             UUID        NOT NULL,
    turn_id                   UUID        NOT NULL,
    conversation_id           UUID        NOT NULL,
    cycle_id                  UUID        NOT NULL,
    control_version           BIGINT      NOT NULL CHECK (control_version > 0),
    sequence                  SMALLINT     NOT NULL CHECK (sequence BETWEEN 1 AND 3),
    event_id                  BYTEA       NOT NULL CHECK (octet_length(event_id) = 32),
    event_json                JSONB       NOT NULL CHECK (jsonb_typeof(event_json) = 'object'),
    status                    TEXT        NOT NULL DEFAULT 'committed'
        CHECK (status IN ('committed', 'published', 'failed')),
    failure_code              VARCHAR(120),
    committed_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at              TIMESTAMPTZ,
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id, organization_id, id),
    UNIQUE (community_id, event_id),
    UNIQUE (community_id, turn_id, sequence),
    FOREIGN KEY (community_id, organization_id, deployment_id)
        REFERENCES airhop_agent_deployments
            (community_id, organization_id, id),
    FOREIGN KEY (community_id, organization_id, turn_id)
        REFERENCES airhop_hermes_turn_receipts
            (community_id, organization_id, id),
    FOREIGN KEY (community_id, organization_id, conversation_id)
        REFERENCES airhop_external_conversations
            (community_id, organization_id, id),
    CHECK (
        (status = 'committed' AND published_at IS NULL AND failure_code IS NULL)
        OR (status = 'published' AND published_at IS NOT NULL AND failure_code IS NULL)
        OR (status = 'failed' AND published_at IS NULL AND failure_code IS NOT NULL)
    )
);

CREATE INDEX airhop_hermes_outbound_intents_recovery_idx
    ON airhop_hermes_outbound_intents
        (community_id, organization_id, committed_at, id)
    WHERE status = 'committed';
