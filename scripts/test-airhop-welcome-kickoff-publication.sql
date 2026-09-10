-- Run only against the isolated native E2E fixture after migrations. All
-- mutations are rolled back; existing signed messages are never rewritten.
BEGIN;
DO $$
DECLARE sample events%ROWTYPE; first_id BYTEA := decode(repeat('ab',32),'hex');
BEGIN
  SELECT e.* INTO STRICT sample FROM events e
    JOIN airhop_welcome_teams t ON t.community_id=e.community_id AND t.channel_id=e.channel_id
    JOIN airhop_organizations o ON o.community_id=t.community_id AND o.id=t.organization_id
    WHERE o.name='AirHop E2E Center' AND e.kind=9
      AND e.tags @> '[["airhop-kickoff-stage","content_marketer_intro"]]'::jsonb
    ORDER BY e.created_at LIMIT 1;
  DELETE FROM airhop_welcome_kickoff_receipts
    WHERE community_id=sample.community_id AND channel_id=sample.channel_id
      AND stage='content_marketer_intro';
  INSERT INTO events(community_id,id,pubkey,created_at,kind,tags,content,sig,channel_id)
    VALUES(sample.community_id,first_id,sample.pubkey,now(),9,sample.tags,
      'SQL publication probe',sample.sig,sample.channel_id);
  BEGIN
    INSERT INTO events(community_id,id,pubkey,created_at,kind,tags,content,sig,channel_id)
      VALUES(sample.community_id,decode(repeat('ac',32),'hex'),sample.pubkey,now(),9,
        sample.tags,'Repeated SQL publication probe',sample.sig,sample.channel_id);
    RAISE EXCEPTION 'Duplicate introduction was accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM<>'Welcome introduction already published' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO events(community_id,id,pubkey,created_at,kind,tags,content,sig,channel_id)
      VALUES(sample.community_id,decode(repeat('ad',32),'hex'),decode(repeat('ae',32),'hex'),
        now(),9,sample.tags,'Wrong role probe',sample.sig,sample.channel_id);
    RAISE EXCEPTION 'Foreign introduction author was accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM<>'Invalid Welcome introduction author or stage' THEN RAISE; END IF;
  END;
  IF NOT EXISTS(SELECT 1 FROM airhop_welcome_kickoff_receipts
    WHERE community_id=sample.community_id AND channel_id=sample.channel_id
      AND stage='content_marketer_intro' AND receipt_event_id=first_id) THEN
    RAISE EXCEPTION 'Publication receipt does not reference the accepted event';
  END IF;
END $$;
ROLLBACK;
