import assert from "node:assert/strict";
import test from "node:test";

import { mapMentionCandidateToSuggestion } from "./mentionSuggestionMapping.ts";

test("unresolved membership is not presented as confirmed absence", () => {
  const input = {
    candidate: { kind: "identity", isAgent: true, isMember: false },
    label: "Гермес",
    channelType: "private",
  };
  assert.equal(
    mapMentionCandidateToSuggestion({ ...input, membershipResolved: false })
      .notInChannel,
    false,
  );
  assert.equal(
    mapMentionCandidateToSuggestion({ ...input, membershipResolved: true })
      .notInChannel,
    true,
  );
});

test("Center mentions keep agent identity and membership, not owner bylines", () => {
  const candidate = {
    kind: "identity",
    pubkey: "ab".repeat(32),
    ownerPubkey: "cd".repeat(32),
    isAgent: true,
    isMember: false,
  };
  const suggestion = mapMentionCandidateToSuggestion({
    candidate,
    label: "Администратор Гермес",
    channelType: "private",
    currentPubkey: candidate.ownerPubkey,
  });
  assert.equal(suggestion.ownerLabel, null);
  assert.equal(suggestion.displayName, "Администратор Гермес");
  assert.equal(suggestion.pubkey, candidate.pubkey);
  assert.equal(suggestion.isAgent, true);
  assert.equal(suggestion.notInChannel, true);
  assert.equal(candidate.ownerPubkey, "cd".repeat(32));
});

test("Center keeps staff admin labels distinct from agent ownership", () => {
  const suggestion = mapMentionCandidateToSuggestion({
    candidate: {
      kind: "identity",
      isAgent: false,
      isMember: true,
      role: "admin",
    },
    label: "Анна",
  });
  assert.equal(suggestion.role, "admin");
  assert.equal(suggestion.ownerLabel, null);
});
