-- Rolling AirHub payment expectations and durable Buzz overdue summaries.

-- A staff member may move one payment's due date. Keep the immutable billing
-- month separate so that action never shifts or skips the recurring cadence.
ALTER TABLE airhop_payment_expectations
    ADD COLUMN billing_period DATE;

UPDATE airhop_payment_expectations
SET billing_period = date_trunc('month', due_date::timestamp)::date;

ALTER TABLE airhop_payment_expectations
    ALTER COLUMN billing_period SET NOT NULL,
    ADD CONSTRAINT airhop_payment_expectations_billing_period_month_check
        CHECK (date_trunc('month', billing_period::timestamp)::date = billing_period);

DO $$
DECLARE
    legacy_constraint_name TEXT;
BEGIN
    SELECT constraint_row.conname
    INTO legacy_constraint_name
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid = 'airhop_payment_expectations'::regclass
      AND constraint_row.contype = 'u'
      AND pg_get_constraintdef(constraint_row.oid)
          = 'UNIQUE (community_id, organization_id, enrollment_id, due_date)';

    IF legacy_constraint_name IS NULL THEN
        RAISE EXCEPTION
            'legacy AirHub payment due-date uniqueness constraint is missing';
    END IF;

    EXECUTE format(
        'ALTER TABLE airhop_payment_expectations DROP CONSTRAINT %I',
        legacy_constraint_name
    );
END
$$;

ALTER TABLE airhop_payment_expectations
    ADD CONSTRAINT airhop_payment_expectations_enrollment_period_key
        UNIQUE (community_id, organization_id, enrollment_id, billing_period);

ALTER TABLE airhop_organizations
    ADD COLUMN payments_buzz_channel_id UUID,
    ADD CONSTRAINT airhop_organizations_payments_buzz_channel_fk
        FOREIGN KEY (community_id, payments_buzz_channel_id)
        REFERENCES channels (community_id, id);

CREATE TABLE airhop_payment_buzz_summary_state (
    community_id              UUID        NOT NULL REFERENCES communities(id),
    organization_id           UUID        NOT NULL,
    channel_id                UUID        NOT NULL,
    period_start              DATE        NOT NULL,
    root_event_id             BYTEA       CHECK (root_event_id IS NULL OR length(root_event_id) = 32),
    root_event_created_at     TIMESTAMPTZ,
    last_summary_event_id     BYTEA       CHECK (last_summary_event_id IS NULL OR length(last_summary_event_id) = 32),
    last_digest               BYTEA       CHECK (last_digest IS NULL OR length(last_digest) = 32),
    last_overdue_count        INTEGER     NOT NULL DEFAULT 0 CHECK (last_overdue_count >= 0),
    pending_id                UUID,
    pending_digest            BYTEA       CHECK (pending_digest IS NULL OR length(pending_digest) = 32),
    pending_root_content      TEXT,
    pending_content           TEXT,
    pending_created_at        TIMESTAMPTZ,
    pending_overdue_count     INTEGER     CHECK (pending_overdue_count IS NULL OR pending_overdue_count >= 0),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, organization_id),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    FOREIGN KEY (community_id, channel_id)
        REFERENCES channels (community_id, id),
    CHECK (date_trunc('month', period_start::timestamp)::date = period_start),
    CHECK (
        (root_event_id IS NULL AND root_event_created_at IS NULL)
        OR (root_event_id IS NOT NULL AND root_event_created_at IS NOT NULL)
    ),
    CHECK (
        (pending_id IS NULL AND pending_digest IS NULL AND pending_root_content IS NULL
                            AND pending_content IS NULL
                            AND pending_created_at IS NULL AND pending_overdue_count IS NULL)
        OR (pending_id IS NOT NULL AND pending_digest IS NOT NULL
                                AND pending_root_content IS NOT NULL AND pending_content IS NOT NULL
                                AND pending_created_at IS NOT NULL AND pending_overdue_count IS NOT NULL)
    )
);

CREATE INDEX airhop_payment_buzz_summary_pending_idx
    ON airhop_payment_buzz_summary_state (community_id, organization_id, pending_created_at)
    WHERE pending_id IS NOT NULL;
