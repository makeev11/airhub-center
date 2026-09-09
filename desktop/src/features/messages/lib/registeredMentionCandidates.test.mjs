import assert from "node:assert/strict";
import test from "node:test";
import { registeredMentionCandidates } from "./registeredMentionCandidates.ts";
const human = { kind: "identity", pubkey: "aa", isAgent: false };
const agent = { kind: "identity", pubkey: "bb", isAgent: true };
const candidates = [
  human,
  agent,
  { kind: "identity", pubkey: "cc", isAgent: true },
  { kind: "identity", pubkey: "dd", isAgent: false },
  { kind: "persona", isAgent: true },
  { kind: "team", isAgent: true },
];
test("only registered agents and humans survive; stale agents and templates cannot launch", () => {
  assert.deepEqual(
    registeredMentionCandidates(candidates, {
      agents: [{ pubkey: "bb" }],
      principals: [{ pubkey: "dd", kind: "connector" }],
    }),
    [human, agent],
  );
});
test("unknown agent registry fails closed for agents but preserves human mentions", () => {
  assert.deepEqual(registeredMentionCandidates([human, agent], undefined), [
    human,
  ]);
});
