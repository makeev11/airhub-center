-- Provider-neutral AirHop Channel Gateway and recoverable external delivery.
--
-- Provider credentials remain in the separately deployed Hermes gateway. The
-- relay stores desired connection state, exact conversation routing, durable
-- provider-event deduplication, and an external-message outbox. Both Hermes
-- and staff messages use the same outbox contract.

CREATE TABLE airhop_channel_connections (
    community_id          UUID         NOT NULL REFERENCES communities(id),
    organization_id       UUID         NOT NULL,
    id                    UUID         NOT NULL,
    provider              VARCHAR(40)  NOT NULL CHECK (length(btrim(provider)) > 0),
    display_name          VARCHAR(160) NOT NULL CHECK (length(btrim(display_name)) > 0),
    connector_pubkey      BYTEA        NOT NULL CHECK (octet_length(connector_pubkey) = 32),
    status                TEXT         NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'paused', 'disabled')),
    hermes_enabled        BOOLEAN      NOT NULL DEFAULT TRUE,
    capabilities          JSONB        NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(capabilities) = 'object'),
    observed_status       TEXT         NOT NULL DEFAULT 'offline'
        CHECK (observed_status IN ('offline', 'connecting', 'ready', 'degraded')),
    observed_capabilities JSONB        NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(observed_capabilities) = 'object'),
    last_heartbeat_at     TIMESTAMPTZ,
    last_error_code       VARCHAR(120),
    version               BIGINT       NOT NULL DEFAULT 1 CHECK (version > 0),
    updated_by_pubkey     BYTEA        NOT NULL CHECK (octet_length(updated_by_pubkey) = 32),
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id, organization_id, id),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    CHECK (id <> '00000000-0000-0000-0000-000000000000'::uuid)
);

CREATE INDEX airhop_channel_connections_connector_idx
    ON airhop_channel_connections
        (community_id, connector_pubkey, status, provider, id);

CREATE TABLE airhop_external_conversation_routes (
    community_id          UUID         NOT NULL REFERENCES communities(id),
    organization_id       UUID         NOT NULL,
    conversation_id       UUID         NOT NULL,
    connection_id         UUID         NOT NULL,
    provider_chat_id      VARCHAR(300) NOT NULL CHECK (length(btrim(provider_chat_id)) > 0),
    provider_chat_digest  BYTEA        NOT NULL CHECK (octet_length(provider_chat_digest) = 32),
    status                TEXT         NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'paused', 'disabled')),
    version               BIGINT       NOT NULL DEFAULT 1 CHECK (version > 0),
    routing_version       BIGINT       NOT NULL DEFAULT 1 CHECK (routing_version > 0),
    updated_by_pubkey     BYTEA        NOT NULL CHECK (octet_length(updated_by_pubkey) = 32),
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, conversation_id),
    UNIQUE (community_id, organization_id, conversation_id),
    UNIQUE (community_id, organization_id, connection_id, provider_chat_digest),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    FOREIGN KEY (community_id, organization_id, conversation_id)
        REFERENCES airhop_external_conversations
            (community_id, organization_id, id),
    FOREIGN KEY (community_id, organization_id, connection_id)
        REFERENCES airhop_channel_connections
            (community_id, organization_id, id)
);

CREATE TABLE airhop_gateway_inbound_receipts (
    community_id          UUID        NOT NULL REFERENCES communities(id),
    organization_id       UUID        NOT NULL,
    id                    UUID        NOT NULL DEFAULT gen_random_uuid(),
    connection_id         UUID        NOT NULL,
    conversation_id       UUID        NOT NULL,
    provider_event_digest BYTEA       NOT NULL CHECK (octet_length(provider_event_digest) = 32),
    buzz_event_id         BYTEA       NOT NULL CHECK (octet_length(buzz_event_id) = 32),
    connector_pubkey      BYTEA       NOT NULL CHECK (octet_length(connector_pubkey) = 32),
    received_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id, organization_id, id),
    UNIQUE (community_id, organization_id, connection_id, provider_event_digest),
    UNIQUE (community_id, buzz_event_id),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    FOREIGN KEY (community_id, organization_id, connection_id)
        REFERENCES airhop_channel_connections
            (community_id, organization_id, id),
    FOREIGN KEY (community_id, organization_id, conversation_id)
        REFERENCES airhop_external_conversations
            (community_id, organization_id, id)
);

CREATE TABLE airhop_external_message_outbox (
    community_id          UUID        NOT NULL REFERENCES communities(id),
    organization_id       UUID        NOT NULL,
    id                    UUID        NOT NULL DEFAULT gen_random_uuid(),
    conversation_id       UUID        NOT NULL,
    connection_id         UUID        NOT NULL,
    route_version         BIGINT      NOT NULL CHECK (route_version > 0),
    source_intent_id      UUID,
    buzz_event_id         BYTEA       NOT NULL CHECK (octet_length(buzz_event_id) = 32),
    event_json            JSONB       NOT NULL CHECK (jsonb_typeof(event_json) = 'object'),
    actor_kind            TEXT        NOT NULL CHECK (actor_kind IN ('hermes', 'staff', 'system')),
    batch_key             BYTEA       NOT NULL CHECK (octet_length(batch_key) = 32),
    sequence              SMALLINT    NOT NULL DEFAULT 1 CHECK (sequence BETWEEN 1 AND 100),
    status                TEXT        NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'leased', 'delivered', 'failed', 'superseded')),
    attempts              INTEGER     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    lease_token           UUID,
    leased_by_pubkey      BYTEA CHECK (leased_by_pubkey IS NULL OR octet_length(leased_by_pubkey) = 32),
    lease_expires_at      TIMESTAMPTZ,
    provider_message_id   VARCHAR(300),
    last_error_code       VARCHAR(120),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivered_at          TIMESTAMPTZ,
    failed_at             TIMESTAMPTZ,
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id, organization_id, id),
    UNIQUE (community_id, buzz_event_id),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    FOREIGN KEY (community_id, organization_id, conversation_id)
        REFERENCES airhop_external_conversations
            (community_id, organization_id, id),
    FOREIGN KEY (community_id, organization_id, connection_id)
        REFERENCES airhop_channel_connections
            (community_id, organization_id, id),
    FOREIGN KEY (community_id, organization_id, source_intent_id)
        REFERENCES airhop_hermes_outbound_intents
            (community_id, organization_id, id),
    CHECK (
        (lease_token IS NULL AND leased_by_pubkey IS NULL AND lease_expires_at IS NULL)
        OR (lease_token IS NOT NULL AND leased_by_pubkey IS NOT NULL AND lease_expires_at IS NOT NULL)
    ),
    CHECK (
        (status = 'delivered' AND delivered_at IS NOT NULL AND failed_at IS NULL)
        OR (status = 'failed' AND delivered_at IS NULL AND failed_at IS NOT NULL)
        OR (status IN ('pending', 'leased', 'superseded') AND delivered_at IS NULL AND failed_at IS NULL)
    )
);

CREATE INDEX airhop_external_message_outbox_claim_idx
    ON airhop_external_message_outbox
        (community_id, connection_id, next_attempt_at, created_at, batch_key, sequence, id)
    WHERE status IN ('pending', 'leased');

CREATE TABLE airhop_external_message_delivery_attempts (
    community_id          UUID         NOT NULL REFERENCES communities(id),
    organization_id       UUID         NOT NULL,
    id                    UUID         NOT NULL DEFAULT gen_random_uuid(),
    outbox_id             UUID         NOT NULL,
    lease_token           UUID         NOT NULL,
    connector_pubkey      BYTEA        NOT NULL CHECK (octet_length(connector_pubkey) = 32),
    outcome               TEXT         NOT NULL CHECK (outcome IN ('delivered', 'retry', 'failed')),
    provider_message_id   VARCHAR(300),
    error_code            VARCHAR(120),
    attempted_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id, organization_id, outbox_id, lease_token),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    FOREIGN KEY (community_id, organization_id, outbox_id)
        REFERENCES airhop_external_message_outbox
            (community_id, organization_id, id),
    CHECK (
        (outcome = 'delivered' AND error_code IS NULL)
        OR (outcome IN ('retry', 'failed') AND error_code IS NOT NULL)
    )
);

CREATE INDEX airhop_external_message_delivery_attempts_timeline_idx
    ON airhop_external_message_delivery_attempts
        (community_id, organization_id, outbox_id, attempted_at, id);

CREATE FUNCTION airhop_external_message_delivery_attempts_append_only() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'AirHop external message delivery attempts are append-only'
        USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_airhop_external_message_delivery_attempts_append_only
    BEFORE UPDATE OR DELETE ON airhop_external_message_delivery_attempts
    FOR EACH ROW EXECUTE FUNCTION airhop_external_message_delivery_attempts_append_only();

ALTER TABLE airhop_hermes_outbound_intents
    ADD COLUMN publication_attempts INTEGER NOT NULL DEFAULT 0 CHECK (publication_attempts >= 0),
    ADD COLUMN next_publication_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN last_publication_error_code VARCHAR(120);

DROP INDEX airhop_hermes_outbound_intents_recovery_idx;
CREATE INDEX airhop_hermes_outbound_intents_recovery_idx
    ON airhop_hermes_outbound_intents
        (next_publication_attempt_at, committed_at, id)
    WHERE status = 'committed';
