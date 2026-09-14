-- Migration 0070: Meta acceptance is not handset delivery. Never lease an accepted message again.
ALTER TABLE airhop_external_message_outbox
    DROP CONSTRAINT airhop_external_message_outbox_status_check,
    ADD COLUMN accepted_at TIMESTAMPTZ,
    ADD COLUMN provider_recipient VARCHAR(300),
    ADD COLUMN read_at TIMESTAMPTZ,
    ADD COLUMN provider_status TEXT CHECK (provider_status IN ('accepted','sent','delivered','read','failed'));

DO $$ DECLARE c RECORD; BEGIN
    FOR c IN SELECT conname FROM pg_constraint
        WHERE conrelid='airhop_external_message_outbox'::regclass AND contype='c'
          AND pg_get_constraintdef(oid) LIKE '%delivered_at%'
    LOOP EXECUTE format('ALTER TABLE airhop_external_message_outbox DROP CONSTRAINT %I',c.conname); END LOOP;
    FOR c IN SELECT conname FROM pg_constraint
        WHERE conrelid='airhop_external_message_delivery_attempts'::regclass AND contype='c'
          AND pg_get_constraintdef(oid) LIKE '%outcome%'
    LOOP EXECUTE format('ALTER TABLE airhop_external_message_delivery_attempts DROP CONSTRAINT %I',c.conname); END LOOP;
END $$;

ALTER TABLE airhop_external_message_outbox
    ADD CHECK (status IN ('pending','leased','accepted','delivered','failed','superseded')),
    ADD CHECK (
        (status='delivered' AND delivered_at IS NOT NULL AND failed_at IS NULL)
        OR (status='failed' AND delivered_at IS NULL AND failed_at IS NOT NULL)
        OR (status IN ('pending','leased','accepted','superseded') AND delivered_at IS NULL AND failed_at IS NULL)
    );
ALTER TABLE airhop_external_message_delivery_attempts
    ADD CHECK (outcome IN ('accepted','delivered','retry','failed')),
    ADD CHECK ((outcome IN ('accepted','delivered') AND error_code IS NULL)
        OR (outcome IN ('retry','failed') AND error_code IS NOT NULL));

CREATE INDEX airhop_whatsapp_message_receipt_idx
    ON airhop_external_message_outbox (community_id,connection_id,provider_message_id)
    WHERE provider_message_id IS NOT NULL;

-- Store bounded normalized evidence, never raw provider payloads or error text.
CREATE TABLE airhop_whatsapp_delivery_receipts (
    community_id UUID NOT NULL,
    connection_id UUID NOT NULL,
    outbox_id UUID NOT NULL,
    provider_message_id VARCHAR(300) NOT NULL,
    provider_status TEXT NOT NULL CHECK (provider_status IN ('sent','delivered','read','failed')),
    provider_timestamp BIGINT NOT NULL CHECK (provider_timestamp>=0),
    error_code VARCHAR(120),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id,connection_id,provider_message_id,provider_status,provider_timestamp),
    FOREIGN KEY (community_id,outbox_id) REFERENCES airhop_external_message_outbox(community_id,id),
    FOREIGN KEY (community_id,connection_id) REFERENCES airhop_channel_connections(community_id,id)
);

-- Earlier WhatsApp adapters called Graph acceptance "delivered". Preserve the
-- timestamp as acceptance evidence, but require an actual webhook for delivery.
UPDATE airhop_external_message_outbox o
SET provider_recipient=r.provider_chat_id,
    accepted_at=coalesce(o.delivered_at,o.updated_at),
    delivered_at=NULL,
    status='accepted',
    provider_status='accepted'
FROM airhop_channel_connections c,airhop_external_conversation_routes r
WHERE c.community_id=o.community_id AND c.id=o.connection_id
  AND c.provider='whatsapp_cloud' AND o.status='delivered'
  AND r.community_id=o.community_id AND r.connection_id=o.connection_id
  AND r.conversation_id=o.conversation_id;
