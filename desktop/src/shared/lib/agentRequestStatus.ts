export type AgentRequestStatusReason =
  | "agent_disabled"
  | "agent_not_in_channel"
  | "policy_denied"
  | "external_readers";

export type AgentRequestStatusPayload = {
  version: 1;
  source_event_id: string;
  source_channel_id: string;
  target_role: "fizz" | "administrator" | "analyst" | "content_marketer";
  reason: AgentRequestStatusReason;
};

const FENCE_OPEN = "```buzz:agent-request-status";
const FENCE_CLOSE = "```";
const EVENT_ID = /^[0-9a-f]{64}$/i;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLES = new Set(["fizz", "administrator", "analyst", "content_marketer"]);
const REASONS = new Set([
  "agent_disabled",
  "agent_not_in_channel",
  "policy_denied",
  "external_readers",
]);

/** Parse the relay-authored corrective status payload. Never throws. */
export function extractAgentRequestStatus(
  content: string,
): AgentRequestStatusPayload | null {
  const open = content.indexOf(FENCE_OPEN);
  if (open === -1) return null;
  const jsonStart = content.indexOf("\n", open);
  if (jsonStart === -1) return null;
  const close = content.indexOf(`\n${FENCE_CLOSE}`, jsonStart);
  if (close === -1) return null;
  try {
    const value: unknown = JSON.parse(
      content.slice(jsonStart + 1, close).trim(),
    );
    if (typeof value !== "object" || value === null) return null;
    const payload = value as Record<string, unknown>;
    if (
      payload.version !== 1 ||
      typeof payload.source_event_id !== "string" ||
      !EVENT_ID.test(payload.source_event_id) ||
      typeof payload.source_channel_id !== "string" ||
      !UUID.test(payload.source_channel_id) ||
      typeof payload.target_role !== "string" ||
      !ROLES.has(payload.target_role) ||
      typeof payload.reason !== "string" ||
      !REASONS.has(payload.reason)
    ) {
      return null;
    }
    return payload as AgentRequestStatusPayload;
  } catch {
    return null;
  }
}

/** Render a card only for a kind:9 message signed by the active relay. */
export function computeAgentRequestStatus(
  content: string,
  interactive: boolean,
  signerPubkey: string | null | undefined,
  relaySelfPubkey: string | null | undefined,
): AgentRequestStatusPayload | null {
  if (!interactive || !signerPubkey || !relaySelfPubkey) return null;
  if (
    signerPubkey.trim().toLowerCase() !== relaySelfPubkey.trim().toLowerCase()
  ) {
    return null;
  }
  return extractAgentRequestStatus(content);
}

export type AgentRequestStatusAction = "channel_members" | "agent_settings";

/** Stable UI destination for each safe denial category. */
export function agentRequestStatusAction(
  reason: AgentRequestStatusReason,
): AgentRequestStatusAction {
  return reason === "external_readers" || reason === "agent_not_in_channel"
    ? "channel_members"
    : "agent_settings";
}
