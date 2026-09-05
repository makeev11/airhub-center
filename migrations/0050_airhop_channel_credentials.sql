-- Encrypted provider credentials for self-service channel provisioning.
--
-- The encryption and stable-index keys remain outside Postgres. Relay writes
-- only authenticated ciphertext and returns plaintext exclusively to the
-- exact connector principal bound to the channel connection.

CREATE TABLE airhop_channel_credentials (
    community_id             UUID         NOT NULL REFERENCES communities(id),
    organization_id          UUID         NOT NULL,
    connection_id            UUID         NOT NULL,
    provider                 VARCHAR(40)  NOT NULL,
    credential_ciphertext    BYTEA        NOT NULL
        CHECK (octet_length(credential_ciphertext) BETWEEN 17 AND 512),
    credential_nonce         BYTEA        NOT NULL
        CHECK (octet_length(credential_nonce) = 12),
    credential_key_version   SMALLINT     NOT NULL
        CHECK (credential_key_version > 0),
    credential_fingerprint   BYTEA        NOT NULL
        CHECK (octet_length(credential_fingerprint) = 32),
    provider_bot_id          VARCHAR(64)  NOT NULL
        CHECK (length(btrim(provider_bot_id)) > 0),
    provider_bot_username    VARCHAR(160),
    version                  BIGINT       NOT NULL DEFAULT 1 CHECK (version > 0),
    updated_by_pubkey        BYTEA        NOT NULL
        CHECK (octet_length(updated_by_pubkey) = 32),
    created_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, connection_id),
    UNIQUE (community_id, organization_id, provider, credential_fingerprint),
    FOREIGN KEY (community_id, organization_id, connection_id)
        REFERENCES airhop_channel_connections
            (community_id, organization_id, id),
    CHECK (provider = 'telegram')
);

CREATE INDEX airhop_channel_credentials_connector_lookup_idx
    ON airhop_channel_credentials (community_id, organization_id, connection_id);
