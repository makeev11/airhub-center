-- Signed AirHub Center health verification.
--
-- A deployment operator requests a short-lived random challenge. The activated
-- Center installation answers through a payload-bound NIP-98 request signed by
-- its installation key. Only a tenant-keyed challenge digest is persisted.

ALTER TABLE airhop_center_installations
    ADD COLUMN config_version VARCHAR(120)
        CHECK (config_version IS NULL OR length(btrim(config_version)) > 0),
    ADD COLUMN verification_version BIGINT NOT NULL DEFAULT 0
        CHECK (verification_version >= 0);

-- Before this protocol existed, claim marked an installation ready. Ready now
-- means a successful signed challenge, so unverified activated rows return to
-- the honest intermediate state.
UPDATE airhop_center_installations
SET status = 'provisioning', updated_at = now()
WHERE status = 'ready' AND activation_version > 0 AND last_verified_at IS NULL;

CREATE TABLE airhop_center_health_challenges (
    community_id             UUID         NOT NULL REFERENCES communities(id),
    organization_id          UUID         NOT NULL,
    id                       UUID         NOT NULL DEFAULT gen_random_uuid(),
    installation_id          UUID         NOT NULL,
    challenge_digest         BYTEA        NOT NULL CHECK (length(challenge_digest) = 32),
    issued_by_pubkey         BYTEA        NOT NULL CHECK (length(issued_by_pubkey) = 32),
    expires_at               TIMESTAMPTZ  NOT NULL,
    consumed_at              TIMESTAMPTZ,
    verified_pubkey          BYTEA        CHECK (verified_pubkey IS NULL OR length(verified_pubkey) = 32),
    verified_release_version VARCHAR(120),
    verified_config_version  VARCHAR(120),
    verification_version     BIGINT       CHECK (verification_version IS NULL OR verification_version > 0),
    created_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id, organization_id, id),
    UNIQUE (community_id, organization_id, challenge_digest),
    FOREIGN KEY (community_id, organization_id, installation_id)
        REFERENCES airhop_center_installations (community_id, organization_id, id),
    CHECK (id <> '00000000-0000-0000-0000-000000000000'::uuid),
    CHECK (expires_at > created_at),
    CHECK (
        (consumed_at IS NULL AND verified_pubkey IS NULL
            AND verified_release_version IS NULL AND verified_config_version IS NULL
            AND verification_version IS NULL)
        OR
        (consumed_at IS NOT NULL AND verified_pubkey IS NOT NULL
            AND verified_release_version IS NOT NULL AND verified_config_version IS NOT NULL
            AND verification_version IS NOT NULL)
    ),
    CHECK (verified_release_version IS NULL OR length(btrim(verified_release_version)) > 0),
    CHECK (verified_config_version IS NULL OR length(btrim(verified_config_version)) > 0)
);

CREATE INDEX airhop_center_health_challenges_pending_idx
    ON airhop_center_health_challenges
    (community_id, organization_id, installation_id, expires_at, id)
    WHERE consumed_at IS NULL;

CREATE TRIGGER trg_airhop_center_health_challenges_tenant_immutable
    BEFORE UPDATE ON airhop_center_health_challenges
    FOR EACH ROW EXECUTE FUNCTION airhop_tenant_identity_immutable();

CREATE FUNCTION airhop_center_health_challenge_identity_immutable() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.installation_id IS DISTINCT FROM OLD.installation_id
       OR NEW.challenge_digest IS DISTINCT FROM OLD.challenge_digest
       OR NEW.issued_by_pubkey IS DISTINCT FROM OLD.issued_by_pubkey
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
        RAISE EXCEPTION 'AirHub Center health challenge identity is immutable'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_airhop_center_health_challenge_identity_immutable
    BEFORE UPDATE ON airhop_center_health_challenges
    FOR EACH ROW EXECUTE FUNCTION airhop_center_health_challenge_identity_immutable();
