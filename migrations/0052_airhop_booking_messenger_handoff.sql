-- Only a trusted connector can redeem these digests. The browser's raw
-- short-lived start payload is never persisted or published as a Buzz event.
ALTER TABLE airhop_agent_deployments ADD COLUMN auto_confirm_online_bookings BOOLEAN NOT NULL DEFAULT TRUE;
CREATE TABLE airhop_booking_messenger_handoffs (
    community_id UUID NOT NULL,
    organization_id UUID NOT NULL,
    booking_id UUID NOT NULL,
    connection_id UUID NOT NULL,
    token_digest BYTEA NOT NULL CHECK (octet_length(token_digest) = 32),
    booking_version BIGINT NOT NULL CHECK (booking_version > 0),
    status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'consumed', 'revoked')),
    consent_policy_version TEXT NOT NULL DEFAULT 'public-booking-v1',
    expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '15 minutes',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    conversation_id UUID,
    consumed_at TIMESTAMPTZ,
    PRIMARY KEY (community_id, token_digest),
    FOREIGN KEY (community_id, organization_id, booking_id)
        REFERENCES airhop_bookings (community_id, organization_id, id),
    FOREIGN KEY (community_id, organization_id, connection_id)
        REFERENCES airhop_channel_connections (community_id, organization_id, id),
    FOREIGN KEY (community_id, organization_id, conversation_id)
        REFERENCES airhop_external_conversations (community_id, organization_id, id),
    CHECK ((status = 'consumed') = (consumed_at IS NOT NULL AND conversation_id IS NOT NULL))
);
CREATE UNIQUE INDEX airhop_booking_messenger_handoff_pending
    ON airhop_booking_messenger_handoffs (community_id, booking_id) WHERE status = 'issued';
CREATE INDEX airhop_booking_messenger_handoff_conversation
    ON airhop_booking_messenger_handoffs (community_id, conversation_id, consumed_at DESC)
    WHERE status = 'consumed';
