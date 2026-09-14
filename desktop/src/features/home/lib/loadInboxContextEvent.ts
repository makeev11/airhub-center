import type { RelayEvent } from "@/shared/api/types";

/** Recover context, returning null only after both transports confirm absence. */
export async function loadInboxContextEvent({
  eventId,
  channelId,
  getCachedEvents,
  fetchEvent,
  fetchChannelEvents,
  requireRemote = false,
}: {
  eventId: string;
  channelId: string | null;
  getCachedEvents: () => readonly RelayEvent[];
  fetchEvent: (id: string) => Promise<RelayEvent>;
  fetchChannelEvents: (
    channelId: string,
    eventId: string,
  ) => Promise<RelayEvent[]>;
  /** Validate persisted notifications without trusting a stale history cache. */
  requireRemote?: boolean;
}): Promise<RelayEvent | null> {
  const matches = (event: RelayEvent) =>
    event.id === eventId &&
    (!channelId ||
      event.tags.some((tag) => tag[0] === "h" && tag[1] === channelId));
  const cached = !requireRemote && getCachedEvents().find(matches);
  if (cached) return cached;

  try {
    const event = await fetchEvent(eventId);
    if (matches(event)) return event;
    throw new Error("Inbox context event does not match the selected channel");
  } catch (error) {
    // Channel history may finish loading while the individual lookup is pending.
    const recovered = !requireRemote && getCachedEvents().find(matches);
    if (recovered) return recovered;
    if (!channelId) throw error;
    const events = await fetchChannelEvents(channelId, eventId);
    const event = events.find(matches);
    if (event) return event;
    const message = error instanceof Error ? error.message : error;
    // Native get_event emits this exact error only for a successful empty
    // query. Never interpret a timeout, 403, or an unrelated event as absence.
    if (message === "event not found" && events.length === 0) return null;
    throw error;
  }
}
