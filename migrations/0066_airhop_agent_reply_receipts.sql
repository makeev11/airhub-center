-- One durable response per source in the internal working channel, including
-- concurrent workers, lost HTTP acknowledgements and restarted MCP processes.
CREATE TABLE airhop_agent_reply_receipts (
    community_id uuid NOT NULL REFERENCES communities(id),
    channel_id uuid NOT NULL,
    source_event_id bytea NOT NULL CHECK (octet_length(source_event_id)=32),
    reply_event_id bytea NOT NULL CHECK (octet_length(reply_event_id)=32),
    agent_pubkey bytea NOT NULL CHECK (octet_length(agent_pubkey)=32),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id,channel_id,source_event_id)
);

INSERT INTO airhop_agent_reply_receipts(community_id,channel_id,source_event_id,reply_event_id,agent_pubkey,created_at)
SELECT DISTINCT ON(e.community_id,e.channel_id,tag->>1)
    e.community_id,e.channel_id,decode(tag->>1,'hex'),e.id,e.pubkey,e.created_at
FROM events e
JOIN airhop_welcome_teams t ON t.community_id=e.community_id AND t.channel_id=e.channel_id
CROSS JOIN LATERAL jsonb_array_elements(e.tags) tag
WHERE e.kind IN (9,46010) AND e.deleted_at IS NULL
  AND e.pubkey IN(t.fizz_pubkey,t.administrator_pubkey,t.analyst_pubkey,t.content_marketer_pubkey)
  AND tag->>0='airhop-responds-to' AND tag->>1 ~ '^[0-9a-fA-F]{64}$'
ORDER BY e.community_id,e.channel_id,tag->>1,e.created_at,e.id
ON CONFLICT DO NOTHING;

CREATE FUNCTION claim_airhop_agent_reply() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_id bytea; claimed bytea;
BEGIN
    IF NEW.kind NOT IN (9,46010) OR NOT EXISTS(
        SELECT 1 FROM jsonb_array_elements(NEW.tags) tag WHERE tag->>0='airhop-responds-to'
    ) THEN RETURN NEW; END IF;
    IF NOT EXISTS(SELECT 1 FROM airhop_welcome_teams t
        WHERE t.community_id=NEW.community_id AND t.channel_id=NEW.channel_id
          AND NEW.pubkey IN(t.fizz_pubkey,t.administrator_pubkey,t.analyst_pubkey,t.content_marketer_pubkey)
    ) THEN RETURN NEW; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.tags) tag
        WHERE tag->>0='airhop-responds-to' AND (tag->>1 IS NULL OR tag->>1 !~ '^[0-9a-fA-F]{64}$')
    ) THEN RAISE EXCEPTION 'invalid Airhop response source'; END IF;
    FOR source_id IN SELECT DISTINCT decode(tag->>1,'hex')
        FROM jsonb_array_elements(NEW.tags) tag WHERE tag->>0='airhop-responds-to' ORDER BY 1
    LOOP
        INSERT INTO airhop_agent_reply_receipts AS receipt
            (community_id,channel_id,source_event_id,reply_event_id,agent_pubkey)
        VALUES (NEW.community_id,NEW.channel_id,source_id,NEW.id,NEW.pubkey)
        ON CONFLICT(community_id,channel_id,source_event_id) DO UPDATE
            SET reply_event_id=receipt.reply_event_id
            WHERE receipt.reply_event_id=EXCLUDED.reply_event_id
        RETURNING reply_event_id INTO claimed;
        IF claimed IS NULL THEN
            RAISE EXCEPTION 'Airhop response already published for this source' USING ERRCODE='23505';
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$;
CREATE TRIGGER airhop_agent_reply_publication BEFORE INSERT ON events
FOR EACH ROW EXECUTE FUNCTION claim_airhop_agent_reply();
