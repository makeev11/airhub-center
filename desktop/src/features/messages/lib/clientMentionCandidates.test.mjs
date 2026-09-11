import assert from "node:assert/strict";
import test from "node:test";
import { clientMentionCandidates } from "./clientMentionCandidates.ts";
const staff = "aa".repeat(32),
  hermes = "bb".repeat(32),
  connector = "cc".repeat(32);
const conversation = {
  channelId: "channel",
  connectorPubkey: connector,
  hermesPubkey: hermes,
  hermesInChannel: true,
};
const people = [{ pubkey: staff, channelId: "channel", name: "Staff" }];
const candidates = [
  {
    kind: "identity",
    pubkey: staff,
    isAgent: false,
    isMember: true,
    displayName: "Staff",
  },
  {
    kind: "identity",
    pubkey: connector,
    isAgent: false,
    isMember: true,
    displayName: "Connector",
  },
  { kind: "persona", isAgent: true, isMember: false, displayName: "Bumble" },
];
test("client mentions contain staff and assigned Hermes, never connector or personas", () => {
  const result = clientMentionCandidates(
    candidates,
    conversation,
    people,
    new Set(),
  );
  assert.deepEqual(
    result.map((item) => item.pubkey),
    [staff, hermes],
  );
  assert.equal(result[1].isMember, true);
  assert.equal(candidates.length, 3);
});
test("real Hermes removal is preserved and internal channels keep their catalog", () => {
  assert.equal(
    clientMentionCandidates(
      candidates,
      { ...conversation, hermesInChannel: false },
      people,
      new Set([hermes]),
    )[1].isMember,
    false,
  );
  assert.equal(
    clientMentionCandidates(candidates, undefined, people, new Set()),
    candidates,
  );
});
