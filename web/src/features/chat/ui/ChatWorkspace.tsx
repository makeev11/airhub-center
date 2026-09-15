import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ArrowLeft,
  ChevronDown,
  Hash,
  LockKeyhole,
  MessageSquare,
  Search,
  Settings,
  Users,
  X,
} from "lucide-react";
import type { Event } from "nostr-tools/pure";
import {
  MESSAGE_KINDS,
  messagesFromEvents,
  tag,
  type ChatChannel,
  type ChatMessage,
} from "../lib/model";
import type { ChatSession } from "../lib/session";
import { Composer, type ComposerDraft } from "./Composer";
import { ChatTimeline } from "./ChatTimeline";
import { effectiveReadAt } from "../lib/read-state";

/** Browser shell based on Buzz's New Slack chrome; no Tauri dependency. */
export function ChatWorkspace({
  session,
  onLock,
  initialChannelId = "",
}: {
  session: ChatSession;
  onLock: () => void;
  initialChannelId?: string;
}) {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [channelId, setChannelId] = useState(initialChannelId);
  const [thread, setThread] = useState<string | null>(null);
  const [reply, setReply] = useState<Event | undefined>();
  const [settings, setSettings] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const [collapsed, setCollapsed] = useState({ channels: false, dm: false });
  const [search, setSearch] = useState("");
  const [searchIds, setSearchIds] = useState<Set<string> | null>(null);
  const [searching, setSearching] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const searchGeneration = useRef(0);
  const drafts = useRef(new Map<string, ComposerDraft>());
  const channel = snapshot.channels.find((item) => item.id === channelId);
  const messages = useMemo(
    () =>
      channel
        ? messagesFromEvents(
            snapshot.events.values(),
            channel.id,
            session.identity.pubkey,
            snapshot.relayPubkey,
          )
        : [],
    [channel, snapshot.events, snapshot.relayPubkey, session],
  );
  const mainMessages = messages.filter((message) =>
    searchIds ? searchIds.has(message.event.id) : !message.parent,
  );
  const previews = useMemo(
    () =>
      new Map(
        snapshot.channels.map((entry) => {
          const entries = messagesFromEvents(
            snapshot.events.values(),
            entry.id,
            session.identity.pubkey,
            snapshot.relayPubkey,
          );
          const last = entries[entries.length - 1];
          return [
            entry.id,
            last?.deleted ? "Сообщение удалено" : last?.content.slice(0, 90),
          ];
        }),
      ),
    [snapshot.channels, snapshot.events, snapshot.relayPubkey, session],
  );
  const threadMessages = messages.filter(
    (message) => message.event.id === thread || message.root === thread,
  );
  const root = thread ? snapshot.events.get(thread) : undefined;
  const getDraft = (key: string) => {
    let draft = drafts.current.get(key);
    if (!draft) {
      draft = { text: "", attachments: [], pending: null };
      drafts.current.set(key, draft);
    }
    return draft;
  };
  const unread = (id: string) =>
    [...snapshot.events.values()].filter(
      (event) =>
        MESSAGE_KINDS.includes(event.kind) &&
        tag(event, "h") === id &&
        event.pubkey !== session.identity.pubkey &&
        effectiveReadAt(event, snapshot.reads) < event.created_at,
    ).length;
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (
        [...drafts.current.values()].some(
          (item) => item.text || item.attachments.length || item.pending,
        )
      )
        event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);
  useEffect(() => {
    if (channelId) void session.loadChannel(channelId);
  }, [session, channelId]);
  useEffect(() => {
    if (thread && channelId) void session.loadThread(channelId, thread);
  }, [session, channelId, thread]);
  useEffect(() => {
    if (channelId && !snapshot.loading && !channel) {
      setChannelId("");
      setThread(null);
      setReply(undefined);
      drafts.current.clear();
    }
  }, [channel, channelId, snapshot.loading]);

  const closeThread = () => {
    setThread(null);
    setReply(undefined);
  };
  useEffect(() => {
    if (searchOpen) searchInput.current?.focus();
  }, [searchOpen]);
  const select = (entry: ChatChannel) => {
    searchGeneration.current++;
    setChannelId(entry.id);
    closeThread();
    setSearch("");
    setSearchIds(null);
    setSearching(false);
    setSettings(false);
    setSearchOpen(false);
  };
  const openThread = (message: ChatMessage) => {
    setSearchOpen(false);
    searchGeneration.current++;
    setThread(message.root ?? message.event.id);
    setReply(undefined);
    setSearchIds(null);
    setSearch("");
    setSearching(false);
  };
  const runSearch = async () => {
    if (!channel || !search.trim()) {
      setSearchIds(null);
      return;
    }
    const generation = ++searchGeneration.current;
    setSearching(true);
    try {
      const events = await session.relay.query([
        {
          kinds: MESSAGE_KINDS,
          "#h": [channel.id],
          search: search.trim(),
          limit: 100,
        },
      ]);
      if (generation !== searchGeneration.current) return;
      events.forEach(session.addEvent);
      setSearchIds(new Set(events.map((event) => event.id)));
      closeThread();
    } catch (error) {
      session.report(error);
    } finally {
      if (generation === searchGeneration.current) setSearching(false);
    }
  };
  const connectionLabel = {
    connected: "На связи",
    connecting: "Подключаемся…",
    offline: "Нет связи · переподключаемся",
    denied: "Доступ отклонён",
  }[snapshot.state];
  return (
    <div
      className={`chat-app${channel && !settings ? " chat-conversation-open" : ""}${thread ? " chat-thread-open" : ""}${settings ? " chat-settings-open" : ""}${searchOpen ? " chat-search-open" : ""}`}
    >
      <header className="chat-topbar">
        <div className="chat-product">
          <strong>
            AirHop <span>Center</span>
          </strong>
        </div>
        <form
          className="chat-search"
          onSubmit={(event) => {
            event.preventDefault();
            void runSearch();
          }}
        >
          <Search size={16} aria-hidden="true" />
          <input
            ref={searchInput}
            type="search"
            aria-label="Поиск в переписке"
            placeholder={
              channel
                ? `Поиск в ${session.channelName(channel)}`
                : "Выберите чат для поиска"
            }
            value={search}
            disabled={!channel}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button
            type="submit"
            disabled={searching || !channel}
            aria-label="Найти"
            title="Найти"
          >
            {searching ? "…" : "↵"}
          </button>
          {searchIds && (
            <button
              type="button"
              aria-label="Сбросить"
              title="Сбросить поиск"
              onClick={() => {
                searchGeneration.current++;
                setSearchIds(null);
                setSearch("");
                setSearching(false);
              }}
            >
              <X size={16} />
            </button>
          )}
        </form>
        <button
          type="button"
          className="chat-search-close"
          aria-label="Закрыть поиск"
          onClick={() => setSearchOpen(false)}
        >
          <X size={20} />
        </button>
        <button
          type="button"
          className="chat-top-settings"
          aria-label="Настройки чата"
          title="Настройки чата"
          onClick={() => setSettings((value) => !value)}
        >
          <Settings size={18} />
        </button>
      </header>
      <aside className="chat-sidebar" aria-label="Чаты">
        <div className="chat-sidebar-brand">
          <div>
            <strong>{snapshot.name}</strong>
            <span>Рабочее пространство</span>
          </div>
        </div>
        <div
          className={`chat-connection chat-connection-${snapshot.state}`}
          role="status"
        >
          <span />
          {connectionLabel}
        </div>
        {snapshot.state !== "connected" && snapshot.state !== "denied" && (
          <button
            type="button"
            className="chat-reconnect"
            onClick={() => void session.start()}
          >
            Переподключить
          </button>
        )}
        <nav>
          {[false, true].map((dm) => {
            const section = dm ? "dm" : "channels";
            return (
              <section key={section}>
                <h2>
                  <button
                    type="button"
                    className="chat-section-toggle"
                    aria-expanded={!collapsed[section]}
                    onClick={() =>
                      setCollapsed((old) => ({
                        ...old,
                        [section]: !old[section],
                      }))
                    }
                  >
                    <ChevronDown size={13} />
                    {dm ? "Личные сообщения" : "Каналы"}
                  </button>
                </h2>
                {!collapsed[section] &&
                  snapshot.channels
                    .filter((entry) => entry.dm === dm)
                    .map((entry) => (
                      <button
                        type="button"
                        className="chat-channel"
                        key={entry.id}
                        aria-label={`${dm ? "●" : "#"} ${session.channelName(entry)}`}
                        aria-current={
                          channelId === entry.id ? "page" : undefined
                        }
                        onClick={() => select(entry)}
                      >
                        {dm ? (
                          <span className="chat-dm-avatar" aria-hidden="true">
                            {session.channelName(entry).slice(0, 1)}
                          </span>
                        ) : (
                          <Hash size={17} aria-hidden="true" />
                        )}
                        <span className="chat-channel-text">
                          <span className="chat-channel-label">
                            {session.channelName(entry)}
                          </span>
                          {!channel && (
                            <span className="chat-channel-preview">
                              {previews.get(entry.id) ||
                                (entry.dm
                                  ? "Личная переписка"
                                  : "Сообщения команды")}
                            </span>
                          )}
                        </span>
                        {unread(entry.id) > 0 && (
                          <span
                            className="chat-unread"
                            title={`${unread(entry.id)} непрочитанных`}
                          >
                            {unread(entry.id) > 99 ? "99+" : unread(entry.id)}
                          </span>
                        )}
                      </button>
                    ))}
              </section>
            );
          })}
        </nav>
        {snapshot.loading && (
          <p className="chat-sidebar-note">Загружаем каналы…</p>
        )}
        {!snapshot.loading && !snapshot.channels.length && (
          <p className="chat-sidebar-note">
            После приглашения доступные каналы появятся здесь.
          </p>
        )}
        <footer>
          <span className="chat-avatar">
            {session.label(session.identity.pubkey).slice(0, 1)}
          </span>
          <span>
            <strong>{session.label(session.identity.pubkey)}</strong>
            <small>Ваш профиль</small>
          </span>
          <button
            type="button"
            onClick={onLock}
            aria-label="Закрыть"
            title="Заблокировать чат"
          >
            <LockKeyhole size={17} />
          </button>
        </footer>
      </aside>
      <main className="chat-main">
        {snapshot.error && (
          <div className="chat-error-banner" role="alert">
            <span>{snapshot.error}</span>
            <button
              type="button"
              aria-label="Закрыть ошибку"
              onClick={session.clearError}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {settings ? (
          <section className="chat-settings">
            <button type="button" onClick={() => setSettings(false)}>
              ← Назад
            </button>
            <h1>Чат на телефоне</h1>
            <h2>iPhone</h2>
            <p>
              Откройте опубликованный адрес вашего Center в Safari, нажмите
              «Поделиться» → «На экран Домой».
            </p>
            <h2>Android</h2>
            <p>
              Откройте меню браузера → «Установить приложение» или «Добавить на
              главный экран».
            </p>
            <h2>Что важно знать</h2>
            <p>
              Пока это пилот. Фоновые уведомления ещё не подключены. Новые
              сообщения появляются, когда чат открыт и есть связь. Локальное
              демо не является опубликованным Center.
            </p>
            <p>
              Пароль защищает сохранённое подключение. Не используйте общий
              браузер. Кнопка «Закрыть» блокирует чат, но не отзывает ключ
              учётной записи.
            </p>
            <p>
              Черновики хранятся только до закрытия чата. После длительного
              ухода в фон чат блокируется.
            </p>
            <button type="button" onClick={onLock}>
              Заблокировать чат
            </button>
          </section>
        ) : !channel ? (
          <section className="chat-welcome">
            <MessageSquare size={40} strokeWidth={1.3} />
            <h1>Ваши рабочие разговоры</h1>
            <p>Выберите канал или личную переписку слева.</p>
            <p className="chat-muted">Сообщения остаются в вашем Центре.</p>
          </section>
        ) : (
          <>
            <div className="chat-conversation-panels">
              <section className="chat-channel-pane" aria-label="Канал">
                <header className="chat-conversation-header">
                  <button
                    type="button"
                    className="chat-mobile-back"
                    aria-label="← Чаты"
                    onClick={() => {
                      setChannelId("");
                      setSearchOpen(false);
                      closeThread();
                    }}
                  >
                    <ArrowLeft size={20} />
                  </button>
                  <div>
                    <h1>{`${channel.dm ? "" : "# "}${session.channelName(channel)}`}</h1>
                    <p role="status">
                      {snapshot.state !== "connected"
                        ? connectionLabel
                        : channel.archived
                          ? "Архив канала"
                          : channel.dm
                            ? "Личная переписка"
                            : "Сообщения команды"}
                    </p>
                  </div>
                  <span
                    className="chat-member-count"
                    title={`Участников: ${channel.members.length}`}
                  >
                    <Users size={16} />
                    {channel.members.length}
                  </span>
                  <button
                    type="button"
                    className="chat-mobile-search"
                    aria-label="Поиск по чату"
                    aria-expanded={searchOpen}
                    onClick={() => setSearchOpen((value) => !value)}
                  >
                    <Search size={21} />
                  </button>
                </header>
                <ChatTimeline
                  key={`${channel.id}:${searchIds ? "search" : "channel"}`}
                  messages={mainMessages}
                  allMessages={messages}
                  session={session}
                  searching={Boolean(searchIds)}
                  historyBusy={historyBusy}
                  onHistory={() => {
                    setHistoryBusy(true);
                    void session
                      .loadChannel(channel.id, messages[0]?.event.created_at)
                      .finally(() => setHistoryBusy(false));
                  }}
                  onReply={(message) => {
                    openThread(message);
                    setReply(message.event);
                  }}
                  onOpenThread={openThread}
                />
                {searchIds ? (
                  <p className="chat-search-hint">
                    Чтобы ответить, откройте ветку сообщения или сбросьте поиск.
                  </p>
                ) : (
                  <Composer
                    key={`${channel.id}:main`}
                    session={session}
                    channel={channel.id}
                    label={thread ? "Сообщение в канале" : "Сообщение"}
                    submitLabel={thread ? "Отправить в канал" : "Отправить"}
                    placeholder={`Написать в ${channel.dm ? "" : "#"}${session.channelName(channel)}`}
                    onCancelReply={() => {}}
                    disabled={channel.archived || snapshot.state === "denied"}
                    draft={getDraft(`${channel.id}:main`)}
                  />
                )}
              </section>
              {thread && (
                <section className="chat-thread-pane" aria-label="Ветка">
                  <header className="chat-conversation-header">
                    <div>
                      <h2>Ветка обсуждения</h2>
                      <p>
                        в {channel.dm ? "" : "#"}
                        {session.channelName(channel)}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="chat-icon-button"
                      aria-label="Закрыть ветку"
                      title="Закрыть ветку"
                      onClick={closeThread}
                    >
                      <X size={20} />
                    </button>
                  </header>
                  <ChatTimeline
                    key={`${channel.id}:${thread}`}
                    messages={threadMessages}
                    allMessages={messages}
                    session={session}
                    isThread
                    onReply={(message) => setReply(message.event)}
                    onOpenThread={openThread}
                  />
                  <Composer
                    key={`${channel.id}:${thread}`}
                    session={session}
                    channel={channel.id}
                    parent={reply ?? root}
                    showReplyContext={Boolean(reply)}
                    placeholder="Ответить в ветке…"
                    onCancelReply={() => setReply(undefined)}
                    disabled={channel.archived || snapshot.state === "denied"}
                    draft={getDraft(`${channel.id}:${thread}`)}
                  />
                </section>
              )}
            </div>
            <div className="chat-pilot-strip">
              Пилот · Фоновые уведомления пока недоступны
            </div>
          </>
        )}
      </main>
    </div>
  );
}
