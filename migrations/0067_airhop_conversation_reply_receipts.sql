-- Extend the existing atomic single-response fence to authorized DMs and
-- stream channels. Historical migration 0066 remains checksum-immutable.
ALTER TABLE airhop_agent_task_sources ADD COLUMN source_human_event_id bytea
    CHECK (source_human_event_id IS NULL OR octet_length(source_human_event_id)=32);

CREATE OR REPLACE FUNCTION claim_airhop_agent_reply() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_id bytea; claimed bytea;
BEGIN
    IF NEW.kind NOT IN (9,46010) OR NOT EXISTS(
        SELECT 1 FROM jsonb_array_elements(NEW.tags) tag WHERE tag->>0='airhop-responds-to'
    ) THEN RETURN NEW; END IF;
    IF NOT EXISTS(SELECT 1 FROM airhop_welcome_teams t
        WHERE t.community_id=NEW.community_id
          AND NEW.pubkey IN(t.fizz_pubkey,t.administrator_pubkey,t.analyst_pubkey,t.content_marketer_pubkey)
    ) THEN RETURN NEW; END IF;
    IF NEW.channel_id IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.tags) tag
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
