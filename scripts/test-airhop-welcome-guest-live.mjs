// Local harness only. Seeds fresh test identities, never uses an account key.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const require = createRequire(new URL("../desktop/package.json", import.meta.url));
const { finalizeEvent, getPublicKey } = require("nostr-tools");
const base = "http://localhost:3030";
// Fail before seeding identities if the caller has not awaited relay startup.
await fetch(base, { signal: AbortSignal.timeout(5000) });
const sqlString = (s) => `'${String(s).replaceAll("'", "''")}'`;
const bytes = (hex) => `decode('${hex}','hex')`;
function sql(query) {
  return execFileSync("docker", ["exec", "-i", "buzz-harness-postgres-1", "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "buzz", "-d", "buzz", "-At"], {input: query, encoding: "utf8"}).trim();
}
const community = sql("SELECT id FROM communities WHERE host='localhost:3030'");
assert.match(community, /^[0-9a-f-]{36}$/);
assert.equal(sql(`SELECT count(*) FROM airhop_welcome_teams WHERE community_id='${community}'`), "0", "use a freshly prepared local harness, never overwrite a team");
const keys = Array.from({length: 6}, () => crypto.getRandomValues(new Uint8Array(32)));
const pub = keys.map(getPublicKey);
const channel = randomUUID();
const org = sql(`SELECT id FROM airhop_organizations WHERE community_id='${community}'`) || randomUUID();
const now = Math.floor(Date.now()/1000);
const stages = ["fizz_intro", "administrator_intro", "analyst_intro", "content_marketer_intro"];
const intros = stages.map((stage,i) => finalizeEvent({kind:9,created_at:now-3600+i,tags:[["h",channel],["airhop-kickoff-stage",stage]],content:`Private test introduction ${stage}`},keys[i+1]));
sql(`BEGIN;
INSERT INTO airhop_organizations(community_id,id,name,locale,time_zone,default_trial_policy)
VALUES('${community}','${org}','Guest test','ru-RU','Europe/Moscow','{"mode":"free"}') ON CONFLICT DO NOTHING;
${pub.map(p => `INSERT INTO users(community_id,pubkey,agent_type) VALUES('${community}',${bytes(p)},'managed-agent');
INSERT INTO relay_members(community_id,pubkey,role) VALUES('${community}','${p}','member');`).join("\n")}
INSERT INTO channels(community_id,id,name,visibility,created_by) VALUES('${community}','${channel}','Welcome','private',${bytes(pub[0])});
INSERT INTO airhop_welcome_teams(community_id,organization_id,channel_id,locale,fizz_pubkey,administrator_pubkey,analyst_pubkey,content_marketer_pubkey,registered_by_pubkey)
VALUES('${community}','${org}','${channel}','ru-RU',${pub.slice(1,5).map(bytes).join(',')},${bytes(pub[0])});
INSERT INTO airhop_agent_deployments(community_id,organization_id,id,blueprint_key,blueprint_version,role,agent_pubkey,profile_ref,runtime_revision,persona_revision,skills_revision,model_revision,registered_by_pubkey)
VALUES('${community}','${org}','${randomUUID()}','airhop.hermes.parent_administrator',1,'parent_administrator',${bytes(pub[5])},'test','test','test','test','test',${bytes(pub[0])});
${intros.map(e => `INSERT INTO events(community_id,id,pubkey,created_at,kind,tags,content,sig,channel_id) VALUES('${community}',${bytes(e.id)},${bytes(e.pubkey)},to_timestamp(${e.created_at}),9,${sqlString(JSON.stringify(e.tags))}::jsonb,${sqlString(e.content)},${bytes(e.sig)},'${channel}');`).join("\n")}
COMMIT;`);

async function request(path, method, body) {
  const encoded = body === undefined ? undefined : JSON.stringify(body);
  const tags = [["u",base+path],["method",method],["nonce",randomUUID()]];
  if(encoded !== undefined) tags.push(["payload",createHash("sha256").update(encoded).digest("hex")]);
  const auth = finalizeEvent({kind:27235,created_at:Math.floor(Date.now()/1000),tags,content:""},keys[5]);
  const response = await fetch(base+path,{method,headers:{Authorization:`Nostr ${Buffer.from(JSON.stringify(auth)).toString("base64")}`,"Content-Type":"application/json"},body:encoded,signal:AbortSignal.timeout(10000)});
  return {status:response.status,body:await response.json()};
}
const offered = await request("/api/airhop/agents/v1/welcome-team","GET");
assert.equal(offered.status,200,JSON.stringify(offered.body));
assert.deepEqual(Object.keys(offered.body),["guestInvitation"]);
const invitation = offered.body.guestInvitation;
assert.equal(invitation.channelId,channel);
assert.equal(invitation.guestPubkey,pub[5]);
assert.equal(invitation.invitationId,intros[3].id);
assert(invitation.createdAt >= now-5, "an old predecessor must receive a fresh publication timestamp");
assert.deepEqual((await request("/api/airhop/agents/v1/welcome-team","GET")).body, offered.body, "poll retries must reuse one envelope");
// Read the exact product-owned copy, not a separate test approximation.
const protocol = readFileSync(new URL("../crates/buzz-core/src/welcome_guest.rs",import.meta.url),"utf8");
const content = JSON.parse(protocol.match(/Self::Ru => ("[^\n]*"),/)[1]);
const envelope = {kind:9,created_at:invitation.createdAt,tags:[["h",channel],["airhop-kickoff-stage","hermes_guest_intro"],["airhop-guest-invitation",invitation.invitationId]],content};
const event = finalizeEvent(envelope,keys[5]);
// Probe restrictions while the invitation is still valid, not only after use.
for(const invalid of [
  {...envelope,content:"arbitrary guest message"},
  {...envelope,created_at:now,tags:[["h",channel]],content:"ordinary message without membership"},
  {...envelope,tags:[...envelope.tags,["e",intros[0].id]]},
]) {
  const rejected = await request("/events","POST",finalizeEvent(invalid,keys[5]));
  assert.notEqual(rejected.body.accepted,true,"guest permission must not allow arbitrary writes");
}
const attempts = await Promise.all([
  request("/events","POST",event),
  request("/events","POST",event),
]);
assert(attempts.some(result => result.body.accepted === true), JSON.stringify(attempts));
await request("/events","POST",event);
assert.equal(sql(`SELECT count(*) FROM events WHERE community_id='${community}' AND id=${bytes(event.id)}`),"1","concurrent publication and replay must not duplicate the intro");
assert.equal(sql(`SELECT encode(published_event_id,'hex') FROM airhop_welcome_guest_invitations WHERE community_id='${community}' AND channel_id='${channel}'`),event.id,"publication receipt must commit with the event");
const history = await request("/query","POST",[{kinds:[9],"#h":[channel],limit:100}]);
assert([200,403].includes(history.status),JSON.stringify(history));
if(history.status===200) assert.deepEqual(history.body,[],"a guest receives no channel history");
assert(!intros.some(e => JSON.stringify(history.body).includes(e.id)),"guest must not read private history");
assert.equal(sql(`SELECT count(*) FROM channel_members WHERE community_id='${community}' AND channel_id='${channel}' AND pubkey=${bytes(pub[5])} AND removed_at IS NULL`),"0");
assert.deepEqual((await request("/api/airhop/agents/v1/welcome-team","GET")).body,{guestInvitation:null});
console.log("PASS: restricted invitation after old predecessor, fresh signed intro, replay, forbidden writes, no private-history leak, no guest membership");
