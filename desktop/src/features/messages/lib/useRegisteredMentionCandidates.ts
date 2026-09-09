import { useMemo } from "react";
import { useAirhopPrincipalDirectory } from "@/features/airhop-agents/data/principalDirectory";
import type { MentionCandidate } from "./mentionCandidates";
import { registeredMentionCandidates } from "./registeredMentionCandidates";

/** Community-scoped registry is the source of agent eligibility. */
export function useRegisteredMentionCandidates(candidates: MentionCandidate[]) {
  const directory = useAirhopPrincipalDirectory();
  return useMemo(
    () => registeredMentionCandidates(candidates, directory.data),
    [candidates, directory.data],
  );
}
