-- Freeze the server's leased configuration when it actually participates in an
-- enquiry. Never infer old exposures from today's deployment configuration.
ALTER TABLE airhop_consultations ADD COLUMN version_tracking_started BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE airhop_consultation_exposures (
    community_id UUID NOT NULL,
    organization_id UUID NOT NULL,
    consultation_id UUID NOT NULL,
    turn_id UUID NOT NULL,
    configuration JSONB NOT NULL CHECK (jsonb_typeof(configuration)='object'),
    family_linked BOOLEAN NOT NULL,
    handed_off BOOLEAN NOT NULL DEFAULT FALSE,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (community_id,consultation_id,turn_id),
    FOREIGN KEY (community_id,organization_id,consultation_id)
        REFERENCES airhop_consultations(community_id,organization_id,id),
    FOREIGN KEY (community_id,organization_id,turn_id)
        REFERENCES airhop_hermes_turn_receipts(community_id,organization_id,id)
);
