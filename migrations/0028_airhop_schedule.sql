-- AirHub authoritative schedule and rebuildable occurrence read model.
--
-- Recurrence rules and exceptions are operational source rows. Materialized
-- occurrences are a rebuildable read model, but they are also the transaction
-- serialization point for capacity-sensitive booking/enrollment commands.

CREATE TABLE airhop_branches (
    community_id             UUID         NOT NULL REFERENCES communities(id),
    organization_id          UUID         NOT NULL,
    id                       UUID         NOT NULL DEFAULT gen_random_uuid(),
    name                     VARCHAR(160) NOT NULL CHECK (length(btrim(name)) > 0),
    address                  VARCHAR(500) NOT NULL CHECK (length(btrim(address)) > 0),
    default_buzz_channel_id  UUID,
    status                   TEXT         NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
    version                  BIGINT       NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id, organization_id, id),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    CHECK (id <> '00000000-0000-0000-0000-000000000000'::uuid)
);

CREATE TABLE airhop_branch_working_periods (
    community_id             UUID        NOT NULL REFERENCES communities(id),
    organization_id          UUID        NOT NULL,
    branch_id                UUID        NOT NULL,
    weekday                  TEXT        NOT NULL
        CHECK (weekday IN ('monday', 'tuesday', 'wednesday', 'thursday',
                           'friday', 'saturday', 'sunday')),
    ordinal                  SMALLINT    NOT NULL CHECK (ordinal >= 0),
    start_time               TIME        NOT NULL,
    end_time                 TIME        NOT NULL,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, organization_id, branch_id, weekday, ordinal),
    FOREIGN KEY (community_id, organization_id, branch_id)
        REFERENCES airhop_branches (community_id, organization_id, id) ON DELETE CASCADE,
    CHECK (start_time < end_time)
);

CREATE TABLE airhop_rooms (
    community_id             UUID         NOT NULL REFERENCES communities(id),
    organization_id          UUID         NOT NULL,
    id                       UUID         NOT NULL DEFAULT gen_random_uuid(),
    branch_id                UUID         NOT NULL,
    name                     VARCHAR(160) NOT NULL CHECK (length(btrim(name)) > 0),
    status                   TEXT         NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
    version                  BIGINT       NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id, organization_id, id),
    UNIQUE (community_id, organization_id, branch_id, id),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    FOREIGN KEY (community_id, organization_id, branch_id)
        REFERENCES airhop_branches (community_id, organization_id, id),
    CHECK (id <> '00000000-0000-0000-0000-000000000000'::uuid)
);

CREATE INDEX airhop_rooms_branch_idx
    ON airhop_rooms (community_id, organization_id, branch_id, status, name);

CREATE TABLE airhop_teachers (
    community_id             UUID         NOT NULL REFERENCES communities(id),
    organization_id          UUID         NOT NULL,
    id                       UUID         NOT NULL DEFAULT gen_random_uuid(),
    display_name             VARCHAR(160) NOT NULL CHECK (length(btrim(display_name)) > 0),
    buzz_username            VARCHAR(160),
    status                   TEXT         NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
    version                  BIGINT       NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id, organization_id, id),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    CHECK (id <> '00000000-0000-0000-0000-000000000000'::uuid)
);

CREATE TABLE airhop_groups (
    community_id                  UUID         NOT NULL REFERENCES communities(id),
    organization_id               UUID         NOT NULL,
    id                            UUID         NOT NULL DEFAULT gen_random_uuid(),
    branch_id                     UUID         NOT NULL,
    room_id                       UUID,
    name                          VARCHAR(200) NOT NULL CHECK (length(btrim(name)) > 0),
    description                   TEXT,
    min_age_months                INTEGER      CHECK (min_age_months >= 0),
    max_age_months                INTEGER      CHECK (max_age_months >= 0),
    capacity                      INTEGER      CHECK (capacity > 0),
    trial_policy_override         JSONB,
    track_attendance_override     BOOLEAN,
    allow_single_visits_override  BOOLEAN,
    status                        TEXT         NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
    version                       BIGINT       NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at                    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at                    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id, organization_id, id),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    FOREIGN KEY (community_id, organization_id, branch_id)
        REFERENCES airhop_branches (community_id, organization_id, id),
    FOREIGN KEY (community_id, organization_id, branch_id, room_id)
        REFERENCES airhop_rooms (community_id, organization_id, branch_id, id),
    CHECK (id <> '00000000-0000-0000-0000-000000000000'::uuid),
    CHECK (min_age_months IS NULL OR max_age_months IS NULL OR min_age_months <= max_age_months),
    CHECK (trial_policy_override IS NULL OR jsonb_typeof(trial_policy_override) = 'object')
);

CREATE INDEX airhop_groups_branch_status_idx
    ON airhop_groups (community_id, organization_id, branch_id, status, name);

CREATE TABLE airhop_group_teachers (
    community_id             UUID        NOT NULL REFERENCES communities(id),
    organization_id          UUID        NOT NULL,
    group_id                 UUID        NOT NULL,
    teacher_id               UUID        NOT NULL,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, organization_id, group_id, teacher_id),
    FOREIGN KEY (community_id, organization_id, group_id)
        REFERENCES airhop_groups (community_id, organization_id, id) ON DELETE CASCADE,
    FOREIGN KEY (community_id, organization_id, teacher_id)
        REFERENCES airhop_teachers (community_id, organization_id, id)
);

CREATE TABLE airhop_recurrence_rules (
    community_id             UUID        NOT NULL REFERENCES communities(id),
    organization_id          UUID        NOT NULL,
    id                       UUID        NOT NULL DEFAULT gen_random_uuid(),
    group_id                 UUID        NOT NULL,
    starts_on                DATE        NOT NULL,
    ends_on                  DATE        NOT NULL,
    start_time               TIME        NOT NULL,
    end_time                 TIME        NOT NULL,
    branch_id_override       UUID,
    room_override_set        BOOLEAN     NOT NULL DEFAULT FALSE,
    room_id_override         UUID,
    teacher_override_set     BOOLEAN     NOT NULL DEFAULT FALSE,
    capacity_override_set    BOOLEAN     NOT NULL DEFAULT FALSE,
    capacity_override        INTEGER     CHECK (capacity_override > 0),
    trial_policy_override    JSONB,
    status                   TEXT        NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
    version                  BIGINT      NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id, organization_id, id),
    UNIQUE (community_id, organization_id, group_id, id),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    FOREIGN KEY (community_id, organization_id, group_id)
        REFERENCES airhop_groups (community_id, organization_id, id),
    FOREIGN KEY (community_id, organization_id, branch_id_override)
        REFERENCES airhop_branches (community_id, organization_id, id),
    FOREIGN KEY (community_id, organization_id, room_id_override)
        REFERENCES airhop_rooms (community_id, organization_id, id),
    CHECK (id <> '00000000-0000-0000-0000-000000000000'::uuid),
    CHECK (starts_on <= ends_on),
    CHECK (start_time < end_time),
    CHECK (room_override_set OR room_id_override IS NULL),
    CHECK (capacity_override_set OR capacity_override IS NULL),
    CHECK (trial_policy_override IS NULL OR jsonb_typeof(trial_policy_override) = 'object')
);

CREATE INDEX airhop_recurrence_rules_group_dates_idx
    ON airhop_recurrence_rules
    (community_id, organization_id, group_id, status, starts_on, ends_on);

CREATE TABLE airhop_recurrence_weekdays (
    community_id             UUID NOT NULL REFERENCES communities(id),
    organization_id          UUID NOT NULL,
    recurrence_rule_id       UUID NOT NULL,
    weekday                  TEXT NOT NULL
        CHECK (weekday IN ('monday', 'tuesday', 'wednesday', 'thursday',
                           'friday', 'saturday', 'sunday')),
    PRIMARY KEY (community_id, organization_id, recurrence_rule_id, weekday),
    FOREIGN KEY (community_id, organization_id, recurrence_rule_id)
        REFERENCES airhop_recurrence_rules (community_id, organization_id, id)
        ON DELETE CASCADE
);

CREATE TABLE airhop_recurrence_teachers (
    community_id             UUID NOT NULL REFERENCES communities(id),
    organization_id          UUID NOT NULL,
    recurrence_rule_id       UUID NOT NULL,
    teacher_id               UUID NOT NULL,
    PRIMARY KEY (community_id, organization_id, recurrence_rule_id, teacher_id),
    FOREIGN KEY (community_id, organization_id, recurrence_rule_id)
        REFERENCES airhop_recurrence_rules (community_id, organization_id, id)
        ON DELETE CASCADE,
    FOREIGN KEY (community_id, organization_id, teacher_id)
        REFERENCES airhop_teachers (community_id, organization_id, id)
);

CREATE TABLE airhop_lesson_exceptions (
    community_id             UUID        NOT NULL REFERENCES communities(id),
    organization_id          UUID        NOT NULL,
    id                       UUID        NOT NULL DEFAULT gen_random_uuid(),
    recurrence_rule_id       UUID        NOT NULL,
    original_date            DATE        NOT NULL,
    kind                     TEXT        NOT NULL CHECK (kind IN ('cancelled', 'override')),
    original_snapshot        JSONB       NOT NULL,
    override_payload         JSONB,
    effective_payload        JSONB,
    reason                   VARCHAR(1000),
    version                  BIGINT      NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id, organization_id, id),
    UNIQUE (community_id, organization_id, recurrence_rule_id, original_date),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    FOREIGN KEY (community_id, organization_id, recurrence_rule_id)
        REFERENCES airhop_recurrence_rules (community_id, organization_id, id),
    CHECK (id <> '00000000-0000-0000-0000-000000000000'::uuid),
    CHECK (jsonb_typeof(original_snapshot) = 'object'),
    CHECK (override_payload IS NULL OR jsonb_typeof(override_payload) = 'object'),
    CHECK (effective_payload IS NULL OR jsonb_typeof(effective_payload) = 'object'),
    CHECK (
        (kind = 'override' AND override_payload IS NOT NULL AND effective_payload IS NULL)
        OR (kind = 'cancelled' AND override_payload IS NULL)
    )
);

CREATE TABLE airhop_lesson_occurrences (
    community_id             UUID        NOT NULL REFERENCES communities(id),
    organization_id          UUID        NOT NULL,
    id                       UUID        NOT NULL DEFAULT gen_random_uuid(),
    recurrence_rule_id       UUID        NOT NULL,
    original_date            DATE        NOT NULL,
    group_id                 UUID        NOT NULL,
    branch_id                UUID        NOT NULL,
    room_id                  UUID,
    original_start_time      TIME        NOT NULL,
    original_end_time        TIME        NOT NULL,
    effective_date           DATE        NOT NULL,
    start_time               TIME        NOT NULL,
    end_time                 TIME        NOT NULL,
    starts_at                TIMESTAMPTZ NOT NULL,
    ends_at                  TIMESTAMPTZ NOT NULL,
    time_zone                VARCHAR(80) NOT NULL CHECK (length(btrim(time_zone)) > 0),
    capacity                 INTEGER     CHECK (capacity > 0),
    trial_policy             JSONB       NOT NULL,
    allow_single_visits      BOOLEAN     NOT NULL,
    track_attendance         BOOLEAN     NOT NULL,
    status                   TEXT        NOT NULL
        CHECK (status IN ('scheduled', 'moved', 'modified', 'cancelled')),
    exception_id             UUID,
    source_rule_version      BIGINT      NOT NULL CHECK (source_rule_version > 0),
    source_exception_version BIGINT      CHECK (source_exception_version > 0),
    version                  BIGINT      NOT NULL DEFAULT 1 CHECK (version > 0),
    materialized_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id, organization_id, id),
    UNIQUE (community_id, organization_id, recurrence_rule_id, original_date),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    FOREIGN KEY (community_id, organization_id, recurrence_rule_id)
        REFERENCES airhop_recurrence_rules (community_id, organization_id, id),
    FOREIGN KEY (community_id, organization_id, group_id)
        REFERENCES airhop_groups (community_id, organization_id, id),
    FOREIGN KEY (community_id, organization_id, branch_id)
        REFERENCES airhop_branches (community_id, organization_id, id),
    FOREIGN KEY (community_id, organization_id, branch_id, room_id)
        REFERENCES airhop_rooms (community_id, organization_id, branch_id, id),
    FOREIGN KEY (community_id, organization_id, exception_id)
        REFERENCES airhop_lesson_exceptions (community_id, organization_id, id),
    CHECK (id <> '00000000-0000-0000-0000-000000000000'::uuid),
    CHECK (original_start_time < original_end_time),
    CHECK (start_time < end_time),
    CHECK (starts_at < ends_at),
    CHECK (jsonb_typeof(trial_policy) = 'object'),
    CHECK ((exception_id IS NULL) = (source_exception_version IS NULL))
);

CREATE INDEX airhop_lesson_occurrences_public_idx
    ON airhop_lesson_occurrences
    (community_id, organization_id, status, effective_date, branch_id, starts_at, id);
CREATE INDEX airhop_lesson_occurrences_group_idx
    ON airhop_lesson_occurrences
    (community_id, organization_id, group_id, effective_date, start_time, id);

CREATE TABLE airhop_occurrence_teachers (
    community_id             UUID NOT NULL REFERENCES communities(id),
    organization_id          UUID NOT NULL,
    occurrence_id            UUID NOT NULL,
    teacher_id               UUID NOT NULL,
    PRIMARY KEY (community_id, organization_id, occurrence_id, teacher_id),
    FOREIGN KEY (community_id, organization_id, occurrence_id)
        REFERENCES airhop_lesson_occurrences (community_id, organization_id, id)
        ON DELETE CASCADE,
    FOREIGN KEY (community_id, organization_id, teacher_id)
        REFERENCES airhop_teachers (community_id, organization_id, id)
);

CREATE TRIGGER trg_airhop_branches_tenant_immutable
    BEFORE UPDATE ON airhop_branches
    FOR EACH ROW EXECUTE FUNCTION airhop_tenant_identity_immutable();
CREATE TRIGGER trg_airhop_branch_working_periods_tenant_immutable
    BEFORE UPDATE ON airhop_branch_working_periods
    FOR EACH ROW EXECUTE FUNCTION airhop_tenant_identity_immutable();
CREATE TRIGGER trg_airhop_rooms_tenant_immutable
    BEFORE UPDATE ON airhop_rooms
    FOR EACH ROW EXECUTE FUNCTION airhop_tenant_identity_immutable();
CREATE TRIGGER trg_airhop_teachers_tenant_immutable
    BEFORE UPDATE ON airhop_teachers
    FOR EACH ROW EXECUTE FUNCTION airhop_tenant_identity_immutable();
CREATE TRIGGER trg_airhop_groups_tenant_immutable
    BEFORE UPDATE ON airhop_groups
    FOR EACH ROW EXECUTE FUNCTION airhop_tenant_identity_immutable();
CREATE TRIGGER trg_airhop_group_teachers_tenant_immutable
    BEFORE UPDATE ON airhop_group_teachers
    FOR EACH ROW EXECUTE FUNCTION airhop_tenant_identity_immutable();
CREATE TRIGGER trg_airhop_recurrence_rules_tenant_immutable
    BEFORE UPDATE ON airhop_recurrence_rules
    FOR EACH ROW EXECUTE FUNCTION airhop_tenant_identity_immutable();
CREATE TRIGGER trg_airhop_recurrence_weekdays_tenant_immutable
    BEFORE UPDATE ON airhop_recurrence_weekdays
    FOR EACH ROW EXECUTE FUNCTION airhop_tenant_identity_immutable();
CREATE TRIGGER trg_airhop_recurrence_teachers_tenant_immutable
    BEFORE UPDATE ON airhop_recurrence_teachers
    FOR EACH ROW EXECUTE FUNCTION airhop_tenant_identity_immutable();
CREATE TRIGGER trg_airhop_lesson_exceptions_tenant_immutable
    BEFORE UPDATE ON airhop_lesson_exceptions
    FOR EACH ROW EXECUTE FUNCTION airhop_tenant_identity_immutable();
CREATE TRIGGER trg_airhop_lesson_occurrences_tenant_immutable
    BEFORE UPDATE ON airhop_lesson_occurrences
    FOR EACH ROW EXECUTE FUNCTION airhop_tenant_identity_immutable();
CREATE TRIGGER trg_airhop_occurrence_teachers_tenant_immutable
    BEFORE UPDATE ON airhop_occurrence_teachers
    FOR EACH ROW EXECUTE FUNCTION airhop_tenant_identity_immutable();
