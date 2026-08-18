import * as React from "react";

import { useWelcomeKickoff } from "@/features/onboarding/welcomeKickoff";
import type { Channel, RelayEvent } from "@/shared/api/types";

function isWelcomeKickoffStageMessage(event: RelayEvent) {
  return event.tags.some(
    (tag) => tag[0] === "airhop-kickoff-stage" && Boolean(tag[1]),
  );
}

/**
 * Runs the flat Welcome kickoff and animates only stage messages that arrive
 * after this channel view mounts. Historical receipts remain the restart
 * cursor, but revisiting Welcome never replays their entrance animation.
 */
export function useWelcomeKickoffEntrance(
  activeChannel: Channel | null,
  resolvedMessages: readonly RelayEvent[],
) {
  const [entranceMessageId, setEntranceMessageId] = React.useState<
    string | null
  >(null);
  const stageMessageIds = React.useMemo(
    () =>
      resolvedMessages
        .filter(isWelcomeKickoffStageMessage)
        .map((event) => event.id),
    [resolvedMessages],
  );
  const seenStageMessageIdsRef = React.useRef(new Set<string>());
  const stageMessageIdsRef = React.useRef(stageMessageIds);
  stageMessageIdsRef.current = stageMessageIds;

  React.useEffect(() => {
    void activeChannel?.id;
    seenStageMessageIdsRef.current = new Set(stageMessageIdsRef.current);
    setEntranceMessageId(null);
  }, [activeChannel?.id]);

  React.useEffect(() => {
    const unseen = stageMessageIds.filter(
      (eventId) => !seenStageMessageIdsRef.current.has(eventId),
    );
    for (const eventId of unseen) {
      seenStageMessageIdsRef.current.add(eventId);
    }
    const newest = unseen.at(-1);
    if (newest) setEntranceMessageId(newest);
  }, [stageMessageIds]);

  const handleEntranceComplete = React.useCallback((eventId: string) => {
    setEntranceMessageId((current) => (current === eventId ? null : current));
  }, []);

  useWelcomeKickoff(activeChannel, resolvedMessages);

  return { entranceMessageId, handleEntranceComplete };
}
