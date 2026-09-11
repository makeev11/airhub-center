// Emit a rollback-only SQL test for an existing, isolated preflight clone.
// Run with psql -v ON_ERROR_STOP=1. Never target a live database.
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../crates/buzz-db/src/airhop/welcome_guest.rs", import.meta.url), "utf8");
const literal = source.match(/sqlx::query\(\s*("(?:[^"\\]|\\.)*")/s)?.[1];
if (!literal) throw new Error("Cannot extract the production eligibility query");
const query = JSON.parse(literal.replaceAll("\n", "\\n"));
process.stdout.write(`
BEGIN;
DO $$ BEGIN
  IF current_database() NOT LIKE '%\\_preflight' ESCAPE '\\' THEN
    RAISE EXCEPTION 'Only an isolated preflight clone is allowed';
  END IF;
END $$;
CREATE FUNCTION pg_temp.guest_count(uuid, bytea) RETURNS bigint LANGUAGE sql AS $query$
  SELECT count(*) FROM (${query}) eligible
$query$;
DO $test$
DECLARE
  team airhop_welcome_teams%ROWTYPE;
  deployment airhop_agent_deployments%ROWTYPE;
  stage text;
  author bytea;
  question_id bytea := decode(repeat('da',32),'hex');
BEGIN
  SELECT * INTO STRICT team FROM airhop_welcome_teams LIMIT 1;
  SELECT * INTO STRICT deployment FROM airhop_agent_deployments
    WHERE community_id=team.community_id AND organization_id=team.organization_id;
  UPDATE airhop_agent_deployments SET enabled=true, paused=false
    WHERE community_id=deployment.community_id AND id=deployment.id;
  UPDATE channels SET archived_at=NULL, deleted_at=NULL
    WHERE community_id=team.community_id AND id=team.channel_id;
  UPDATE airhop_organizations SET status='active'
    WHERE community_id=team.community_id AND id=team.organization_id;
  UPDATE events SET deleted_at=now()
    WHERE community_id=team.community_id AND channel_id=team.channel_id;
  ASSERT pg_temp.guest_count(team.community_id,deployment.agent_pubkey)=0, 'no introductions';
  FOR stage,author IN SELECT * FROM (VALUES
    ('fizz_intro',team.fizz_pubkey), ('administrator_intro',team.administrator_pubkey),
    ('analyst_intro',team.analyst_pubkey), ('content_marketer_intro',team.content_marketer_pubkey)
  ) v(stage,author) LOOP
    INSERT INTO events (community_id,id,pubkey,created_at,kind,tags,content,sig,channel_id)
    VALUES (team.community_id,decode(md5(stage)||md5(stage),'hex'),author,now(),9,
      jsonb_build_array(jsonb_build_array('h',team.channel_id::text),
        jsonb_build_array('airhop-kickoff-stage',stage)), 'Fixture intro',decode(repeat('00',64),'hex'),team.channel_id);
  END LOOP;
  ASSERT pg_temp.guest_count(team.community_id,deployment.agent_pubkey)=1, 'eligible current Hermes';
  ASSERT pg_temp.guest_count(gen_random_uuid(),deployment.agent_pubkey)=0, 'foreign tenant';
  ASSERT pg_temp.guest_count(team.community_id,team.fizz_pubkey)=0, 'wrong guest';
  UPDATE airhop_agent_deployments SET paused=true WHERE id=deployment.id;
  ASSERT pg_temp.guest_count(team.community_id,deployment.agent_pubkey)=0, 'paused';
  UPDATE airhop_agent_deployments SET paused=false,enabled=false WHERE id=deployment.id;
  ASSERT pg_temp.guest_count(team.community_id,deployment.agent_pubkey)=0, 'disabled';
  UPDATE airhop_agent_deployments SET enabled=true WHERE id=deployment.id;
  UPDATE channels SET archived_at=now() WHERE id=team.channel_id;
  ASSERT pg_temp.guest_count(team.community_id,deployment.agent_pubkey)=0, 'archived Welcome';
  UPDATE channels SET archived_at=NULL WHERE id=team.channel_id;
  INSERT INTO events (community_id,id,pubkey,created_at,kind,tags,content,sig,channel_id)
    VALUES(team.community_id,question_id,team.registered_by_pubkey,now(),9,'[]','Owner question',
      decode(repeat('00',64),'hex'),team.channel_id);
  ASSERT pg_temp.guest_count(team.community_id,deployment.agent_pubkey)=0, 'owner interrupts';
  INSERT INTO events (community_id,id,pubkey,created_at,kind,tags,content,sig,channel_id)
    VALUES(team.community_id,decode(repeat('db',32),'hex'),team.fizz_pubkey,now(),9,
      jsonb_build_array(jsonb_build_array('airhop-responds-to',encode(question_id,'hex')),
        jsonb_build_array('airhop-kickoff-stage','fizz_intro')),
      'Not an answer',decode(repeat('00',64),'hex'),team.channel_id);
  ASSERT pg_temp.guest_count(team.community_id,deployment.agent_pubkey)=0, 'intro is not an answer';
  UPDATE events SET tags=jsonb_build_array(jsonb_build_array('airhop-responds-to',encode(question_id,'hex')))
    WHERE community_id=team.community_id AND id=decode(repeat('db',32),'hex');
  ASSERT pg_temp.guest_count(team.community_id,deployment.agent_pubkey)=1, 'resume after real answer';
  RAISE NOTICE 'PASS: guest eligibility, tenant fence, identity, pause, disable, archive, interruption, resume';
END $test$;
ROLLBACK;
`);
