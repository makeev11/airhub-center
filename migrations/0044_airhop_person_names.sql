-- Structured person names for AirHop family members.
--
-- `display_name` remains the stable compatibility/presentation projection used
-- by existing bookings, payment summaries, agents, and legacy clients. New
-- staff writes also persist the exact first/last-name components. Existing
-- rows stay NULL because splitting a human name heuristically would silently
-- corrupt compound and culture-specific names.

ALTER TABLE airhop_representatives
    ADD COLUMN first_name VARCHAR(80),
    ADD COLUMN last_name  VARCHAR(80),
    ADD CONSTRAINT airhop_representatives_structured_name_check CHECK (
        (first_name IS NULL AND last_name IS NULL)
        OR (
            first_name IS NOT NULL
            AND last_name IS NOT NULL
            AND length(btrim(first_name)) > 0
            AND length(btrim(last_name)) > 0
        )
    );

ALTER TABLE airhop_children
    ADD COLUMN first_name VARCHAR(80),
    ADD COLUMN last_name  VARCHAR(80),
    ADD CONSTRAINT airhop_children_structured_name_check CHECK (
        (first_name IS NULL AND last_name IS NULL)
        OR (
            first_name IS NOT NULL
            AND last_name IS NOT NULL
            AND length(btrim(first_name)) > 0
            AND length(btrim(last_name)) > 0
        )
    );

COMMENT ON COLUMN airhop_representatives.first_name IS
    'Exact staff-confirmed first name; NULL only for legacy or public-booking rows not yet completed by staff';
COMMENT ON COLUMN airhop_representatives.last_name IS
    'Exact staff-confirmed last name; NULL only for legacy or public-booking rows not yet completed by staff';
COMMENT ON COLUMN airhop_children.first_name IS
    'Exact staff-confirmed first name; NULL only for legacy or public-booking rows not yet completed by staff';
COMMENT ON COLUMN airhop_children.last_name IS
    'Exact staff-confirmed last name; NULL only for legacy or public-booking rows not yet completed by staff';
