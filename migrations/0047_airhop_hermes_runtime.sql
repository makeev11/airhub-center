-- Organization-isolated desired state and durable turn leases for the
-- parent-facing Hermes agent. Provider transport remains outside this schema.

CREATE TABLE airhop_agent_deployments (
    community_id              UUID         NOT NULL REFERENCES communities(id),
    organization_id           UUID         NOT NULL,
    id                        UUID         NOT NULL,
    blueprint_key             TEXT         NOT NULL
        CHECK (blueprint_key = 'airhop.hermes.parent_administrator'),
    blueprint_version         BIGINT       NOT NULL CHECK (blueprint_version > 0),
    role                      TEXT         NOT NULL
        CHECK (role = 'parent_administrator'),
    agent_pubkey              BYTEA        NOT NULL CHECK (octet_length(agent_pubkey) = 32),
    profile_ref               VARCHAR(240) NOT NULL CHECK (length(btrim(profile_ref)) > 0),
    runtime_revision          VARCHAR(240) NOT NULL CHECK (length(btrim(runtime_revision)) > 0),
    persona_revision          VARCHAR(240) NOT NULL CHECK (length(btrim(persona_revision)) > 0),
    skills_revision           VARCHAR(240) NOT NULL CHECK (length(btrim(skills_revision)) > 0),
    model_revision            VARCHAR(240) NOT NULL CHECK (length(btrim(model_revision)) > 0),
    enabled                   BOOLEAN      NOT NULL DEFAULT TRUE,
    paused                    BOOLEAN      NOT NULL DEFAULT FALSE,
    manage_bookings           BOOLEAN      NOT NULL DEFAULT TRUE,
    version                   BIGINT       NOT NULL DEFAULT 1 CHECK (version > 0),
    registered_by_pubkey      BYTEA        NOT NULL CHECK (octet_length(registered_by_pubkey) = 32),
    created_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id, organization_id, id),
    UNIQUE (community_id, agent_pubkey),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    CHECK (id <> '00000000-0000-0000-0000-000000000000'::uuid)
);

CREATE UNIQUE INDEX airhop_agent_deployments_parent_role_idx
    ON airhop_agent_deployments (community_id, organization_id, role);

CREATE TABLE airhop_hermes_turn_receipts (
    community_id              UUID         NOT NULL REFERENCES communities(id),
    organization_id           UUID         NOT NULL,
    id                        UUID         NOT NULL DEFAULT gen_random_uuid(),
    deployment_id             UUID         NOT NULL,
    agent_pubkey              BYTEA        NOT NULL CHECK (octet_length(agent_pubkey) = 32),
    channel_id                UUID         NOT NULL,
    conversation_id           UUID         NOT NULL,
    cycle_id                  UUID         NOT NULL,
    input_batch_id            UUID         NOT NULL,
    source_message_id         BYTEA        NOT NULL CHECK (octet_length(source_message_id) = 32),
    family_id                 UUID,
    representative_id         UUID,
    status                    TEXT         NOT NULL DEFAULT 'leased'
        CHECK (status IN ('leased', 'completed', 'failed', 'cancelled')),
    lease_token               UUID         NOT NULL,
    lease_expires_at          TIMESTAMPTZ  NOT NULL,
    attempt                   INTEGER      NOT NULL DEFAULT 1 CHECK (attempt > 0),
    configuration_snapshot    JSONB        NOT NULL CHECK (jsonb_typeof(configuration_snapshot) = 'object'),
    decision_read_set         JSONB        NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(decision_read_set) = 'array'
            AND jsonb_array_length(decision_read_set) <= 128),
    outcome                   VARCHAR(120),
    error_code                VARCHAR(120),
    started_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),
    finished_at               TIMESTAMPTZ,
    updated_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id, organization_id, id),
    UNIQUE (community_id, organization_id, cycle_id, input_batch_id),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    FOREIGN KEY (community_id, channel_id)
        REFERENCES channels (community_id, id),
    FOREIGN KEY (community_id, organization_id, deployment_id)
        REFERENCES airhop_agent_deployments
            (community_id, organization_id, id),
    FOREIGN KEY (community_id, organization_id, family_id)
        REFERENCES airhop_families (community_id, organization_id, id),
    FOREIGN KEY (community_id, organization_id, family_id, representative_id)
        REFERENCES airhop_representatives
            (community_id, organization_id, family_id, id),
    CHECK (id <> '00000000-0000-0000-0000-000000000000'::uuid),
    CHECK (conversation_id <> '00000000-0000-0000-0000-000000000000'::uuid),
    CHECK (cycle_id <> '00000000-0000-0000-0000-000000000000'::uuid),
    CHECK (input_batch_id <> '00000000-0000-0000-0000-000000000000'::uuid),
    CHECK ((family_id IS NULL) = (representative_id IS NULL)),
    CHECK (lease_expires_at > started_at),
    CHECK (finished_at IS NULL OR finished_at >= started_at),
    CHECK (outcome IS NULL OR length(btrim(outcome)) BETWEEN 1 AND 120),
    CHECK (error_code IS NULL OR length(btrim(error_code)) BETWEEN 1 AND 120),
    CHECK (
        (status = 'leased' AND finished_at IS NULL AND outcome IS NULL AND error_code IS NULL)
        OR (status = 'completed' AND finished_at IS NOT NULL AND outcome IS NOT NULL
            AND error_code IS NULL)
        OR (status IN ('failed', 'cancelled') AND finished_at IS NOT NULL
            AND outcome IS NULL AND error_code IS NOT NULL)
    )
);

CREATE UNIQUE INDEX airhop_hermes_turn_receipts_active_conversation_idx
    ON airhop_hermes_turn_receipts
        (community_id, organization_id, conversation_id)
    WHERE status = 'leased';

CREATE INDEX airhop_hermes_turn_receipts_lease_expiry_idx
    ON airhop_hermes_turn_receipts
        (community_id, organization_id, lease_expires_at, id)
    WHERE status = 'leased';

CREATE INDEX airhop_hermes_turn_receipts_channel_started_idx
    ON airhop_hermes_turn_receipts
        (community_id, channel_id, started_at DESC, id);
