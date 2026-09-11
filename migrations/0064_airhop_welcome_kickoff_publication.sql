-- A model may retry a successful tool call. Claim the internal introduction
-- in the event transaction, not in a client's in-memory kickoff state.
INSERT INTO airhop_welcome_kickoff_receipts
    (community_id, organization_id, channel_id, stage, task_id, agent_pubkey, receipt_event_id)
SELECT DISTINCT ON (e.community_id, e.channel_id, s.stage)
    e.community_id, t.organization_id, e.channel_id, s.stage, gen_random_uuid(), e.pubkey, e.id
FROM events e
JOIN airhop_welcome_teams t ON t.community_id=e.community_id AND t.channel_id=e.channel_id
CROSS JOIN LATERAL (VALUES
    ('fizz_intro', t.fizz_pubkey),
    ('administrator_intro', t.administrator_pubkey),
    ('analyst_intro', t.analyst_pubkey),
    ('content_marketer_intro', t.content_marketer_pubkey),
    ('fizz_first_question', t.fizz_pubkey)
) s(stage, author)
WHERE e.kind=9 AND e.pubkey=s.author
  AND e.tags @> jsonb_build_array(jsonb_build_array('airhop-kickoff-stage', s.stage))
ORDER BY e.community_id, e.channel_id, s.stage, e.created_at, e.id
ON CONFLICT (community_id, channel_id, stage) DO NOTHING;

CREATE FUNCTION claim_airhop_welcome_kickoff_publication() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE stage_name TEXT; team airhop_welcome_teams%ROWTYPE; expected_author BYTEA;
BEGIN
    IF NEW.kind<>9 THEN RETURN NEW; END IF;
    SELECT tag->>1 INTO stage_name FROM jsonb_array_elements(NEW.tags) tag
      WHERE tag->>0='airhop-kickoff-stage' LIMIT 1;
    IF stage_name IS NULL OR stage_name='hermes_guest_intro' THEN RETURN NEW; END IF;
    SELECT * INTO team FROM airhop_welcome_teams
      WHERE community_id=NEW.community_id AND channel_id=NEW.channel_id;
    expected_author := CASE stage_name
      WHEN 'fizz_intro' THEN team.fizz_pubkey
      WHEN 'fizz_first_question' THEN team.fizz_pubkey
      WHEN 'administrator_intro' THEN team.administrator_pubkey
      WHEN 'analyst_intro' THEN team.analyst_pubkey
      WHEN 'content_marketer_intro' THEN team.content_marketer_pubkey END;
    IF expected_author IS NULL OR expected_author<>NEW.pubkey
      OR (SELECT count(*) FROM jsonb_array_elements(NEW.tags) tag
          WHERE tag->>0='airhop-kickoff-stage')<>1 THEN
      RAISE EXCEPTION 'Invalid Welcome introduction author or stage' USING ERRCODE='23514';
    END IF;
    INSERT INTO airhop_welcome_kickoff_receipts AS receipt
      (community_id, organization_id, channel_id, stage, task_id, agent_pubkey, receipt_event_id)
    VALUES (NEW.community_id, team.organization_id, NEW.channel_id, stage_name,
      gen_random_uuid(), NEW.pubkey, NEW.id)
    ON CONFLICT (community_id, channel_id, stage) DO UPDATE
      SET receipt_event_id=EXCLUDED.receipt_event_id
      WHERE receipt.receipt_event_id=EXCLUDED.receipt_event_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Welcome introduction already published' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER airhop_welcome_kickoff_publication
BEFORE INSERT ON events FOR EACH ROW
EXECUTE FUNCTION claim_airhop_welcome_kickoff_publication();
