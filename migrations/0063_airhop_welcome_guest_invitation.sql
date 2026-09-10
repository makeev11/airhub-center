-- One durable, short-lived publication envelope per Welcome channel. Renewal
-- is allowed only before publication. The event transaction claims the receipt
-- so concurrent old/new attempts cannot create two guest introductions.
CREATE TABLE airhop_welcome_guest_invitations (
    community_id UUID NOT NULL,
    channel_id UUID NOT NULL,
    guest_pubkey BYTEA NOT NULL CHECK (octet_length(guest_pubkey)=32),
    predecessor_id BYTEA NOT NULL CHECK (octet_length(predecessor_id)=32),
    message_created_at BIGINT NOT NULL CHECK (message_created_at>0),
    published_event_id BYTEA CHECK (octet_length(published_event_id)=32),
    PRIMARY KEY (community_id, channel_id),
    FOREIGN KEY (community_id, channel_id) REFERENCES channels(community_id,id) ON DELETE CASCADE
);

CREATE FUNCTION claim_airhop_welcome_guest_publication() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.kind=9 AND NEW.tags @> '[["airhop-kickoff-stage","hermes_guest_intro"]]'::jsonb THEN
        UPDATE airhop_welcome_guest_invitations SET published_event_id=NEW.id
        WHERE community_id=NEW.community_id AND channel_id=NEW.channel_id
          AND guest_pubkey=NEW.pubkey
          AND message_created_at=extract(epoch FROM NEW.created_at)::bigint
          AND (published_event_id IS NULL OR published_event_id=NEW.id);
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Welcome guest invitation is expired or already published'
                USING ERRCODE='23514';
        END IF;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER airhop_welcome_guest_publication
BEFORE INSERT ON events FOR EACH ROW
EXECUTE FUNCTION claim_airhop_welcome_guest_publication();
