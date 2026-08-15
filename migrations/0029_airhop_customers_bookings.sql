-- AirHub customer, consent, enrollment, and booking authority.
--
-- Customer identity and commercial enrollment state live in normalized rows.
-- Booking keeps an immutable applicant snapshot for operational evidence while
-- all active relationships remain tenant-scoped foreign keys.

CREATE TABLE airhop_families (
    community_id              UUID         NOT NULL REFERENCES communities(id),
    organization_id           UUID         NOT NULL,
    id                        UUID         NOT NULL DEFAULT gen_random_uuid(),
    display_name              VARCHAR(200) NOT NULL CHECK (length(btrim(display_name)) > 0),
    primary_representative_id UUID         NOT NULL,
    status                    TEXT         NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
    version                   BIGINT       NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id, organization_id, id),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    CHECK (id <> '00000000-0000-0000-0000-000000000000'::uuid),
    CHECK (primary_representative_id <> '00000000-0000-0000-0000-000000000000'::uuid)
);

CREATE TABLE airhop_representatives (
    community_id              UUID         NOT NULL REFERENCES communities(id),
    organization_id           UUID         NOT NULL,
    id                        UUID         NOT NULL DEFAULT gen_random_uuid(),
    family_id                 UUID         NOT NULL,
    display_name              VARCHAR(160) NOT NULL CHECK (length(btrim(display_name)) > 0),
    phone_normalized          VARCHAR(16)  NOT NULL
        CHECK (phone_normalized ~ '^\+[1-9][0-9]{9,14}$'),
    phone_display             VARCHAR(80)  NOT NULL CHECK (length(btrim(phone_display)) > 0),
    phone_match_digest        BYTEA        NOT NULL CHECK (length(phone_match_digest) = 32),
    preferred_contact_channel TEXT         NOT NULL DEFAULT 'none'
        CHECK (preferred_contact_channel IN ('telegram', 'max', 'whatsapp', 'phone', 'none')),
    status                    TEXT         NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
    version                   BIGINT       NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id, organization_id, id),
    UNIQUE (community_id, organization_id, family_id, id),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    FOREIGN KEY (community_id, organization_id, family_id)
        REFERENCES airhop_families (community_id, organization_id, id),
    CHECK (id <> '00000000-0000-0000-0000-000000000000'::uuid)
);

ALTER TABLE airhop_families
    ADD CONSTRAINT airhop_families_primary_representative_fk
    FOREIGN KEY (community_id, organization_id, id, primary_representative_id)
    REFERENCES airhop_representatives (community_id, organization_id, family_id, id)
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX airhop_representatives_phone_match_idx
    ON airhop_representatives
    (community_id, organization_id, phone_match_digest, status, id);

CREATE TABLE airhop_messenger_accounts (
    community_id           UUID         NOT NULL REFERENCES communities(id),
    organization_id        UUID         NOT NULL,
    id                     UUID         NOT NULL DEFAULT gen_random_uuid(),
    representative_id      UUID         NOT NULL,
    channel                TEXT         NOT NULL CHECK (channel IN ('telegram', 'max', 'whatsapp')),
    external_user_id       VARCHAR(200) NOT NULL CHECK (length(btrim(external_user_id)) > 0),
    external_user_digest   BYTEA        NOT NULL CHECK (length(external_user_digest) = 32),
    display_handle         VARCHAR(200),
    created_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id, organization_id, id),
    UNIQUE (community_id, organization_id, channel, external_user_digest),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    FOREIGN KEY (community_id, organization_id, representative_id)
        REFERENCES airhop_representatives (community_id, organization_id, id),
    CHECK (id <> '00000000-0000-0000-0000-000000000000'::uuid)
);

CREATE TABLE airhop_children (
    community_id           UUID         NOT NULL REFERENCES communities(id),
    organization_id        UUID         NOT NULL,
    id                     UUID         NOT NULL DEFAULT gen_random_uuid(),
    family_id              UUID         NOT NULL,
    display_name           VARCHAR(160) NOT NULL CHECK (length(btrim(display_name)) > 0),
    birth_date             DATE         NOT NULL,
    note                   VARCHAR(4000),
    status                 TEXT         NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
    version                BIGINT       NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id, organization_id, id),
    UNIQUE (community_id, organization_id, family_id, id),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    FOREIGN KEY (community_id, organization_id, family_id)
        REFERENCES airhop_families (community_id, organization_id, id),
    CHECK (id <> '00000000-0000-0000-0000-000000000000'::uuid)
);

CREATE INDEX airhop_children_family_status_idx
    ON airhop_children (community_id, organization_id, family_id, status, display_name, id);

CREATE TABLE airhop_duplicate_candidates (
    community_id        UUID        NOT NULL REFERENCES communities(id),
    organization_id     UUID        NOT NULL,
    id                  UUID        NOT NULL DEFAULT gen_random_uuid(),
    new_entity_type     TEXT        NOT NULL CHECK (new_entity_type IN ('representative', 'child')),
    new_entity_id       UUID        NOT NULL,
    existing_entity_type TEXT       NOT NULL CHECK (existing_entity_type IN ('representative', 'child')),
    existing_entity_id  UUID        NOT NULL,
    signals             TEXT[]      NOT NULL CHECK (cardinality(signals) > 0),
    status              TEXT        NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'merged', 'dismissed')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at         TIMESTAMPTZ,
    resolved_by         VARCHAR(200),
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id, organization_id, id),
    UNIQUE (community_id, organization_id, new_entity_type, new_entity_id,
            existing_entity_type, existing_entity_id),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    CHECK (signals <@ ARRAY['phone', 'messenger', 'name_and_birth_date']::TEXT[]),
    CHECK ((status = 'pending' AND resolved_at IS NULL AND resolved_by IS NULL)
        OR (status <> 'pending' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL)),
    CHECK ((new_entity_type, new_entity_id) <> (existing_entity_type, existing_entity_id))
);

CREATE TABLE airhop_consents (
    community_id        UUID         NOT NULL REFERENCES communities(id),
    organization_id     UUID         NOT NULL,
    id                  UUID         NOT NULL DEFAULT gen_random_uuid(),
    representative_id   UUID         NOT NULL,
    purpose             TEXT         NOT NULL
        CHECK (purpose IN ('public_booking', 'service_contact', 'marketing')),
    channel             TEXT         NOT NULL
        CHECK (channel IN ('web', 'staff_ui', 'fizz', 'import')),
    policy_version      VARCHAR(80)  NOT NULL CHECK (length(btrim(policy_version)) > 0),
    status              TEXT         NOT NULL CHECK (status IN ('granted', 'withdrawn')),
    effective_at        TIMESTAMPTZ  NOT NULL,
    evidence            JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id, organization_id, id),
    UNIQUE (community_id, organization_id, representative_id, id),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    FOREIGN KEY (community_id, organization_id, representative_id)
        REFERENCES airhop_representatives (community_id, organization_id, id),
    CHECK (id <> '00000000-0000-0000-0000-000000000000'::uuid),
    CHECK (jsonb_typeof(evidence) = 'object')
);

CREATE INDEX airhop_consents_subject_timeline_idx
    ON airhop_consents
    (community_id, organization_id, representative_id, purpose, effective_at DESC, id);

CREATE TABLE airhop_tariffs (
    community_id          UUID         NOT NULL REFERENCES communities(id),
    organization_id       UUID         NOT NULL,
    id                    UUID         NOT NULL DEFAULT gen_random_uuid(),
    name                  VARCHAR(160) NOT NULL CHECK (length(btrim(name)) > 0),
    description           VARCHAR(4000),
    price_minor           BIGINT       NOT NULL CHECK (price_minor >= 0),
    currency              CHAR(3)      NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    weekly_schedule_limit SMALLINT     NOT NULL CHECK (weekly_schedule_limit BETWEEN 1 AND 7),
    payment_day_of_month  SMALLINT     CHECK (payment_day_of_month BETWEEN 1 AND 28),
    status                TEXT         NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
    version               BIGINT       NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id, organization_id, id),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    CHECK (id <> '00000000-0000-0000-0000-000000000000'::uuid)
);

CREATE TABLE airhop_enrollments (
    community_id     UUID         NOT NULL REFERENCES communities(id),
    organization_id  UUID         NOT NULL,
    id               UUID         NOT NULL DEFAULT gen_random_uuid(),
    family_id        UUID         NOT NULL,
    child_id         UUID         NOT NULL,
    group_id         UUID         NOT NULL,
    tariff_id        UUID,
    start_date       DATE         NOT NULL,
    end_date         DATE,
    status           TEXT         NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'paused', 'ended')),
    assignment_state TEXT         NOT NULL
        CHECK (assignment_state IN ('needs_assignment', 'configured')),
    source           TEXT         NOT NULL CHECK (source IN ('staff_ui', 'fizz', 'import')),
    created_by       VARCHAR(200) NOT NULL CHECK (length(btrim(created_by)) > 0),
    version          BIGINT       NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id, organization_id, id),
    UNIQUE (community_id, organization_id, id, group_id),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    FOREIGN KEY (community_id, organization_id, family_id, child_id)
        REFERENCES airhop_children (community_id, organization_id, family_id, id),
    FOREIGN KEY (community_id, organization_id, group_id)
        REFERENCES airhop_groups (community_id, organization_id, id),
    FOREIGN KEY (community_id, organization_id, tariff_id)
        REFERENCES airhop_tariffs (community_id, organization_id, id),
    CHECK (id <> '00000000-0000-0000-0000-000000000000'::uuid),
    CHECK (end_date IS NULL OR start_date <= end_date),
    CHECK ((assignment_state = 'needs_assignment' AND tariff_id IS NULL)
        OR (assignment_state = 'configured' AND tariff_id IS NOT NULL))
);

CREATE TABLE airhop_enrollment_schedule (
    community_id       UUID NOT NULL REFERENCES communities(id),
    organization_id    UUID NOT NULL,
    enrollment_id      UUID NOT NULL,
    group_id           UUID NOT NULL,
    recurrence_rule_id UUID NOT NULL,
    weekday            TEXT NOT NULL
        CHECK (weekday IN ('monday', 'tuesday', 'wednesday', 'thursday',
                           'friday', 'saturday', 'sunday')),
    PRIMARY KEY (community_id, organization_id, enrollment_id, recurrence_rule_id, weekday),
    FOREIGN KEY (community_id, organization_id, enrollment_id, group_id)
        REFERENCES airhop_enrollments (community_id, organization_id, id, group_id)
        ON DELETE CASCADE,
    FOREIGN KEY (community_id, organization_id, group_id, recurrence_rule_id)
        REFERENCES airhop_recurrence_rules (community_id, organization_id, group_id, id),
    FOREIGN KEY (community_id, organization_id, recurrence_rule_id, weekday)
        REFERENCES airhop_recurrence_weekdays
        (community_id, organization_id, recurrence_rule_id, weekday)
);

CREATE INDEX airhop_enrollments_group_dates_idx
    ON airhop_enrollments
    (community_id, organization_id, group_id, status, start_date, end_date, child_id);

CREATE TABLE airhop_bookings (
    community_id           UUID         NOT NULL REFERENCES communities(id),
    organization_id        UUID         NOT NULL,
    id                     UUID         NOT NULL DEFAULT gen_random_uuid(),
    family_id              UUID         NOT NULL,
    representative_id      UUID         NOT NULL,
    child_id               UUID         NOT NULL,
    consent_id             UUID         NOT NULL,
    recurrence_rule_id     UUID         NOT NULL,
    original_date          DATE         NOT NULL,
    command_id             UUID         NOT NULL,
    applicant_snapshot     JSONB        NOT NULL,
    visit_kind             TEXT         NOT NULL CHECK (visit_kind IN ('trial', 'single')),
    status                 TEXT         NOT NULL DEFAULT 'pending_confirmation'
        CHECK (status IN ('pending_confirmation', 'confirmed', 'rejected',
                          'cancelled_by_parent', 'cancelled_by_center')),
    transfer_request       JSONB,
    management_token_digest BYTEA       NOT NULL CHECK (length(management_token_digest) = 32),
    management_key_version SMALLINT     NOT NULL CHECK (management_key_version > 0),
    source                 JSONB        NOT NULL,
    actor_kind             TEXT         NOT NULL
        CHECK (actor_kind IN ('staff', 'bot', 'public', 'system', 'import')),
    actor_pubkey           BYTEA        CHECK (actor_pubkey IS NULL OR length(actor_pubkey) = 32),
    created_by             VARCHAR(200) NOT NULL CHECK (length(btrim(created_by)) > 0),
    internal_comment       VARCHAR(4000),
    version                BIGINT       NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id, organization_id, id),
    UNIQUE (community_id, organization_id, management_key_version, management_token_digest),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    FOREIGN KEY (community_id, organization_id, family_id, representative_id)
        REFERENCES airhop_representatives (community_id, organization_id, family_id, id),
    FOREIGN KEY (community_id, organization_id, family_id, child_id)
        REFERENCES airhop_children (community_id, organization_id, family_id, id),
    FOREIGN KEY (community_id, organization_id, representative_id, consent_id)
        REFERENCES airhop_consents (community_id, organization_id, representative_id, id),
    FOREIGN KEY (community_id, organization_id, recurrence_rule_id, original_date)
        REFERENCES airhop_lesson_occurrences
        (community_id, organization_id, recurrence_rule_id, original_date),
    FOREIGN KEY (community_id, organization_id, command_id)
        REFERENCES airhop_commands (community_id, organization_id, id),
    CHECK (id <> '00000000-0000-0000-0000-000000000000'::uuid),
    CHECK (jsonb_typeof(applicant_snapshot) = 'object'),
    CHECK (transfer_request IS NULL OR jsonb_typeof(transfer_request) = 'object'),
    CHECK (jsonb_typeof(source) = 'object'),
    CHECK ((actor_kind IN ('staff', 'bot') AND actor_pubkey IS NOT NULL)
        OR actor_kind IN ('public', 'system', 'import'))
);

CREATE UNIQUE INDEX airhop_bookings_active_child_occurrence_uidx
    ON airhop_bookings
    (community_id, organization_id, child_id, recurrence_rule_id, original_date)
    WHERE status IN ('pending_confirmation', 'confirmed');

CREATE INDEX airhop_bookings_occurrence_capacity_idx
    ON airhop_bookings
    (community_id, organization_id, recurrence_rule_id, original_date, status, child_id);
CREATE INDEX airhop_bookings_family_timeline_idx
    ON airhop_bookings
    (community_id, organization_id, family_id, created_at DESC, id);

-- Consent is historical evidence. A withdrawal is a new row, never a rewrite.
CREATE FUNCTION airhop_consents_append_only() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'AirHub consents are append-only'
        USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_airhop_consents_append_only
    BEFORE UPDATE OR DELETE ON airhop_consents
    FOR EACH ROW EXECUTE FUNCTION airhop_consents_append_only();

CREATE TRIGGER trg_airhop_families_tenant_immutable
    BEFORE UPDATE ON airhop_families
    FOR EACH ROW EXECUTE FUNCTION airhop_tenant_identity_immutable();
CREATE TRIGGER trg_airhop_representatives_tenant_immutable
    BEFORE UPDATE ON airhop_representatives
    FOR EACH ROW EXECUTE FUNCTION airhop_tenant_identity_immutable();
CREATE TRIGGER trg_airhop_messenger_accounts_tenant_immutable
    BEFORE UPDATE ON airhop_messenger_accounts
    FOR EACH ROW EXECUTE FUNCTION airhop_tenant_identity_immutable();
CREATE TRIGGER trg_airhop_children_tenant_immutable
    BEFORE UPDATE ON airhop_children
    FOR EACH ROW EXECUTE FUNCTION airhop_tenant_identity_immutable();
CREATE TRIGGER trg_airhop_duplicate_candidates_tenant_immutable
    BEFORE UPDATE ON airhop_duplicate_candidates
    FOR EACH ROW EXECUTE FUNCTION airhop_tenant_identity_immutable();
CREATE TRIGGER trg_airhop_consents_tenant_immutable
    BEFORE UPDATE ON airhop_consents
    FOR EACH ROW EXECUTE FUNCTION airhop_tenant_identity_immutable();
CREATE TRIGGER trg_airhop_tariffs_tenant_immutable
    BEFORE UPDATE ON airhop_tariffs
    FOR EACH ROW EXECUTE FUNCTION airhop_tenant_identity_immutable();
CREATE TRIGGER trg_airhop_enrollments_tenant_immutable
    BEFORE UPDATE ON airhop_enrollments
    FOR EACH ROW EXECUTE FUNCTION airhop_tenant_identity_immutable();
CREATE TRIGGER trg_airhop_enrollment_schedule_tenant_immutable
    BEFORE UPDATE ON airhop_enrollment_schedule
    FOR EACH ROW EXECUTE FUNCTION airhop_tenant_identity_immutable();
CREATE TRIGGER trg_airhop_bookings_tenant_immutable
    BEFORE UPDATE ON airhop_bookings
    FOR EACH ROW EXECUTE FUNCTION airhop_tenant_identity_immutable();
