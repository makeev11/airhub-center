-- No transcript backfill: historical conversations have unknown question coverage.
CREATE TABLE airhop_consultations (
    community_id UUID NOT NULL,
    organization_id UUID NOT NULL,
    conversation_id UUID NOT NULL,
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    closed_at TIMESTAMPTZ,
    closed_reason TEXT CHECK (closed_reason IN ('booked','declined','cancelled')),
    closed_source_event_id BYTEA,
    group_selected_at TIMESTAMPTZ,
    time_selected_at TIMESTAMPTZ,
    details_complete_at TIMESTAMPTZ,
    booking_id UUID,
    PRIMARY KEY (community_id,id),
    UNIQUE (community_id,organization_id,id),
    FOREIGN KEY (community_id,organization_id,conversation_id)
        REFERENCES airhop_external_conversations(community_id,organization_id,id),
    FOREIGN KEY (community_id,organization_id,booking_id)
        REFERENCES airhop_bookings(community_id,organization_id,id),
    CHECK ((closed_at IS NULL) = (closed_reason IS NULL)),
    CHECK ((booking_id IS NOT NULL) = (closed_reason IS NOT DISTINCT FROM 'booked'))
);
CREATE UNIQUE INDEX airhop_consultation_open_idx
    ON airhop_consultations(community_id,conversation_id) WHERE closed_at IS NULL;
CREATE INDEX airhop_consultation_period_idx
    ON airhop_consultations(community_id,organization_id,started_at,id);

CREATE TABLE airhop_consultation_questions (
    community_id UUID NOT NULL,
    organization_id UUID NOT NULL,
    consultation_id UUID NOT NULL,
    event_id BYTEA NOT NULL CHECK (octet_length(event_id)=32),
    source_event_id BYTEA NOT NULL CHECK (octet_length(source_event_id)=32),
    question TEXT CHECK (question IN ('age','branch','activity','time','contact','confirmation','other')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (community_id,event_id),
    FOREIGN KEY (community_id,organization_id,consultation_id)
        REFERENCES airhop_consultations(community_id,organization_id,id)
);
CREATE INDEX airhop_consultation_question_timeline_idx
    ON airhop_consultation_questions(community_id,consultation_id,created_at DESC,event_id);
CREATE INDEX airhop_consultation_inbound_idx
    ON airhop_gateway_inbound_receipts(community_id,conversation_id,received_at);
CREATE INDEX airhop_consultation_delivery_idx
    ON airhop_external_message_outbox(community_id,conversation_id,created_at DESC);
