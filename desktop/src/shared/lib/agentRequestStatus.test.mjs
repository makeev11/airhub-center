import assert from "node:assert/strict";
import test from "node:test";

import {
  agentRequestStatusAction,
  computeAgentRequestStatus,
  extractAgentRequestStatus,
} from "./agentRequestStatus.ts";

const RELAY = "aa".repeat(32);
const payload = {
  version: 1,
  source_event_id: "bb".repeat(32),
  source_channel_id: "550e8400-e29b-41d4-a716-446655440000",
  target_role: "analyst",
  reason: "external_readers",
};
const content = `fallback\n\n\`\`\`buzz:agent-request-status\n${JSON.stringify(payload)}\n\`\`\``;

test("extracts a valid corrective status and selects channel members", () => {
  assert.deepEqual(extractAgentRequestStatus(content), payload);
  assert.equal(agentRequestStatusAction(payload.reason), "channel_members");
  assert.equal(agentRequestStatusAction("policy_denied"), "agent_settings");
});

test("renders only an interactive status signed by the active relay", () => {
  assert.deepEqual(
    computeAgentRequestStatus(content, true, RELAY, RELAY),
    payload,
  );
  assert.equal(computeAgentRequestStatus(content, false, RELAY, RELAY), null);
  assert.equal(
    computeAgentRequestStatus(content, true, "cc".repeat(32), RELAY),
    null,
  );
  assert.equal(computeAgentRequestStatus(content, true, RELAY, null), null);
});

test("rejects malformed and unknown payloads", () => {
  assert.equal(extractAgentRequestStatus("no sentinel"), null);
  assert.equal(
    extractAgentRequestStatus(
      content.replace("external_readers", "reader_public_keys"),
    ),
    null,
  );
  assert.equal(
    extractAgentRequestStatus(
      content.replace(payload.source_event_id, "short"),
    ),
    null,
  );
});
