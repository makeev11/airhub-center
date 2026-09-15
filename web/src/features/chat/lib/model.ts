import type { Event } from "nostr-tools/pure";

export const MESSAGE_KINDS = [9, 40002, 40008, 40099, 45001, 45003];
export const AUX_KINDS = [5, 7, 9005, 40003];
export type ChatChannel = {
  id: string;
  name: string;
  dm: boolean;
  members: string[];
  archived: boolean;
};
export type ChatMessage = {
  event: Event;
  content: string;
  tags: string[][];
  edited: boolean;
  deleted: boolean;
  root: string | null;
  parent: string | null;
  reactions: { emoji: string; count: number; mine?: string }[];
};

export function tag(event: Pick<Event, "tags">, name: string) {
  return event.tags.find((item) => item[0] === name)?.[1];
}
export function latest(a: Event, b: Event) {
  return (
    a.created_at > b.created_at ||
    (a.created_at === b.created_at && a.id < b.id)
  );
}

/** Match Buzz's marked NIP-10 replies; an unmarked e-tag is not a thread parent. */
export function threadReference(tags: string[][]) {
  const reply =
    [...tags]
      .reverse()
      .find((item) => item[0] === "e" && item[3] === "reply")?.[1] ?? null;
  const root =
    tags.find((item) => item[0] === "e" && item[3] === "root")?.[1] ?? reply;
  return { parent: reply, root };
}

export function replyTags(channel: string, parent?: Event) {
  const tags = [["h", channel]];
  if (!parent) return tags;
  const root = threadReference(parent.tags).root ?? parent.id;
  if (root !== parent.id) tags.push(["e", root, "", "root"]);
  tags.push(["e", parent.id, "", "reply"], ["p", parent.pubkey]);
  return tags;
}

/** Channel discovery comes from authenticated relay-signed metadata and membership, not arbitrary profiles. */
export function channelsFromEvents(
  events: Iterable<Event>,
  pubkey: string,
  relayPubkey: string,
): ChatChannel[] {
  const metadata = new Map<string, Event>();
  const members = new Map<string, Event>();
  for (const event of events) {
    if (event.pubkey !== relayPubkey) continue;
    const id = tag(event, "d");
    if (!id) continue;
    const map =
      event.kind === 39000 ? metadata : event.kind === 39002 ? members : null;
    if (map && (!map.has(id) || latest(event, map.get(id) as Event)))
      map.set(id, event);
  }
  const result: ChatChannel[] = [];
  for (const [id, event] of metadata) {
    const membership = members.get(id);
    const keys =
      membership?.tags
        .filter((item) => item[0] === "p")
        .map((item) => item[1]) ?? [];
    if (!keys.includes(pubkey)) continue;
    result.push({
      id,
      name: tag(event, "name") || "Без названия",
      dm:
        tag(event, "t") === "dm" ||
        event.tags.some((item) => item[0] === "hidden"),
      members: keys,
      archived: tag(event, "archived") === "true",
    });
  }
  return result.sort(
    (a, b) => Number(a.dm) - Number(b.dm) || a.name.localeCompare(b.name, "ru"),
  );
}

/** Only authors may edit their own content; auxiliary events cannot affect another channel's rows. */
export function messagesFromEvents(
  events: Iterable<Event>,
  channel: string,
  self: string,
  relayPubkey: string,
): ChatMessage[] {
  const all = [...events];
  const byId = new Map(all.map((event) => [event.id, event]));
  const deleted = new Set<string>();
  for (const event of all) {
    if (event.kind !== 5 && event.kind !== 9005) continue;
    for (const reference of event.tags.filter((item) => item[0] === "e")) {
      const original = byId.get(reference[1]);
      if (
        original &&
        (event.pubkey === original.pubkey || event.pubkey === relayPubkey)
      )
        deleted.add(original.id);
    }
  }
  const edits = new Map<string, Event>();
  const reactions = new Map<string, Map<string, Map<string, string>>>();
  for (const event of all) {
    if (deleted.has(event.id)) continue;
    const target = [...event.tags]
      .reverse()
      .find((item) => item[0] === "e")?.[1];
    if (!target) continue;
    const original = byId.get(target);
    if (!original || tag(original, "h") !== channel) continue;
    if (
      event.kind === 40003 &&
      event.pubkey === original.pubkey &&
      tag(event, "h") === channel
    ) {
      const previous = edits.get(target);
      if (!previous || latest(event, previous)) edits.set(target, event);
    }
    if (
      event.kind === 7 &&
      event.content.trim() &&
      event.content.length <= 80
    ) {
      const emojis =
        reactions.get(target) ?? new Map<string, Map<string, string>>();
      const authors = emojis.get(event.content) ?? new Map<string, string>();
      authors.set(event.pubkey, event.id);
      emojis.set(event.content, authors);
      reactions.set(target, emojis);
    }
  }
  return all
    .filter(
      (event) =>
        MESSAGE_KINDS.includes(event.kind) && tag(event, "h") === channel,
    )
    .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))
    .map((event) => {
      const edit = edits.get(event.id);
      return {
        event,
        content: edit?.content ?? event.content,
        tags: edit?.tags ?? event.tags,
        edited: Boolean(edit),
        deleted: deleted.has(event.id),
        ...threadReference(event.tags),
        reactions: [...(reactions.get(event.id) ?? [])].map(
          ([emoji, authors]) => ({
            emoji,
            count: authors.size,
            mine: authors.get(self),
          }),
        ),
      };
    });
}

export function profileLabel(event?: Event): string | null {
  if (!event) return null;
  try {
    const value = JSON.parse(event.content);
    const name = value.display_name || value.name;
    return typeof name === "string" && name.trim() ? name.slice(0, 100) : null;
  } catch {
    return null;
  }
}
