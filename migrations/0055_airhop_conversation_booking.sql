-- One durable, versioned intake per conversation; no seat is held by a draft.
CREATE TABLE airhop_conversation_booking_drafts (
    community_id UUID NOT NULL,
    organization_id UUID NOT NULL,
    conversation_id UUID NOT NULL,
    version BIGINT NOT NULL CHECK (version > 0),
    state TEXT NOT NULL CHECK (state IN ('collecting', 'ready', 'cancelled', 'booked')),
    data JSONB NOT NULL CHECK (jsonb_typeof(data) = 'object'),
    quote JSONB,
    preview TEXT,
    booking_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, conversation_id),
    FOREIGN KEY (community_id, organization_id, conversation_id)
        REFERENCES airhop_external_conversations (community_id, organization_id, id),
    FOREIGN KEY (community_id, organization_id, booking_id)
        REFERENCES airhop_bookings (community_id, organization_id, id),
    CHECK ((state = 'booked') = (booking_id IS NOT NULL)),
    CHECK (state NOT IN ('ready', 'booked') OR (preview IS NOT NULL AND quote IS NOT NULL))
);

ALTER TABLE airhop_consents DROP CONSTRAINT airhop_consents_channel_check;
ALTER TABLE airhop_consents ADD CONSTRAINT airhop_consents_channel_check
    CHECK (channel IN ('web', 'staff_ui', 'fizz', 'import', 'hermes'));
