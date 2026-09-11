-- Extend the encrypted Channel Gateway credential envelope to the official
-- WhatsApp Cloud adapter. Provider secrets remain opaque ciphertext in
-- Postgres and are still retrievable only by the exact connector principal.

ALTER TABLE airhop_channel_credentials
    DROP CONSTRAINT airhop_channel_credentials_provider_check;

ALTER TABLE airhop_channel_credentials
    ADD CONSTRAINT airhop_channel_credentials_provider_check
        CHECK (provider IN ('telegram', 'whatsapp_cloud'));

ALTER TABLE airhop_channel_credentials
    DROP CONSTRAINT airhop_channel_credentials_credential_ciphertext_check;

ALTER TABLE airhop_channel_credentials
    ADD CONSTRAINT airhop_channel_credentials_credential_ciphertext_check
        CHECK (octet_length(credential_ciphertext) BETWEEN 17 AND 8192);

ALTER TABLE airhop_channel_credentials
    ADD CONSTRAINT airhop_channel_credentials_provider_identity_unique
        UNIQUE (community_id, organization_id, provider, provider_bot_id);
