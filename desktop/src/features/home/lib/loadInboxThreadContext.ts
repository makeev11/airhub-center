import type { RelayEvent } from "@/shared/api/types";
import { getThreadReference } from "@/features/messages/lib/threading";

export type InboxContextUnavailable = "thread" | "message" | "partial" | null;

/** Validate the anchor and ancestors, independently of the saved Inbox copy. */
export async function loadInboxThreadContext({
  selectedEvent,
  loadEvent,
  loadDescendants,
  onError,
}: {
  selectedEvent: RelayEvent;
  loadEvent: (id: string) => Promise<RelayEvent | null>;
  loadDescendants: (rootId: string) => Promise<RelayEvent[]>;
  onError?: (error: unknown) => void;
}) {
  const reference = getThreadReference(selectedEvent.tags);
  const rootId = reference.rootId ?? reference.parentId ?? selectedEvent.id;
  const missingIds = new Set<string>();
  const eventsById = new Map<string, RelayEvent>();
  const requests = new Map<string, Promise<RelayEvent | null>>();
  let hasLoadError = false;
  const fetchEvent = (id: string): Promise<RelayEvent | null> => {
    const pending = requests.get(id);
    if (pending) return pending;
    const request = loadEvent(id)
      .then((event) => {
        if (event) eventsById.set(id, event);
        else missingIds.add(id);
        return event;
      })
      .catch((error) => {
        hasLoadError = true;
        onError?.(error);
        return null;
      });
    requests.set(id, request);
    return request;
  };

  const ancestors = async () => {
    await Promise.all([fetchEvent(selectedEvent.id), fetchEvent(rootId)]);
    let ancestorId = reference.parentId;
    const seen = new Set<string>([selectedEvent.id]);
    while (ancestorId && !seen.has(ancestorId) && seen.size <= 50) {
      seen.add(ancestorId);
      const ancestor = await fetchEvent(ancestorId);
      if (!ancestor || ancestorId === rootId) break;
      ancestorId = getThreadReference(ancestor.tags).parentId;
    }
  };
  const descendants = loadDescendants(rootId).catch((error) => {
    hasLoadError = true;
    onError?.(error);
    return [] as RelayEvent[];
  });
  const [, replies] = await Promise.all([ancestors(), descendants]);
  // A message can arrive while an individual lookup is in flight. A positive
  // server result wins over absence from an earlier query.
  for (const event of replies) {
    eventsById.set(event.id, event);
    missingIds.delete(event.id);
  }
  const unavailable: InboxContextUnavailable =
    missingIds.has(selectedEvent.id) &&
    missingIds.has(rootId) &&
    eventsById.size === 0 &&
    !hasLoadError
      ? "thread"
      : missingIds.has(selectedEvent.id)
        ? "message"
        : missingIds.size > 0
          ? "partial"
          : null;
  return { events: [...eventsById.values()], hasLoadError, unavailable };
}
