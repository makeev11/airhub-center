import type { TimelineMessage } from "@/features/messages/types";
import { useClientChannel } from "./useClientChannel";
import { clientMessagePresentation } from "./clientPresentation";

export function useClientThreadPresentation(
  channelId: string | null,
  head: TimelineMessage | null,
  reply: TimelineMessage | null,
) {
  const channel = useClientChannel(channelId, head?.rootId ?? head?.id);
  const items = channel.data?.items ?? [];
  return {
    clientHead: head ? clientMessagePresentation(items, head) : null,
    clientReply: reply ? clientMessagePresentation(items, reply) : null,
  };
}
