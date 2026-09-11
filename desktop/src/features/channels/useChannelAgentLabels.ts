import { useMemo } from "react";
import { usePersonasQuery } from "@/features/agents/hooks";
import type { ManagedAgent, RespondToMode } from "@/shared/api/types";

export function useChannelAgentLabels(agents: readonly ManagedAgent[]) {
  const personasQuery = usePersonasQuery();
  return useMemo(() => {
    const personaById = new Map(
      (personasQuery.data ?? []).map((persona) => [
        persona.id,
        persona.displayName,
      ]),
    );
    const personaLookup = new Map<string, string>();
    const respondToLookup = new Map<string, RespondToMode>();
    for (const agent of agents) {
      const key = agent.pubkey.toLowerCase();
      respondToLookup.set(key, agent.respondTo);
      // Product agents already have their localized identity as the author.
      // Their underlying English persona-pack name is not a second identity.
      const name = agent.personaId ? personaById.get(agent.personaId) : null;
      if (name && !agent.personaId?.startsWith("builtin:airhop-")) {
        personaLookup.set(key, name);
      }
    }
    return { personaLookup, respondToLookup };
  }, [agents, personasQuery.data]);
}
