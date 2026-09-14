import * as React from "react";
import { loadInboxContextEvent } from "./lib/loadInboxContextEvent";
import {
  type InboxContextUnavailable,
  loadInboxThreadContext,
} from "./lib/loadInboxThreadContext";

import { isInboxThreadContextEvent } from "@/features/home/lib/inboxViewHelpers";
import { relayEventFromFeedItem } from "@/features/home/lib/inbox";
import { getThreadReference } from "@/features/messages/lib/threading";
import { relayClient } from "@/shared/api/relayClient";
import { buildChannelReactionAuxFilter } from "@/shared/api/relayChannelFilters";
import { getEventById } from "@/shared/api/tauri";
import type { FeedItem, RelayEvent } from "@/shared/api/types";
import {
  CHANNEL_TIMELINE_CONTENT_KINDS,
  HOME_MENTION_EVENT_KINDS,
} from "@/shared/constants/kinds";

type InboxThreadContextResult = {
  events: RelayEvent[];
  hasLoadError: boolean;
  unavailable: InboxContextUnavailable;
  isCheckingAvailability: boolean;
  isLoading: boolean;
  /** kind:7 events referencing the context messages, fetched by `#e`. */
  reactionEvents: RelayEvent[];
  /** Re-fetch reaction events (e.g. after a toggle) without reloading context. */
  refreshReactions: () => Promise<void>;
  retry: () => void;
};

const THREAD_CONTEXT_LIMIT = 100;
const CHANNEL_CONTEXT_EVENT_KINDS = new Set<number>([
  ...CHANNEL_TIMELINE_CONTENT_KINDS,
  ...HOME_MENTION_EVENT_KINDS,
]);

function dedupeEvents(events: RelayEvent[]): RelayEvent[] {
  const eventsById = new Map<string, RelayEvent>();
  for (const event of events) {
    eventsById.set(event.id, event);
  }
  return [...eventsById.values()].sort((a, b) => a.created_at - b.created_at);
}

function getThreadRootId(event: RelayEvent): string {
  const thread = getThreadReference(event.tags);
  return thread.rootId ?? thread.parentId ?? event.id;
}

export function useInboxThreadContext(
  item: FeedItem | null,
  channelMessages: RelayEvent[] | undefined,
  options: {
    fullChannel?: boolean;
    hasChannelLoadError?: boolean;
    isChannelLoading?: boolean;
  } = {},
): InboxThreadContextResult {
  const [retryVersion, setRetryVersion] = React.useState(0);
  const retry = React.useCallback(
    () => setRetryVersion((version) => version + 1),
    [],
  );
  const channelMessagesRef = React.useRef(channelMessages);
  channelMessagesRef.current = channelMessages;
  const [fetchedEvents, setFetchedEvents] = React.useState<RelayEvent[]>([]);
  const [loadStatus, setLoadStatus] = React.useState<{
    selectionKey: string;
    hasLoadError: boolean;
    unavailable: InboxContextUnavailable;
  } | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);

  const selectedEvent = React.useMemo(
    () => (item ? relayEventFromFeedItem(item) : null),
    [item],
  );

  const selectedThreadRootId = selectedEvent
    ? getThreadRootId(selectedEvent)
    : null;
  const selectedParentId = selectedEvent
    ? getThreadReference(selectedEvent.tags).parentId
    : null;
  const selectedChannelId = item?.channelId ?? null;
  const fullChannel = options.fullChannel === true;
  const selectionKey = `${selectedChannelId}:${selectedEvent?.id}:${selectedThreadRootId}:${selectedParentId}`;

  // biome-ignore lint/correctness/useExhaustiveDependencies: retryVersion explicitly restarts a failed context load on user request.
  React.useEffect(() => {
    let isCancelled = false;

    if (fullChannel || !selectedEvent || !selectedThreadRootId) {
      setFetchedEvents([]);
      setLoadStatus(null);
      setIsLoading(false);
      return () => {
        isCancelled = true;
      };
    }

    async function loadContext() {
      const targetEvent = selectedEvent;
      const threadRootId = selectedThreadRootId;
      if (!targetEvent || !threadRootId) {
        return;
      }

      setIsLoading(true);
      // Background feed refreshes must not disable a verified composer or
      // briefly enable an unavailable one. A different selection is fenced
      // synchronously by selectionKey below.
      setLoadStatus((previous) =>
        previous?.selectionKey === selectionKey
          ? { ...previous, hasLoadError: false }
          : null,
      );

      try {
        const selection = {
          selectedChannelId,
          selectedEventId: targetEvent.id,
          selectedParentId,
          selectedThreadRootId: threadRootId,
        };
        const result = await loadInboxThreadContext({
          selectedEvent: targetEvent,
          onError: (error) =>
            console.error("Failed to load Inbox message context", error),
          loadEvent: (eventId) =>
            loadInboxContextEvent({
              eventId,
              channelId: selectedChannelId,
              getCachedEvents: () => channelMessagesRef.current ?? [],
              requireRemote: true,
              fetchEvent: getEventById,
              fetchChannelEvents: (channelId, id) =>
                relayClient.fetchEvents({
                  ids: [id],
                  "#h": [channelId],
                  kinds: [...CHANNEL_CONTEXT_EVENT_KINDS],
                  limit: 1,
                }),
            }),
          loadDescendants: (rootId) =>
            selectedChannelId
              ? relayClient.fetchEvents({
                  "#e": [rootId],
                  "#h": [selectedChannelId],
                  kinds: [...HOME_MENTION_EVENT_KINDS],
                  limit: THREAD_CONTEXT_LIMIT,
                })
              : Promise.resolve([]),
        });

        if (isCancelled) {
          return;
        }

        setLoadStatus({
          selectionKey,
          hasLoadError: result.hasLoadError,
          unavailable: result.unavailable,
        });
        setFetchedEvents(
          dedupeEvents(
            result.events.filter(
              (event): event is RelayEvent =>
                event !== null && isInboxThreadContextEvent(event, selection),
            ),
          ),
        );
      } catch (error) {
        if (!isCancelled) {
          console.error("Failed to load Inbox message context", error);
          setLoadStatus({
            selectionKey,
            hasLoadError: true,
            unavailable: null,
          });
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadContext();

    return () => {
      isCancelled = true;
    };
  }, [
    selectedChannelId,
    selectedEvent,
    selectedParentId,
    selectedThreadRootId,
    fullChannel,
    retryVersion,
    selectionKey,
  ]);

  const events = React.useMemo(() => {
    if (!selectedEvent) {
      return [];
    }

    if (fullChannel) {
      return dedupeEvents([
        selectedEvent,
        ...(channelMessages ?? []).filter((event) =>
          CHANNEL_CONTEXT_EVENT_KINDS.has(event.kind),
        ),
      ]);
    }

    const localContext = (channelMessages ?? []).filter((event) => {
      return isInboxThreadContextEvent(event, {
        selectedChannelId,
        selectedEventId: selectedEvent.id,
        selectedParentId,
        selectedThreadRootId,
      });
    });

    const currentFetchedEvents = fetchedEvents.filter((event) =>
      isInboxThreadContextEvent(event, {
        selectedChannelId,
        selectedEventId: selectedEvent.id,
        selectedParentId,
        selectedThreadRootId,
      }),
    );

    return dedupeEvents([
      selectedEvent,
      ...currentFetchedEvents,
      ...localContext,
    ]);
  }, [
    channelMessages,
    fetchedEvents,
    fullChannel,
    selectedChannelId,
    selectedEvent,
    selectedParentId,
    selectedThreadRootId,
  ]);

  // Reactions carry only an `#e` reference, so the channel-window cache never
  // has them for thread replies — fetch them for the rendered context messages.
  const [reactionEvents, setReactionEvents] = React.useState<RelayEvent[]>([]);
  const contextEventIdsKey = React.useMemo(
    () =>
      events
        .map((event) => event.id)
        .sort()
        .join(","),
    [events],
  );

  const fetchReactions = React.useCallback(async (): Promise<
    RelayEvent[] | null
  > => {
    const eventIds = contextEventIdsKey ? contextEventIdsKey.split(",") : [];
    if (!selectedChannelId || eventIds.length === 0) {
      return [];
    }

    try {
      return await relayClient.fetchAuxEventsByReference(
        selectedChannelId,
        eventIds,
        buildChannelReactionAuxFilter,
      );
    } catch (error) {
      console.error(
        "Failed to hydrate reactions for Inbox context messages",
        selectedChannelId,
        error,
      );
      return null;
    }
  }, [contextEventIdsKey, selectedChannelId]);

  React.useEffect(() => {
    let isCancelled = false;

    void fetchReactions().then((fetched) => {
      if (!isCancelled && fetched !== null) {
        setReactionEvents(fetched);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [fetchReactions]);

  const refreshReactions = React.useCallback(async () => {
    const fetched = await fetchReactions();
    if (fetched !== null) {
      setReactionEvents(fetched);
    }
  }, [fetchReactions]);

  return {
    events,
    hasLoadError: fullChannel
      ? options.hasChannelLoadError === true
      : loadStatus?.selectionKey === selectionKey && loadStatus.hasLoadError,
    unavailable:
      !fullChannel && loadStatus?.selectionKey === selectionKey
        ? loadStatus.unavailable
        : null,
    isCheckingAvailability:
      !fullChannel &&
      selectedEvent !== null &&
      loadStatus?.selectionKey !== selectionKey,
    isLoading: fullChannel
      ? options.isChannelLoading === true
      : isLoading ||
        (selectedEvent !== null && loadStatus?.selectionKey !== selectionKey),
    reactionEvents,
    refreshReactions,
    retry,
  };
}
