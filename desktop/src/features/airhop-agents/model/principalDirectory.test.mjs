import assert from "node:assert/strict";
import { test } from "node:test";
import {
  humanMembers,
  principalDirectorySchema,
} from "./principalDirectory.ts";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
test("human classification uses identity registrations, not profile names", () => {
  const members = [
    { pubkey: "a".repeat(64), name: "Owner" },
    { pubkey: "b".repeat(64), name: null },
    { pubkey: "c".repeat(64), name: "Hermes" },
    { pubkey: "d".repeat(64), name: null },
    { pubkey: "e".repeat(64), name: "Human named Honey" },
  ];
  const directory = principalDirectorySchema.parse({
    communityId: id,
    organizationId: id,
    agents: [],
    principals: [
      { pubkey: "c".repeat(64), kind: "agent" },
      { pubkey: "d".repeat(64), kind: "connector" },
    ],
  });
  assert.deepEqual(humanMembers(members, directory), [
    members[0],
    members[1],
    members[4],
  ]);
  assert.equal(members.length, 5);
});
test("malformed or unavailable classification is not accepted as an empty employee directory", () => {
  for (const value of [
    undefined,
    {},
    {
      communityId: id,
      organizationId: id,
      agents: [],
      principals: [{ pubkey: "bad", kind: "agent" }],
    },
  ])
    assert.equal(principalDirectorySchema.safeParse(value).success, false);
});
