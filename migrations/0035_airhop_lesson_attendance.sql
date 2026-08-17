-- Authoritative attendance marks for one stable AirHub lesson occurrence.
--
-- A row exists only while staff has explicitly marked a child present or
-- absent. Clearing a mark deletes the projection row; the immutable domain
-- event stream retains the audit history.

CREATE TABLE airhop_lesson_attendance (
    community_id       UUID        NOT NULL REFERENCES communities(id),
    organization_id    UUID        NOT NULL,
    id                 UUID        NOT NULL DEFAULT gen_random_uuid(),
    recurrence_rule_id UUID        NOT NULL,
    original_date      DATE        NOT NULL,
    child_id           UUID        NOT NULL,
    status             TEXT        NOT NULL CHECK (status IN ('present', 'absent')),
    marked_by_pubkey   BYTEA       NOT NULL CHECK (length(marked_by_pubkey) = 32),
    version            BIGINT      NOT NULL DEFAULT 1 CHECK (version > 0),
    marked_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id, organization_id, id),
    UNIQUE (community_id, organization_id, recurrence_rule_id, original_date, child_id),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    FOREIGN KEY (community_id, organization_id, recurrence_rule_id, original_date)
        REFERENCES airhop_lesson_occurrences
        (community_id, organization_id, recurrence_rule_id, original_date),
    FOREIGN KEY (community_id, organization_id, child_id)
        REFERENCES airhop_children (community_id, organization_id, id),
    CHECK (id <> '00000000-0000-0000-0000-000000000000'::uuid)
);

CREATE INDEX airhop_lesson_attendance_occurrence_idx
    ON airhop_lesson_attendance
    (community_id, organization_id, recurrence_rule_id, original_date, child_id);

CREATE TRIGGER trg_airhop_lesson_attendance_tenant_immutable
    BEFORE UPDATE ON airhop_lesson_attendance
    FOR EACH ROW EXECUTE FUNCTION airhop_tenant_identity_immutable();
