import { verifyEvent, type Event } from "nostr-tools/pure";
import { matchFilter, type Filter } from "nostr-tools/filter";
import { sign, type ChatIdentity } from "./identity.ts";

export type RelayState = "connecting" | "connected" | "offline" | "denied";
type Subscription = {
  filters: Filter[];
  onEvent: (event: Event) => void;
  onError: (error: Error) => void;
  onEnd: () => void;
  live: boolean;
  timer?: ReturnType<typeof setTimeout>;
};
type Pending = {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** NIP-42 browser transport. Server ACK is required before a send is considered successful. */
export class ChatRelay {
  private socket: WebSocket | null = null;
  private subscriptions = new Map<string, Subscription>();
  private pending = new Map<string, Pending>();
  private authId = "";
  private generation = 0;
  private stopped = false;
  private retry = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private authTimer?: ReturnType<typeof setTimeout>;
  private connectPromise: Promise<void> | null = null;
  private resolveConnect: (() => void) | null = null;
  private rejectConnect: ((error: Error) => void) | null = null;
  state: RelayState = "offline";

  readonly url: string;
  private identity: ChatIdentity;
  private onState: (state: RelayState) => void;
  private optionalAuth: boolean;

  constructor(
    url: string,
    identity: ChatIdentity,
    onState: (state: RelayState) => void = () => {},
    optionalAuth = false,
  ) {
    this.url = url;
    this.identity = identity;
    this.onState = onState;
    this.optionalAuth = optionalAuth;
  }

  private setState(state: RelayState) {
    this.state = state;
    this.onState(state);
  }

  connect(): Promise<void> {
    if (this.stopped) return Promise.reject(new Error("Подключение закрыто."));
    if (this.state === "connected") return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;
    clearTimeout(this.reconnectTimer);
    this.setState("connecting");
    const generation = ++this.generation;
    this.connectPromise = new Promise<void>((resolve, reject) => {
      this.resolveConnect = resolve;
      this.rejectConnect = reject;
    });
    const promise = this.connectPromise;
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch {
      this.lost(new Error("Не удалось открыть соединение."), generation);
      return promise;
    }
    this.socket = socket;
    this.authTimer = setTimeout(() => {
      socket.close();
      this.lost(new Error("Сервер не ответил на подключение."), generation);
    }, 12_000);
    socket.onopen = () => {
      if (this.optionalAuth) {
        clearTimeout(this.authTimer);
        this.authTimer = setTimeout(() => this.ready(generation), 3000);
      }
    };
    socket.onmessage = ({ data }) => {
      if (
        generation !== this.generation ||
        typeof data !== "string" ||
        data.length > 2_000_000
      )
        return;
      try {
        this.handle(JSON.parse(data), generation);
      } catch {
        /* Ignore malformed untrusted frames. */
      }
    };
    socket.onerror = () => socket.close();
    socket.onclose = () =>
      this.lost(new Error("Связь прервалась. Переподключаемся…"), generation);
    return promise;
  }

  private ready(generation: number) {
    if (generation !== this.generation || this.stopped) return;
    clearTimeout(this.authTimer);
    this.setState("connected");
    this.retry = 0;
    for (const [id, sub] of this.subscriptions)
      this.send(["REQ", id, ...sub.filters]);
    this.resolveConnect?.();
    this.resolveConnect = null;
    this.rejectConnect = null;
    this.connectPromise = null;
  }

  private handle(frame: unknown, generation: number) {
    if (!Array.isArray(frame)) return;
    if (frame[0] === "AUTH" && typeof frame[1] === "string") {
      clearTimeout(this.authTimer);
      const auth = sign(this.identity, {
        kind: 22242,
        content: "",
        tags: [
          ["relay", this.url],
          ["challenge", frame[1]],
        ],
      });
      this.authId = auth.id;
      this.send(["AUTH", auth]);
      this.authTimer = setTimeout(() => this.socket?.close(), 10_000);
    } else if (frame[0] === "OK") {
      if (frame[1] === this.authId) {
        this.authId = "";
        if (frame[2] === true) this.ready(generation);
        else {
          this.setState("denied");
          this.close(
            new Error("Центр отклонил доступ. Подключите устройство заново."),
          );
        }
      } else {
        const pending = this.pending.get(frame[1]);
        if (!pending) return;
        this.pending.delete(frame[1]);
        clearTimeout(pending.timer);
        if (frame[2] === true) pending.resolve();
        else
          pending.reject(
            new Error("Сервер отклонил сообщение. Проверьте доступ к каналу."),
          );
      }
    } else if (frame[0] === "EVENT") {
      const sub = this.subscriptions.get(frame[1]);
      if (!sub || this.state !== "connected") return;
      const event = frame[2];
      if (
        verifyEvent(event) &&
        sub.filters.some((filter) => matchFilter(filter, event))
      )
        sub.onEvent(event);
    } else if (frame[0] === "EOSE") {
      const sub = this.subscriptions.get(frame[1]);
      if (!sub) return;
      clearTimeout(sub.timer);
      sub.onEnd();
      if (!sub.live) this.unsubscribe(frame[1]);
    } else if (frame[0] === "CLOSED") {
      const sub = this.subscriptions.get(frame[1]);
      if (!sub) return;
      sub.onError(new Error("Нет доступа к этому каналу или запросу."));
      this.unsubscribe(frame[1]);
    }
  }

  private lost(error: Error, generation: number) {
    if (generation !== this.generation || this.stopped) return;
    this.generation++;
    clearTimeout(this.authTimer);
    this.authId = "";
    this.rejectConnect?.(error);
    this.rejectConnect = null;
    this.resolveConnect = null;
    this.connectPromise = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(
        new Error("Нет подтверждения отправки. Можно повторить без дубликата."),
      );
    }
    this.pending.clear();
    for (const [id, sub] of this.subscriptions)
      if (!sub.live) {
        sub.onError(error);
        this.unsubscribe(id);
      }
    this.setState("offline");
    if (!this.stopped)
      this.reconnectTimer = setTimeout(
        () => {
          void this.connect().catch(() => {});
        },
        Math.min(1000 * 2 ** this.retry++, 20_000),
      );
  }

  private send(frame: unknown[]) {
    if (this.socket?.readyState === WebSocket.OPEN)
      this.socket.send(JSON.stringify(frame));
  }

  subscribe(
    filters: Filter[],
    onEvent: (event: Event) => void,
    onError: (error: Error) => void,
    onEnd: () => void = () => {},
    live = true,
  ): () => void {
    if (this.stopped) throw new Error("Подключение закрыто.");
    if (filters.some((filter) => !filter.kinds?.length))
      throw new Error("Запрос должен указывать тип сообщений.");
    const id = crypto.randomUUID();
    const sub: Subscription = { filters, onEvent, onError, onEnd, live };
    sub.timer = setTimeout(() => {
      onError(new Error("Загрузка заняла слишком много времени."));
      this.unsubscribe(id);
    }, 20_000);
    this.subscriptions.set(id, sub);
    if (this.state === "connected") this.send(["REQ", id, ...filters]);
    return () => this.unsubscribe(id);
  }

  query(filters: Filter[]): Promise<Event[]> {
    return new Promise((resolve, reject) => {
      const events = new Map<string, Event>();
      this.subscribe(
        filters,
        (event) => events.set(event.id, event),
        reject,
        () => resolve([...events.values()]),
        false,
      );
    });
  }

  private unsubscribe(id: string) {
    clearTimeout(this.subscriptions.get(id)?.timer);
    this.subscriptions.delete(id);
    this.send(["CLOSE", id]);
  }

  async publish(event: Event): Promise<void> {
    await this.connect();
    if (this.pending.has(event.id))
      throw new Error("Это сообщение уже отправляется.");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(event.id);
        reject(new Error("Нет подтверждения отправки. Повторите отправку."));
      }, 15_000);
      this.pending.set(event.id, { resolve, reject, timer });
      this.send(["EVENT", event]);
    });
  }

  close(error = new Error("Подключение закрыто.")) {
    this.stopped = true;
    this.generation++;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.authTimer);
    this.rejectConnect?.(error);
    this.rejectConnect = null;
    this.resolveConnect = null;
    this.connectPromise = null;
    for (const sub of this.subscriptions.values()) {
      clearTimeout(sub.timer);
      if (!sub.live) sub.onError(error);
    }
    this.subscriptions.clear();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.socket?.close();
    this.socket = null;
  }
}
