-- Append-only money movements behind AirHub payment expectations.

CREATE TABLE airhop_payment_transactions (
    community_id          UUID         NOT NULL REFERENCES communities(id),
    organization_id       UUID         NOT NULL,
    id                    UUID         NOT NULL DEFAULT gen_random_uuid(),
    payment_expectation_id UUID        NOT NULL,
    kind                  TEXT         NOT NULL
        CHECK (kind IN ('receipt', 'refund')),
    amount_minor          BIGINT       NOT NULL CHECK (amount_minor > 0),
    currency              CHAR(3)      NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    payment_method        TEXT         NOT NULL
        CHECK (payment_method IN (
            'cash', 'card', 'bank_transfer', 'other', 'buzz', 'legacy'
        )),
    note                  VARCHAR(4000),
    occurred_at           TIMESTAMPTZ  NOT NULL,
    recorded_by           VARCHAR(200) NOT NULL
        CHECK (length(btrim(recorded_by)) > 0),
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id, organization_id, id),
    FOREIGN KEY (community_id, organization_id, payment_expectation_id)
        REFERENCES airhop_payment_expectations (community_id, organization_id, id),
    CHECK (id <> '00000000-0000-0000-0000-000000000000'::uuid),
    CHECK (note IS NULL OR length(btrim(note)) > 0)
);

CREATE INDEX airhop_payment_transactions_expectation_idx
    ON airhop_payment_transactions
       (community_id, organization_id, payment_expectation_id, occurred_at, id);

-- Brownfield paid rows become explicit receipts without changing their public
-- status, optimistic version, event history, or original staff attribution.
INSERT INTO airhop_payment_transactions (
    community_id, organization_id, payment_expectation_id, kind,
    amount_minor, currency, payment_method, note, occurred_at, recorded_by
)
SELECT community_id, organization_id, id, 'receipt', amount_minor, currency,
       'legacy', 'Перенесено из статуса оплаты', paid_at, paid_by
FROM airhop_payment_expectations
WHERE status = 'paid' AND amount_minor > 0;
