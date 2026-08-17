-- First and future expected payments are durable snapshots, not fields on a tariff.
CREATE TABLE airhop_payment_expectations (
    community_id          UUID         NOT NULL REFERENCES communities(id),
    organization_id       UUID         NOT NULL,
    id                    UUID         NOT NULL DEFAULT gen_random_uuid(),
    family_id             UUID         NOT NULL,
    child_id              UUID         NOT NULL,
    enrollment_id         UUID         NOT NULL,
    tariff_id             UUID         NOT NULL,
    tariff_name_snapshot  VARCHAR(160) NOT NULL
        CHECK (length(btrim(tariff_name_snapshot)) > 0),
    amount_minor          BIGINT       NOT NULL CHECK (amount_minor >= 0),
    currency              CHAR(3)      NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    due_date              DATE         NOT NULL,
    status                TEXT         NOT NULL DEFAULT 'expected'
        CHECK (status IN ('expected', 'paid', 'cancelled')),
    paid_at               TIMESTAMPTZ,
    paid_by               VARCHAR(200),
    cancelled_at          TIMESTAMPTZ,
    cancelled_by          VARCHAR(200),
    internal_reason       VARCHAR(4000),
    version               BIGINT       NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id, organization_id, id),
    UNIQUE (community_id, organization_id, enrollment_id, due_date),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    FOREIGN KEY (community_id, organization_id, family_id, child_id)
        REFERENCES airhop_children (community_id, organization_id, family_id, id),
    FOREIGN KEY (community_id, organization_id, enrollment_id)
        REFERENCES airhop_enrollments (community_id, organization_id, id),
    FOREIGN KEY (community_id, organization_id, tariff_id)
        REFERENCES airhop_tariffs (community_id, organization_id, id),
    CHECK (id <> '00000000-0000-0000-0000-000000000000'::uuid),
    CHECK ((status = 'expected' AND paid_at IS NULL AND paid_by IS NULL
                              AND cancelled_at IS NULL AND cancelled_by IS NULL)
        OR (status = 'paid' AND paid_at IS NOT NULL AND paid_by IS NOT NULL
                            AND cancelled_at IS NULL AND cancelled_by IS NULL)
        OR (status = 'cancelled' AND paid_at IS NULL AND paid_by IS NULL
                                 AND cancelled_at IS NOT NULL
                                 AND cancelled_by IS NOT NULL
                                 AND internal_reason IS NOT NULL
                                 AND length(btrim(internal_reason)) > 0))
);

CREATE INDEX airhop_payment_expectations_work_queue_idx
    ON airhop_payment_expectations
    (community_id, organization_id, status, due_date, id);

CREATE INDEX airhop_payment_expectations_family_idx
    ON airhop_payment_expectations
    (community_id, organization_id, family_id, due_date DESC, id);
