-- Make rolling AirHub occurrence refreshes idempotent across group and
-- organization changes. Rule/exception provenance alone cannot detect a
-- teacher-only group edit or a changed organization default/time zone.

ALTER TABLE airhop_lesson_occurrences
    ADD COLUMN source_group_version BIGINT NOT NULL DEFAULT 0
        CHECK (source_group_version >= 0),
    ADD COLUMN source_organization_version BIGINT NOT NULL DEFAULT 0
        CHECK (source_organization_version >= 0);
