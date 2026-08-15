-- AirHub operational foundation.
--
-- This migration intentionally creates only the authority/ledger substrate:
-- one AirHub organization per host-resolved Buzz community, idempotent command
-- receipts, append-only domain events, a transactional outbox, and controlled
-- browser-preview import manifests. Schedule/customer/booking tables are added
-- in a later migration after this tenant fence is exercised independently.
--
-- Every tenant-visible key and foreign key leads with community_id. Request
-- handlers must derive that value from TenantContext; organization_id is then
-- looked up server-side and is never trusted from a client selector.

CREATE TABLE airhop_organizations (
    community_id                       UUID         NOT NULL REFERENCES communities(id),
    id                                 UUID         NOT NULL DEFAULT gen_random_uuid(),
    name                               VARCHAR(160) NOT NULL CHECK (length(btrim(name)) > 0),
    locale                             VARCHAR(32)  NOT NULL CHECK (length(btrim(locale)) >= 2),
    time_zone                          VARCHAR(80)  NOT NULL CHECK (length(btrim(time_zone)) > 0),
    default_trial_policy               JSONB        NOT NULL,
    track_attendance_by_default        BOOLEAN      NOT NULL DEFAULT TRUE,
    allow_single_visits_by_default     BOOLEAN      NOT NULL DEFAULT FALSE,
    existing_students_onboarding_status TEXT        NOT NULL DEFAULT 'not_started'
        CHECK (existing_students_onboarding_status IN
               ('not_started', 'in_progress', 'postponed', 'completed')),
    public_booking_purpose             TEXT         NOT NULL DEFAULT 'trial'
        CHECK (public_booking_purpose IN ('trial', 'lesson')),
    public_booking_appearance          TEXT         NOT NULL DEFAULT 'automatic'
        CHECK (public_booking_appearance IN ('automatic', 'light', 'dark')),
    payment_day_of_month               SMALLINT     NOT NULL DEFAULT 5
        CHECK (payment_day_of_month BETWEEN 1 AND 28),
    status                             TEXT         NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
    version                            BIGINT       NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at                         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at                         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id),
    CHECK (id <> '00000000-0000-0000-0000-000000000000'::uuid),
    CHECK (jsonb_typeof(default_trial_policy) = 'object')
);

CREATE TABLE airhop_commands (
    community_id             UUID         NOT NULL REFERENCES communities(id),
    organization_id          UUID         NOT NULL,
    id                       UUID         NOT NULL DEFAULT gen_random_uuid(),
    command_type             VARCHAR(120) NOT NULL CHECK (length(btrim(command_type)) > 0),
    idempotency_digest       BYTEA        NOT NULL CHECK (length(idempotency_digest) = 32),
    request_hash             BYTEA        NOT NULL CHECK (length(request_hash) = 32),
    actor_kind               TEXT         NOT NULL
        CHECK (actor_kind IN ('staff', 'bot', 'public', 'system', 'import')),
    actor_pubkey             BYTEA        CHECK (actor_pubkey IS NULL OR length(actor_pubkey) = 32),
    on_behalf_of_pubkey      BYTEA        CHECK (on_behalf_of_pubkey IS NULL OR length(on_behalf_of_pubkey) = 32),
    agent_pubkey             BYTEA        CHECK (agent_pubkey IS NULL OR length(agent_pubkey) = 32),
    correlation_id           UUID         NOT NULL,
    status                   TEXT         NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'committed', 'failed')),
    result                   JSONB,
    error_code               VARCHAR(120),
    created_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
    finished_at              TIMESTAMPTZ,
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id, organization_id, id),
    UNIQUE (community_id, organization_id, command_type, idempotency_digest),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    CHECK (id <> '00000000-0000-0000-0000-000000000000'::uuid),
    CHECK (
        (actor_kind IN ('staff', 'bot') AND actor_pubkey IS NOT NULL)
        OR actor_kind IN ('public', 'system', 'import')
    ),
    CHECK (
        (status = 'pending' AND finished_at IS NULL AND result IS NULL AND error_code IS NULL)
        OR (status = 'committed' AND finished_at IS NOT NULL AND result IS NOT NULL AND error_code IS NULL)
        OR (status = 'failed' AND finished_at IS NOT NULL AND result IS NULL AND error_code IS NOT NULL)
    )
);

CREATE INDEX airhop_commands_created_idx
    ON airhop_commands (community_id, organization_id, created_at DESC, id);
CREATE INDEX airhop_commands_pending_idx
    ON airhop_commands (community_id, organization_id, created_at, id)
    WHERE status = 'pending';

CREATE TABLE airhop_domain_events (
    community_id             UUID         NOT NULL REFERENCES communities(id),
    organization_id          UUID         NOT NULL,
    id                       UUID         NOT NULL DEFAULT gen_random_uuid(),
    stream_type              VARCHAR(80)  NOT NULL CHECK (length(btrim(stream_type)) > 0),
    stream_id                UUID         NOT NULL,
    stream_version           BIGINT       NOT NULL CHECK (stream_version > 0),
    event_type               VARCHAR(160) NOT NULL CHECK (length(btrim(event_type)) > 0),
    schema_version           INTEGER      NOT NULL DEFAULT 1 CHECK (schema_version > 0),
    occurred_at              TIMESTAMPTZ  NOT NULL,
    recorded_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
    actor_kind               TEXT         NOT NULL
        CHECK (actor_kind IN ('staff', 'bot', 'public', 'system', 'import')),
    actor_pubkey             BYTEA        CHECK (actor_pubkey IS NULL OR length(actor_pubkey) = 32),
    on_behalf_of_pubkey      BYTEA        CHECK (on_behalf_of_pubkey IS NULL OR length(on_behalf_of_pubkey) = 32),
    agent_pubkey             BYTEA        CHECK (agent_pubkey IS NULL OR length(agent_pubkey) = 32),
    causation_id             UUID         NOT NULL,
    correlation_id           UUID         NOT NULL,
    payload                  JSONB        NOT NULL DEFAULT '{}'::jsonb,
    privacy_class            TEXT         NOT NULL DEFAULT 'operational'
        CHECK (privacy_class IN ('public', 'operational', 'pii', 'sensitive_child')),
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id, organization_id, id),
    UNIQUE (community_id, organization_id, stream_type, stream_id, stream_version),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    FOREIGN KEY (community_id, organization_id, causation_id)
        REFERENCES airhop_commands (community_id, organization_id, id),
    CHECK (id <> '00000000-0000-0000-0000-000000000000'::uuid),
    CHECK (stream_id <> '00000000-0000-0000-0000-000000000000'::uuid),
    CHECK (jsonb_typeof(payload) = 'object'),
    CHECK (
        (actor_kind IN ('staff', 'bot') AND actor_pubkey IS NOT NULL)
        OR actor_kind IN ('public', 'system', 'import')
    )
);

CREATE INDEX airhop_domain_events_timeline_idx
    ON airhop_domain_events (community_id, organization_id, occurred_at, id);
CREATE INDEX airhop_domain_events_type_idx
    ON airhop_domain_events (community_id, organization_id, event_type, occurred_at DESC, id);

CREATE TABLE airhop_outbox (
    community_id             UUID         NOT NULL REFERENCES communities(id),
    organization_id          UUID         NOT NULL,
    id                       UUID         NOT NULL DEFAULT gen_random_uuid(),
    event_id                 UUID         NOT NULL,
    destination              VARCHAR(120) NOT NULL CHECK (length(btrim(destination)) > 0),
    redacted_payload         JSONB        NOT NULL DEFAULT '{}'::jsonb,
    attempts                 INTEGER      NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    not_before               TIMESTAMPTZ  NOT NULL DEFAULT now(),
    published_at             TIMESTAMPTZ,
    last_error_code          VARCHAR(120),
    created_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id, organization_id, event_id, destination),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    FOREIGN KEY (community_id, organization_id, event_id)
        REFERENCES airhop_domain_events (community_id, organization_id, id),
    CHECK (id <> '00000000-0000-0000-0000-000000000000'::uuid),
    CHECK (jsonb_typeof(redacted_payload) = 'object'),
    CHECK (published_at IS NULL OR published_at >= created_at)
);

CREATE INDEX airhop_outbox_pending_idx
    ON airhop_outbox (community_id, organization_id, not_before, id)
    WHERE published_at IS NULL;

CREATE TABLE airhop_import_runs (
    community_id             UUID        NOT NULL REFERENCES communities(id),
    organization_id          UUID        NOT NULL,
    id                       UUID        NOT NULL DEFAULT gen_random_uuid(),
    source_hash              BYTEA       NOT NULL CHECK (length(source_hash) = 32),
    source_schema_version    INTEGER     NOT NULL CHECK (source_schema_version > 0),
    status                   TEXT        NOT NULL DEFAULT 'validated'
        CHECK (status IN ('validated', 'committed', 'rejected')),
    entity_counts            JSONB       NOT NULL DEFAULT '{}'::jsonb,
    validation_report        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    reconciliation_report    JSONB,
    actor_pubkey             BYTEA       NOT NULL CHECK (length(actor_pubkey) = 32),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    committed_at             TIMESTAMPTZ,
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id, organization_id, id),
    UNIQUE (community_id, organization_id, source_hash),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    CHECK (id <> '00000000-0000-0000-0000-000000000000'::uuid),
    CHECK (jsonb_typeof(entity_counts) = 'object'),
    CHECK (jsonb_typeof(validation_report) = 'object'),
    CHECK (reconciliation_report IS NULL OR jsonb_typeof(reconciliation_report) = 'object'),
    CHECK (
        (status = 'committed' AND committed_at IS NOT NULL)
        OR (status <> 'committed' AND committed_at IS NULL)
    )
);

CREATE TABLE airhop_legacy_ids (
    community_id             UUID         NOT NULL REFERENCES communities(id),
    organization_id          UUID         NOT NULL,
    import_run_id            UUID         NOT NULL,
    entity_type              VARCHAR(80)  NOT NULL CHECK (length(btrim(entity_type)) > 0),
    legacy_id                VARCHAR(128) NOT NULL CHECK (length(btrim(legacy_id)) > 0),
    entity_id                UUID         NOT NULL,
    created_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, organization_id, entity_type, legacy_id),
    UNIQUE (community_id, organization_id, entity_type, entity_id),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    FOREIGN KEY (community_id, organization_id, import_run_id)
        REFERENCES airhop_import_runs (community_id, organization_id, id),
    CHECK (entity_id <> '00000000-0000-0000-0000-000000000000'::uuid)
);

-- Tenant identity is immutable after insertion. This makes accidental
-- re-tenanting fail at the database boundary even before composite FKs are
-- considered.
CREATE FUNCTION airhop_organization_identity_immutable() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.community_id IS DISTINCT FROM OLD.community_id
       OR NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'AirHub organization tenant identity is immutable'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_airhop_organization_identity_immutable
    BEFORE UPDATE ON airhop_organizations
    FOR EACH ROW EXECUTE FUNCTION airhop_organization_identity_immutable();

-- Domain events are evidence, not mutable state. Corrections append a new
-- semantic event; they never rewrite or delete historical rows.
CREATE FUNCTION airhop_domain_events_append_only() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'AirHub domain events are append-only'
        USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_airhop_domain_events_append_only
    BEFORE UPDATE OR DELETE ON airhop_domain_events
    FOR EACH ROW EXECUTE FUNCTION airhop_domain_events_append_only();

CREATE FUNCTION airhop_tenant_identity_immutable() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.community_id IS DISTINCT FROM OLD.community_id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
        RAISE EXCEPTION 'AirHub tenant identity is immutable'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_airhop_commands_tenant_immutable
    BEFORE UPDATE ON airhop_commands
    FOR EACH ROW EXECUTE FUNCTION airhop_tenant_identity_immutable();
CREATE TRIGGER trg_airhop_domain_events_tenant_immutable
    BEFORE UPDATE ON airhop_domain_events
    FOR EACH ROW EXECUTE FUNCTION airhop_tenant_identity_immutable();
CREATE TRIGGER trg_airhop_outbox_tenant_immutable
    BEFORE UPDATE ON airhop_outbox
    FOR EACH ROW EXECUTE FUNCTION airhop_tenant_identity_immutable();
CREATE TRIGGER trg_airhop_import_runs_tenant_immutable
    BEFORE UPDATE ON airhop_import_runs
    FOR EACH ROW EXECUTE FUNCTION airhop_tenant_identity_immutable();
CREATE TRIGGER trg_airhop_legacy_ids_tenant_immutable
    BEFORE UPDATE ON airhop_legacy_ids
    FOR EACH ROW EXECUTE FUNCTION airhop_tenant_identity_immutable();
