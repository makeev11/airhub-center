-- Human staff availability is distinct from branch lesson hours.
--
-- An empty object means the organization has not configured authoritative
-- staff hours yet. Hermes remains available around the clock; this schedule is
-- used only when a conversation requires a human response or approval.

ALTER TABLE airhop_organizations
    ADD COLUMN staff_working_hours JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(staff_working_hours) = 'object');
