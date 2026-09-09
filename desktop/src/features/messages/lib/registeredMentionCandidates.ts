import type { AirhopPrincipalDirectory } from "@/features/airhop-agents/model/principalDirectory";
import type { MentionCandidate } from "./mentionCandidates";

/** Only registered identities are callable; templates never launch from mentions. */
export function registeredMentionCandidates(
  candidates: MentionCandidate[],
  directory: AirhopPrincipalDirectory | undefined,
): MentionCandidate[] {
  const agents = new Set(directory?.agents.map((agent) => agent.pubkey));
  const services = new Set(directory?.principals.map((item) => item.pubkey));
  return candidates.filter((candidate) => {
    if (candidate.kind !== "identity" || !candidate.pubkey) return false;
    const key = candidate.pubkey.toLowerCase();
    if (agents.has(key)) return true;
    return !candidate.isAgent && !services.has(key);
  });
}
