export { humanMembers } from "../model/principalDirectory";
import { principalDirectorySchema } from "../model/principalDirectory";
import { useQuery } from "@tanstack/react-query";
import { useCommunities } from "@/features/communities/useCommunities";
import { AirhopControlPlaneClient } from "./airhopControlPlane";

/** Confirmed server directory. Query identity includes relay, community and signed-in user. */
export function useAirhopPrincipalDirectory(enabled = true) {
  const { activeCommunity } = useCommunities();
  return useQuery({
    queryKey: [
      "airhop-principal-directory",
      activeCommunity?.id,
      activeCommunity?.relayUrl,
      activeCommunity?.pubkey,
    ],
    enabled: enabled && Boolean(activeCommunity),
    queryFn: async () => {
      // Capture the origin so a switch cannot cache a new relay under the old key.
      if (!activeCommunity) throw new Error("No active community");
      const relay = new URL(activeCommunity.relayUrl);
      relay.protocol =
        relay.protocol === "wss:"
          ? "https:"
          : relay.protocol === "ws:"
            ? "http:"
            : relay.protocol;
      return principalDirectorySchema.parse(
        await new AirhopControlPlaneClient({
          relayHttpUrl: async () => relay.origin,
        }).getPrincipalDirectory(),
      );
    },
    staleTime: 15_000,
    refetchInterval: enabled ? 30_000 : false,
  });
}
