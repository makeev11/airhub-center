import * as React from "react";
import { mergeMessages } from "@/features/messages/hooks";
import {
  channelWindowThreadSummaries,
  type ChannelWindowStore,
} from "@/features/messages/lib/channelWindowStore";
import { useThreadRepliesForRoots } from "@/features/messages/useThreadReplies";
import type { Channel, RelayEvent } from "@/shared/api/types";

export function useIsHuddleTranscript(_activeChannelId: string | null) {
  // Huddle is outside the Airhop product boundary. Keeping the transcript
  // adapter inert lets ordinary channel history reuse the upstream pipeline
  // without mounting the excluded audio runtime.
  return false;
}

type HuddleChannelMessagesOptions = {
  activeChannel: Channel | null;
  findEvents: RelayEvent[];
  isHuddleTranscript: boolean;
  messages: RelayEvent[];
  targetMessageEvents: RelayEvent[];
  windowStore?: ChannelWindowStore;
};

export function useHuddleChannelMessages({
  activeChannel,
  findEvents,
  isHuddleTranscript,
  messages,
  targetMessageEvents,
  windowStore,
}: HuddleChannelMessagesOptions) {
  const resolvedChannelMessages = React.useMemo(() => {
    const extraEvents = [...targetMessageEvents, ...findEvents];
    if (!activeChannel || extraEvents.length === 0) return messages;
    return extraEvents.reduce(mergeMessages, messages);
  }, [activeChannel, findEvents, messages, targetMessageEvents]);

  const threadSummaries = React.useMemo(
    () => (windowStore ? channelWindowThreadSummaries(windowStore) : new Map()),
    [windowStore],
  );
  const huddleThreadRootIds = React.useMemo(
    () =>
      isHuddleTranscript
        ? [...threadSummaries.entries()]
            .filter(([, summary]) => summary.descendantCount > 0)
            .map(([rootId]) => rootId)
        : [],
    [isHuddleTranscript, threadSummaries],
  );
  const huddleThreadReplies = useThreadRepliesForRoots(
    activeChannel,
    huddleThreadRootIds,
  );
  const resolvedMessages = React.useMemo(
    () =>
      isHuddleTranscript
        ? huddleThreadReplies.events.reduce(
            mergeMessages,
            resolvedChannelMessages,
          )
        : resolvedChannelMessages,
    [huddleThreadReplies.events, isHuddleTranscript, resolvedChannelMessages],
  );

  return { resolvedMessages, threadSummaries };
}
