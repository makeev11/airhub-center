import type { RelayEvent } from "@/shared/api/types";

/** Recover an Inbox ancestor from local history or either available transport. */
export async function loadInboxContextEvent({
  eventId,
  channelId,
  getCachedEvents,
  fetchEvent,
  fetchChannelEvents,
}: {
  eventId: string;
  channelId: string | null;
  getCachedEvents: () => readonly RelayEvent[];
  fetchEvent: (id: string) => Promise<RelayEvent>;
  fetchChannelEvents: (
    channelId: string,
    eventId: string,
  ) => Promise<RelayEvent[]>;
}): Promise<RelayEvent> {
  const matches = (event: RelayEvent) =>
    event.id === eventId &&
    (!channelId ||
      event.tags.some((tag) => tag[0] === "h" && tag[1] === channelId));
  const cached = getCachedEvents().find(matches);
  if (cached) return cached;

  try {
    const event = await fetchEvent(eventId);
    if (matches(event)) return event;
    throw new Error("Inbox context event does not match the selected channel");
  } catch (error) {
    // Channel history may finish loading while the individual lookup is pending.
    const recovered = getCachedEvents().find(matches);
    if (recovered) return recovered;
    if (!channelId) throw error;
    const events = await fetchChannelEvents(channelId, eventId);
    const event = events.find(matches);
    if (event) return event;
    throw error;
  }
}
