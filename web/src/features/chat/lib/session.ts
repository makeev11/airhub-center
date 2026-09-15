import type { Event } from "nostr-tools/pure";
import { sign, wsOrigin, type ChatIdentity } from "./identity.ts";
import { ChatRelay, type RelayState } from "./relay.ts";
import { centerHttpUrl } from "./centers.ts";
import {
  AUX_KINDS,
  MESSAGE_KINDS,
  channelsFromEvents,
  latest,
  tag,
  replyTags,
  profileLabel,
  type ChatChannel,
} from "./model.ts";
import { makeReadState, readSnapshot, newReadStateId } from "./read-state.ts";

export type ChatSnapshot = {
  state: RelayState;
  name: string;
  relayPubkey: string;
  channels: ChatChannel[];
  events: Map<string, Event>;
  profiles: Map<string, Event>;
  reads: Record<string, number>;
  error: string;
  loading: boolean;
};

/** Session-scoped state. Nothing is shared across identities or Centers. */
export class ChatSession {
  readonly identity: ChatIdentity;
  readonly relay: ChatRelay;
  private listeners = new Set<() => void>();
  private snapshot: ChatSnapshot = {
    state: "connecting",
    name: "Чат Центра",
    relayPubkey: "",
    channels: [],
    events: new Map(),
    profiles: new Map(),
    reads: {},
    error: "",
    loading: true,
  };
  private disposed = false;
  private loaded = false;
  private starting = false;
  private refreshing = false;
  private feedUnsubscribe?: () => void;
  private auxUnsubscribe?: () => void;
  private auxTargets = "";
  private refreshTimer?: ReturnType<typeof setInterval>;
  private readTimer?: ReturnType<typeof setTimeout>;
  private ownReads: Record<string, number> = {};
  private readTimestamp = 0;
  private readsReady = false;
  private slot = newReadStateId();
  private clientId = newReadStateId();
  private slotKey: string;
  private hydrated = new Set<string>();
  private pendingHydration = new Set<string>();
  private hydrationTimer?: ReturnType<typeof setTimeout>;
  private controller = new AbortController();

  constructor(identity: ChatIdentity) {
    this.identity = identity;
    const slotKey = `airhop.chat.read-slot.${identity.origin}.${identity.pubkey}`;
    this.slotKey = slotKey;
    try {
      const saved = localStorage.getItem(slotKey);
      if (saved && /^[a-f0-9]{32}$/.test(saved)) this.slot = saved;
      else localStorage.setItem(slotKey, this.slot);
      const client = localStorage.getItem(`${slotKey}.client`);
      if (client && /^[a-f0-9]{32}$/.test(client)) this.clientId = client;
      else localStorage.setItem(`${slotKey}.client`, this.clientId);
    } catch {
      /* Storage may be disabled; use a session-only slot. */
    }
    this.relay = new ChatRelay(wsOrigin(identity.origin), identity, (state) => {
      if (state !== "connected") this.readsReady = false;
      this.update({ state });
      if (state === "denied")
        this.update({
          channels: [],
          events: new Map(),
          profiles: new Map(),
          error: "Доступ отклонён. Подключите устройство заново.",
        });
      if (state === "connected") {
        if (this.loaded) void this.refreshChannels();
        else if (!this.starting) void this.start();
      }
    });
  }

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(patch: Partial<ChatSnapshot>) {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  report = (error: unknown) =>
    this.update({
      error:
        error instanceof Error
          ? error.message
          : "Не удалось выполнить действие.",
    });
  clearError = () => this.update({ error: "" });

  async start() {
    if (this.starting || this.disposed) return;
    this.starting = true;
    this.clearError();
    try {
      if (this.loaded) {
        await this.relay.connect();
        await this.refreshChannels();
        return;
      }
      const response = await fetch(centerHttpUrl(this.identity, "/"), {
        headers: { Accept: "application/nostr+json" },
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal: this.controller.signal,
      });
      if (!response.ok)
        throw new Error("Не удалось получить сведения о Центре.");
      const info = await response.json();
      if (typeof info.self !== "string" || !/^[a-f0-9]{64}$/.test(info.self))
        throw new Error("Сервер не сообщил ключ проверки каналов.");
      this.update({
        relayPubkey: info.self,
        name: typeof info.name === "string" ? info.name : "Чат Центра",
      });
      await this.relay.connect();
      if (this.disposed) return;
      this.loaded = true;
      this.relay.subscribe(
        [
          {
            kinds: [30078],
            authors: [this.identity.pubkey],
            "#t": ["read-state"],
            limit: 500,
          },
        ],
        (event) => {
          const parsed = readSnapshot(event, this.identity);
          if (!parsed) return;
          const { contexts } = parsed;
          if (tag(event, "d") === `read-state:${this.slot}`) {
            if (parsed.clientId !== this.clientId) {
              // Never overwrite another installation's coordinate on collision.
              this.slot = newReadStateId();
              try {
                localStorage.setItem(this.slotKey, this.slot);
              } catch {
                /* Session-only slot when storage is unavailable. */
              }
            } else {
              for (const [key, timestamp] of Object.entries(contexts))
                this.ownReads[key] = Math.max(
                  this.ownReads[key] ?? 0,
                  timestamp,
                );
              this.readTimestamp = Math.max(
                this.readTimestamp,
                event.created_at,
              );
            }
          }
          const reads = { ...this.snapshot.reads };
          for (const [key, timestamp] of Object.entries(contexts))
            reads[key] = Math.max(reads[key] ?? 0, timestamp);
          this.update({ reads });
        },
        this.report,
        () => {
          this.readsReady = true;
          // Reconcile the owned slot (including conflicts) before its first write.
          void this.flushReads();
        },
      );
      this.relay.subscribe(
        [
          {
            kinds: [44100, 44101],
            authors: [info.self],
            "#p": [this.identity.pubkey],
            since: Math.floor(Date.now() / 1000),
          },
        ],
        () => {
          void this.refreshChannels();
        },
        this.report,
      );
      await this.refreshChannels();
      if (this.disposed) return;
      this.refreshTimer = setInterval(() => {
        if (document.visibilityState === "visible") void this.refreshChannels();
      }, 45_000);
    } catch (error) {
      if (!this.disposed) {
        this.report(error);
        if (!this.loaded && this.snapshot.state !== "denied")
          this.update({ state: "offline" });
      }
    } finally {
      this.starting = false;
      this.update({ loading: false });
    }
  }

  async refreshChannels() {
    if (this.refreshing || this.disposed || !this.snapshot.relayPubkey) return;
    this.refreshing = true;
    try {
      const memberships = await this.relay.query([
        {
          kinds: [39002],
          authors: [this.snapshot.relayPubkey],
          "#p": [this.identity.pubkey],
          limit: 500,
        },
      ]);
      const ids = [
        ...new Set(
          memberships
            .map((event) => tag(event, "d"))
            .filter((value): value is string => Boolean(value)),
        ),
      ];
      const metadata: Event[] = [];
      for (let i = 0; i < ids.length; i += 50)
        metadata.push(
          ...(await this.relay.query([
            {
              kinds: [39000],
              authors: [this.snapshot.relayPubkey],
              "#d": ids.slice(i, i + 50),
              limit: 50,
            },
          ])),
        );
      const visibility = await this.relay.query([
        {
          kinds: [30622],
          authors: [this.snapshot.relayPubkey],
          "#p": [this.identity.pubkey],
          "#d": [this.identity.pubkey],
          limit: 1,
        },
      ]);
      const hidden = new Set(
        visibility[0]?.tags
          .filter((item) => item[0] === "h")
          .map((item) => item[1]) ?? [],
      );
      const channels = channelsFromEvents(
        [...memberships, ...metadata],
        this.identity.pubkey,
        this.snapshot.relayPubkey,
      ).filter((channel) => !channel.dm || !hidden.has(channel.id));
      if (this.disposed) return;
      const allowed = new Set(channels.map((channel) => channel.id));
      const events = new Map(
        [...this.snapshot.events].filter(([, event]) => {
          const channel = tag(event, "h");
          return channel
            ? allowed.has(channel)
            : event.tags.some(
                (item) =>
                  item[0] === "e" &&
                  allowed.has(
                    tag(
                      this.snapshot.events.get(item[1]) ?? { tags: [] },
                      "h",
                    ) ?? "",
                  ),
              );
        }),
      );
      const changed =
        channels.map((channel) => channel.id).join() !==
        this.snapshot.channels.map((channel) => channel.id).join();
      this.update({ channels, events });
      if (changed) {
        clearTimeout(this.hydrationTimer);
        this.hydrationTimer = setTimeout(() => {
          void this.hydrate();
        }, 150);
      }
      if (changed || !this.feedUnsubscribe) {
        this.feedUnsubscribe?.();
        this.feedUnsubscribe = allowed.size
          ? this.relay.subscribe(
              [
                {
                  kinds: [...MESSAGE_KINDS, ...AUX_KINDS],
                  "#h": [...allowed],
                  limit: 100,
                },
              ],
              this.addEvent,
              this.report,
            )
          : undefined;
      }
      await this.loadProfiles([
        ...new Set(channels.flatMap((channel) => channel.members)),
      ]);
    } catch (error) {
      this.report(error);
    } finally {
      this.refreshing = false;
    }
  }

  addEvent = (event: Event) => {
    if (this.disposed || this.snapshot.events.has(event.id)) return;
    const channel = tag(event, "h");
    if (
      channel &&
      !this.snapshot.channels.some((entry) => entry.id === channel)
    )
      return;
    const events = new Map(this.snapshot.events);
    events.set(event.id, event);
    this.update({ events });
    if (MESSAGE_KINDS.includes(event.kind) || event.kind === 7) {
      if (MESSAGE_KINDS.includes(event.kind))
        this.pendingHydration.add(event.id);
      clearTimeout(this.hydrationTimer);
      this.hydrationTimer = setTimeout(() => {
        void this.hydrate();
      }, 150);
    }
  };

  private async hydrate() {
    if (this.disposed) return;
    // Native clients' reactions/deletions may have only e-tags. A channel-only
    // feed does not see them, so also subscribe to the loaded event graph.
    const targets = [...this.snapshot.events.values()]
      .filter((event) => MESSAGE_KINDS.includes(event.kind) || event.kind === 7)
      .map((event) => event.id)
      .sort();
    const fingerprint = targets.join();
    if (fingerprint !== this.auxTargets) {
      this.auxUnsubscribe?.();
      this.auxTargets = fingerprint;
      this.auxUnsubscribe = targets.length
        ? this.relay.subscribe(
            [{ kinds: AUX_KINDS, "#e": targets, limit: 1000 }],
            this.addEvent,
            this.report,
          )
        : undefined;
    }
    const ids = [...this.pendingHydration].filter(
      (id) => !this.hydrated.has(id),
    );
    this.pendingHydration.clear();
    for (let offset = 0; offset < ids.length; offset += 50) {
      const chunk = ids.slice(offset, offset + 50);
      try {
        const events = await this.relay.query([
          { kinds: AUX_KINDS, "#e": chunk, limit: 1000 },
        ]);
        for (const event of events) this.addEvent(event);
        for (const id of chunk) this.hydrated.add(id);
      } catch (error) {
        this.report(error);
      }
    }
  }

  async loadChannel(channel: string, until?: number) {
    if (!this.snapshot.channels.some((entry) => entry.id === channel)) return;
    try {
      const events = await this.relay.query([
        {
          kinds: MESSAGE_KINDS,
          "#h": [channel],
          limit: 100,
          ...(until === undefined ? {} : { until }),
        },
      ]);
      events.forEach(this.addEvent);
      await this.loadProfiles(events.map((event) => event.pubkey));
    } catch (error) {
      this.report(error);
    }
  }

  async loadThread(channel: string, root: string) {
    try {
      const events = await this.relay.query([
        { kinds: MESSAGE_KINDS, "#h": [channel], "#e": [root], limit: 500 },
      ]);
      events.forEach(this.addEvent);
      await this.loadProfiles(events.map((event) => event.pubkey));
    } catch (error) {
      this.report(error);
    }
  }

  private async loadProfiles(keys: string[]) {
    const missing = [...new Set(keys)].filter(
      (key) => /^[a-f0-9]{64}$/.test(key) && !this.snapshot.profiles.has(key),
    );
    for (let i = 0; i < missing.length; i += 50) {
      const events = await this.relay.query([
        { kinds: [0], authors: missing.slice(i, i + 50), limit: 50 },
      ]);
      const profiles = new Map(this.snapshot.profiles);
      for (const event of events) {
        const previous = profiles.get(event.pubkey);
        if (!previous || latest(event, previous))
          profiles.set(event.pubkey, event);
      }
      this.update({ profiles });
    }
  }

  label(pubkey: string) {
    return (
      profileLabel(this.snapshot.profiles.get(pubkey)) ??
      (pubkey === this.identity.pubkey ? "Вы" : "Сотрудник")
    );
  }
  channelName(channel: ChatChannel) {
    return channel.dm
      ? channel.members
          .filter((key) => key !== this.identity.pubkey)
          .map((key) => this.label(key))
          .join(", ") || "Заметки для себя"
      : channel.name;
  }

  prepareMessage(
    channel: string,
    content: string,
    parent?: Event,
    attachments: string[][] = [],
    mentions: string[] = [],
  ) {
    if (
      !this.snapshot.channels.some(
        (entry) => entry.id === channel && !entry.archived,
      )
    )
      throw new Error("Канал недоступен для отправки.");
    // Fresh sends must differ even for identical text in the same second.
    // Retries retain the complete signed event, including this opaque identifier.
    const tags = [
      ...replyTags(channel, parent),
      ["client-message-id", crypto.randomUUID()],
      ...attachments,
    ];
    for (const pubkey of new Set(mentions))
      if (
        pubkey !== this.identity.pubkey &&
        /^[a-f0-9]{64}$/.test(pubkey) &&
        !tags.some((item) => item[0] === "p" && item[1] === pubkey)
      )
        tags.push(["p", pubkey]);
    return sign(this.identity, { kind: 9, content, tags });
  }

  async send(event: Event) {
    await this.relay.publish(event);
    this.addEvent(event);
  }

  async react(message: Event, emoji: string, previous?: string) {
    const event = sign(this.identity, {
      kind: previous ? 5 : 7,
      content: previous ? "" : emoji,
      tags: [
        ["h", tag(message, "h") as string],
        ["e", previous ?? message.id],
      ],
    });
    await this.send(event);
  }

  async edit(message: Event, content: string) {
    if (message.pubkey !== this.identity.pubkey) return;
    await this.send(
      sign(this.identity, {
        kind: 40003,
        content,
        tags: [
          ["h", tag(message, "h") as string],
          ["e", message.id],
          ...message.tags.filter((item) => item[0] === "imeta"),
        ],
      }),
    );
  }

  async deleteMessage(message: Event) {
    if (message.pubkey !== this.identity.pubkey) return;
    await this.send(
      sign(this.identity, {
        kind: 5,
        content: "",
        tags: [
          ["e", message.id],
          ["h", tag(message, "h") as string],
        ],
      }),
    );
  }

  markRead(messages: Event[]) {
    const reads = { ...this.snapshot.reads };
    let changed = false;
    for (const event of messages) {
      const key = `msg:${event.id}`;
      if ((reads[key] ?? 0) >= event.created_at) continue;
      reads[key] = event.created_at;
      this.ownReads[key] = event.created_at;
      changed = true;
    }
    if (!changed) return;
    this.update({ reads });
    clearTimeout(this.readTimer);
    this.readTimer = setTimeout(() => {
      void this.flushReads();
    }, 1000);
  }

  private async flushReads() {
    if (this.disposed || !this.readsReady || !Object.keys(this.ownReads).length)
      return;
    try {
      // Bound one installation slot; all other devices' snapshots remain untouched.
      this.ownReads = Object.fromEntries(
        Object.entries(this.ownReads)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 250),
      );
      this.readTimestamp = Math.max(
        Math.floor(Date.now() / 1000),
        this.readTimestamp + 1,
      );
      await this.relay.publish(
        makeReadState(
          this.identity,
          this.slot,
          this.clientId,
          this.ownReads,
          this.readTimestamp,
        ),
      );
    } catch (error) {
      this.report(error);
    }
  }

  dispose() {
    this.disposed = true;
    this.controller.abort();
    clearInterval(this.refreshTimer);
    clearTimeout(this.hydrationTimer);
    clearTimeout(this.readTimer);
    this.relay.close();
    this.listeners.clear();
    this.snapshot.events.clear();
    this.snapshot.profiles.clear();
  }
}
