import type { AgentPolicies } from "@/features/airhop-agents/model/agentPolicy";

/** Closed mock of signed settings receipts; the real authority is exercised by DB tests. */
export function applyMockAgentPolicyCommand(
  policies: AgentPolicies,
  event: { kind: number; content: string },
  error?: string,
): Response {
  const command = JSON.parse(event.content);
  const entry = policies.policies.find(
    (candidate) => candidate.role === command.role,
  );
  let result: unknown;
  if (!policies.canManage) error = "owner/admin required";
  if (!entry) error = "unknown role";
  if (!error && entry) {
    if (event.kind === 9052) {
      if (command.expectedVersion !== entry.version) error = "version conflict";
      else {
        entry.version += 1;
        entry.policy = command.policy;
        result = entry;
      }
    } else if (entry.procedures) {
      if (command.expectedVersion !== entry.procedures.version)
        error = "version conflict";
      else {
        entry.procedures.version += 1;
        entry.procedures.activeId = command.procedureId;
        result = entry.procedures;
      }
    }
  }
  return new Response(
    JSON.stringify({
      accepted: !error,
      message: error ?? JSON.stringify(result),
    }),
    {
      headers: { "Content-Type": "application/json" },
    },
  );
}
