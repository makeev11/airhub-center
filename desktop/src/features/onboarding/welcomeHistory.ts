import type {
  ChannelMessagesPageResponse,
  ChannelPageCursor,
  RelayEvent,
} from "@/shared/api/types";

type ReadPage = (
  channelId: string,
  cursor: ChannelPageCursor,
  limit?: number,
) => Promise<ChannelMessagesPageResponse>;

/** Read durable kickoff receipts independently of the visible timeline window. */
export async function loadWelcomeHistory(
  channelId: string,
  readPage: ReadPage,
  signal?: AbortSignal,
  now = Date.now(),
): Promise<RelayEvent[]> {
  let cursor: ChannelPageCursor = {
    createdAt: Math.floor(now / 1000) + 60,
    eventId: "0".repeat(64),
  };
  const cursors = new Set<string>();
  const events = new Map<string, RelayEvent>();
  for (let page = 0; page < 100; page += 1) {
    signal?.throwIfAborted();
    const key = `${cursor.createdAt}:${cursor.eventId}`;
    if (cursors.has(key))
      throw new Error("Welcome history cursor did not advance.");
    cursors.add(key);
    const result = await readPage(channelId, cursor, 200);
    signal?.throwIfAborted();
    for (const event of result.events) events.set(event.id, event);
    if (!result.nextCursor) return [...events.values()];
    cursor = result.nextCursor;
  }
  // Incomplete history must never be mistaken for a new Welcome.
  throw new Error("Welcome history exceeds the safe replay limit.");
}
