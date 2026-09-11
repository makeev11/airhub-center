import assert from "node:assert/strict";
import test from "node:test";
import {
  agentCommunicationSchema,
  validateAgentPolicy,
} from "./agentPolicy.ts";

const legacy = {
  enabled: true,
  birthdays: null,
  analytics: null,
  content: null,
  learning: "observe",
};
test("legacy duty policies never gain conversation access during parsing", () => {
  assert.equal(validateAgentPolicy("fizz", legacy).communication, undefined);
  assert.equal(
    validateAgentPolicy("fizz", { ...legacy, communication: null })
      .communication,
    null,
  );
});
test("explicit audiences and surfaces stay independent", () => {
  for (const mode of ["staff", "owner", "selected"]) {
    for (const surfaces of ["both", "channels", "direct_messages"]) {
      const communication = {
        audience:
          mode === "selected" ? { mode, pubkeys: ["a".repeat(64)] } : { mode },
        surfaces,
      };
      assert.deepEqual(
        validateAgentPolicy("fizz", { ...legacy, communication }).communication,
        communication,
      );
    }
  }
});
test("ambiguous or empty access lists fail before signing", () => {
  for (const pubkeys of [
    [],
    ["a".repeat(64), "a".repeat(64)],
    ["A".repeat(64)],
    ["staff-name"],
  ]) {
    assert.equal(
      agentCommunicationSchema.safeParse({
        audience: { mode: "selected", pubkeys },
        surfaces: "both",
      }).success,
      false,
    );
  }
  assert.equal(
    agentCommunicationSchema.safeParse({
      audience: { mode: "staff", pubkeys: [] },
      surfaces: "both",
    }).success,
    false,
  );
  assert.throws(() =>
    validateAgentPolicy("parent_administrator", {
      ...legacy,
      communication: { audience: { mode: "staff" }, surfaces: "both" },
    }),
  );
});
