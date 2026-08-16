-- AirHub staff decisions and reliable parent-notification delivery.
--
-- Booking state remains authoritative in airhop_bookings. The transactional
-- outbox only carries redacted routing identifiers; a separately deployed,
-- authenticated connector resolves the verified provider address while
-- leasing a job. Provider credentials never live in this schema.

ALTER TABLE airhop_messenger_accounts
    ADD COLUMN verified_at TIMESTAMPTZ,
    ADD COLUMN verified_by_pubkey BYTEA
        CHECK (verified_by_pubkey IS NULL OR length(verified_by_pubkey) = 32),
    ADD COLUMN last_inbound_at TIMESTAMPTZ,
    ADD CONSTRAINT airhop_messenger_accounts_verification_check CHECK (
        (verified_at IS NULL AND verified_by_pubkey IS NULL)
        OR (verified_at IS NOT NULL AND verified_by_pubkey IS NOT NULL)
    );

CREATE INDEX airhop_messenger_accounts_delivery_idx
    ON airhop_messenger_accounts
    (community_id, organization_id, representative_id, channel,
     verified_at DESC, updated_at DESC, id)
    WHERE verified_at IS NOT NULL;

ALTER TABLE airhop_outbox
    ADD COLUMN lease_token UUID,
    ADD COLUMN leased_by_pubkey BYTEA
        CHECK (leased_by_pubkey IS NULL OR length(leased_by_pubkey) = 32),
    ADD COLUMN lease_expires_at TIMESTAMPTZ,
    ADD COLUMN failed_at TIMESTAMPTZ,
    ADD CONSTRAINT airhop_outbox_lease_check CHECK (
        (lease_token IS NULL AND leased_by_pubkey IS NULL AND lease_expires_at IS NULL)
        OR (lease_token IS NOT NULL AND leased_by_pubkey IS NOT NULL AND lease_expires_at IS NOT NULL)
    ),
    ADD CONSTRAINT airhop_outbox_terminal_check CHECK (
        NOT (published_at IS NOT NULL AND failed_at IS NOT NULL)
    ),
    ADD CONSTRAINT airhop_outbox_tenant_delivery_identity_unique
        UNIQUE (community_id, organization_id, id);

DROP INDEX airhop_outbox_pending_idx;
CREATE INDEX airhop_outbox_pending_idx
    ON airhop_outbox (community_id, organization_id, not_before, id)
    WHERE published_at IS NULL AND failed_at IS NULL;

CREATE TABLE airhop_outbox_delivery_attempts (
    community_id        UUID         NOT NULL REFERENCES communities(id),
    organization_id     UUID         NOT NULL,
    id                  UUID         NOT NULL DEFAULT gen_random_uuid(),
    outbox_id           UUID         NOT NULL,
    lease_token         UUID         NOT NULL,
    connector_pubkey    BYTEA        NOT NULL CHECK (length(connector_pubkey) = 32),
    outcome             TEXT         NOT NULL CHECK (outcome IN ('delivered', 'retry', 'failed')),
    provider_message_id VARCHAR(300),
    error_code          VARCHAR(120),
    attempted_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id, organization_id, outbox_id, lease_token),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    FOREIGN KEY (community_id, organization_id, outbox_id)
        REFERENCES airhop_outbox (community_id, organization_id, id),
    CHECK (id <> '00000000-0000-0000-0000-000000000000'::uuid),
    CHECK (
        (outcome = 'delivered' AND error_code IS NULL)
        OR (outcome IN ('retry', 'failed') AND error_code IS NOT NULL)
    )
);

CREATE INDEX airhop_outbox_delivery_attempts_timeline_idx
    ON airhop_outbox_delivery_attempts
    (community_id, organization_id, outbox_id, attempted_at, id);

CREATE FUNCTION airhop_outbox_delivery_attempts_append_only() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'AirHub outbox delivery attempts are append-only'
        USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_airhop_outbox_delivery_attempts_append_only
    BEFORE UPDATE OR DELETE ON airhop_outbox_delivery_attempts
    FOR EACH ROW EXECUTE FUNCTION airhop_outbox_delivery_attempts_append_only();
