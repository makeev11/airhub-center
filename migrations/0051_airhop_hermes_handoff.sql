-- A final reply contains up to three parent messages and one internal staff
-- handoff. Internal mentions never enter the provider delivery outbox.
ALTER TABLE airhop_hermes_outbound_intents
    DROP CONSTRAINT airhop_hermes_outbound_intents_sequence_check;
ALTER TABLE airhop_hermes_outbound_intents
    ADD CONSTRAINT airhop_hermes_outbound_intents_sequence_check
    CHECK (sequence BETWEEN 1 AND 4);
