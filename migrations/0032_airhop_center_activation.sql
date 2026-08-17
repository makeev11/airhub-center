-- AirHub Center installation activation.
--
-- The operator plane issues a short-lived, one-time grant for one exact
-- installation/environment/profile/release tuple. The cleartext code never
-- reaches Postgres: only a tenant-keyed digest is stored. Claim and revoke
-- transitions are serialized by row locks in buzz-db.

CREATE TABLE airhop_center_installations (
    community_id             UUID         NOT NULL REFERENCES communities(id),
    organization_id          UUID         NOT NULL,
    id                       UUID         NOT NULL,
    environment              VARCHAR(32)  NOT NULL
        CHECK (environment IN ('production', 'staging', 'development')),
    release_profile          VARCHAR(80)  NOT NULL CHECK (length(btrim(release_profile)) > 0),
    release_version          VARCHAR(120) NOT NULL CHECK (length(btrim(release_version)) > 0),
    installation_pubkey      BYTEA        CHECK (installation_pubkey IS NULL OR length(installation_pubkey) = 32),
    status                   TEXT         NOT NULL DEFAULT 'provisioning'
        CHECK (status IN ('provisioning', 'ready', 'degraded', 'failed', 'disabled')),
    activation_version       BIGINT       NOT NULL DEFAULT 0 CHECK (activation_version >= 0),
    activated_at             TIMESTAMPTZ,
    last_verified_at         TIMESTAMPTZ,
    sanitized_error_code     VARCHAR(120),
    created_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id, organization_id, id),
    UNIQUE (community_id, organization_id, installation_pubkey),
    FOREIGN KEY (community_id, organization_id)
        REFERENCES airhop_organizations (community_id, id),
    CHECK (id <> '00000000-0000-0000-0000-000000000000'::uuid),
    CHECK (
        (activation_version = 0 AND installation_pubkey IS NULL AND activated_at IS NULL)
        OR
        (activation_version > 0 AND installation_pubkey IS NOT NULL AND activated_at IS NOT NULL)
    )
);

CREATE INDEX airhop_center_installations_status_idx
    ON airhop_center_installations
    (community_id, organization_id, status, updated_at DESC, id);

CREATE TABLE airhop_center_activation_grants (
    community_id             UUID        NOT NULL REFERENCES communities(id),
    organization_id          UUID        NOT NULL,
    id                       UUID        NOT NULL DEFAULT gen_random_uuid(),
    installation_id          UUID        NOT NULL,
    code_digest              BYTEA       NOT NULL CHECK (length(code_digest) = 32),
    issue_idempotency_digest BYTEA       NOT NULL CHECK (length(issue_idempotency_digest) = 32),
    issue_request_hash       BYTEA       NOT NULL CHECK (length(issue_request_hash) = 32),
    issued_by_pubkey         BYTEA       NOT NULL CHECK (length(issued_by_pubkey) = 32),
    expires_at               TIMESTAMPTZ NOT NULL,
    claimed_at               TIMESTAMPTZ,
    claimed_by_pubkey        BYTEA       CHECK (claimed_by_pubkey IS NULL OR length(claimed_by_pubkey) = 32),
    claim_idempotency_digest BYTEA       CHECK (claim_idempotency_digest IS NULL OR length(claim_idempotency_digest) = 32),
    claim_request_hash       BYTEA       CHECK (claim_request_hash IS NULL OR length(claim_request_hash) = 32),
    revoked_at               TIMESTAMPTZ,
    revoked_by_pubkey        BYTEA       CHECK (revoked_by_pubkey IS NULL OR length(revoked_by_pubkey) = 32),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id, organization_id, id),
    UNIQUE (community_id, organization_id, code_digest),
    UNIQUE (community_id, organization_id, issue_idempotency_digest),
    FOREIGN KEY (community_id, organization_id, installation_id)
        REFERENCES airhop_center_installations (community_id, organization_id, id),
    CHECK (id <> '00000000-0000-0000-0000-000000000000'::uuid),
    CHECK (expires_at > created_at),
    CHECK (
        (claimed_at IS NULL AND claimed_by_pubkey IS NULL
            AND claim_idempotency_digest IS NULL AND claim_request_hash IS NULL)
        OR
        (claimed_at IS NOT NULL AND claimed_by_pubkey IS NOT NULL
            AND claim_idempotency_digest IS NOT NULL AND claim_request_hash IS NOT NULL)
    ),
    CHECK (
        (revoked_at IS NULL AND revoked_by_pubkey IS NULL)
        OR (revoked_at IS NOT NULL AND revoked_by_pubkey IS NOT NULL)
    ),
    CHECK (claimed_at IS NULL OR revoked_at IS NULL)
);

CREATE INDEX airhop_center_activation_grants_installation_idx
    ON airhop_center_activation_grants
    (community_id, organization_id, installation_id, created_at DESC, id);
CREATE INDEX airhop_center_activation_grants_pending_idx
    ON airhop_center_activation_grants
    (community_id, organization_id, expires_at, id)
    WHERE claimed_at IS NULL AND revoked_at IS NULL;

-- Separate immutable audit stream because deployment operators and installation
-- identities are neither staff nor public-booking actors. Payloads are metadata
-- only; code material and digests are deliberately absent.
CREATE TABLE airhop_center_activation_audit (
    community_id             UUID         NOT NULL REFERENCES communities(id),
    organization_id          UUID         NOT NULL,
    id                       UUID         NOT NULL DEFAULT gen_random_uuid(),
    installation_id          UUID         NOT NULL,
    grant_id                 UUID,
    event_type               VARCHAR(120) NOT NULL
        CHECK (event_type IN (
            'airhop.center.activation-grant-issued.v1',
            'airhop.center.activation-grant-revoked.v1',
            'airhop.center.installation-activated.v1',
            'airhop.center.installation-verified.v1'
        )),
    actor_kind               TEXT         NOT NULL
        CHECK (actor_kind IN ('operator', 'installation')),
    actor_pubkey             BYTEA        NOT NULL CHECK (length(actor_pubkey) = 32),
    occurred_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
    payload                  JSONB        NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (community_id, id),
    FOREIGN KEY (community_id, organization_id, installation_id)
        REFERENCES airhop_center_installations (community_id, organization_id, id),
    FOREIGN KEY (community_id, organization_id, grant_id)
        REFERENCES airhop_center_activation_grants (community_id, organization_id, id),
    CHECK (id <> '00000000-0000-0000-0000-000000000000'::uuid),
    CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX airhop_center_activation_audit_timeline_idx
    ON airhop_center_activation_audit
    (community_id, organization_id, installation_id, occurred_at, id);

CREATE TRIGGER trg_airhop_center_installations_tenant_immutable
    BEFORE UPDATE ON airhop_center_installations
    FOR EACH ROW EXECUTE FUNCTION airhop_tenant_identity_immutable();
CREATE TRIGGER trg_airhop_center_activation_grants_tenant_immutable
    BEFORE UPDATE ON airhop_center_activation_grants
    FOR EACH ROW EXECUTE FUNCTION airhop_tenant_identity_immutable();

CREATE FUNCTION airhop_center_installation_identity_immutable() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.environment IS DISTINCT FROM OLD.environment
       OR NEW.release_profile IS DISTINCT FROM OLD.release_profile THEN
        RAISE EXCEPTION 'AirHub Center installation identity and deployment binding are immutable'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_airhop_center_installation_identity_immutable
    BEFORE UPDATE ON airhop_center_installations
    FOR EACH ROW EXECUTE FUNCTION airhop_center_installation_identity_immutable();

CREATE FUNCTION airhop_center_activation_audit_append_only() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'AirHub Center activation audit is append-only'
        USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_airhop_center_activation_audit_append_only
    BEFORE UPDATE OR DELETE ON airhop_center_activation_audit
    FOR EACH ROW EXECUTE FUNCTION airhop_center_activation_audit_append_only();
