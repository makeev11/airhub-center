import * as React from "react";
import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { useCommunities } from "@/features/communities/useCommunities";

/** Keep local agent discovery inside the active relay, including stale members. */
export function useRelayManagedAgents() {
  const query = useManagedAgentsQuery();
  const { activeCommunity } = useCommunities();
  const relay = activeCommunity?.relayUrl;
  const scoped = React.useMemo(() => {
    const data = query.data?.filter(
      (agent) => relay && agent.relayUrl === relay,
    );
    const local = new Set(data?.map((agent) => agent.pubkey.toLowerCase()));
    const foreignPubkeys = new Set(
      (query.data ?? [])
        .filter(
          (agent) =>
            agent.relayUrl !== relay && !local.has(agent.pubkey.toLowerCase()),
        )
        .map((agent) => agent.pubkey.toLowerCase()),
    );
    return { data, foreignPubkeys };
  }, [query.data, relay]);
  return { ...query, ...scoped };
}
