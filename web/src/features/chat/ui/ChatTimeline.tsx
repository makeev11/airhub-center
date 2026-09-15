import { useEffect, useRef } from "react";
import type { ChatMessage } from "../lib/model";
import type { ChatSession } from "../lib/session";
import { MessageRow } from "./MessageRow";

/** Independently scrolling channel/thread canvas, matching the desktop layout. */
export function ChatTimeline({
  messages,
  allMessages,
  session,
  isThread = false,
  searching = false,
  historyBusy = false,
  onHistory,
  onReply,
  onOpenThread,
}: {
  messages: ChatMessage[];
  allMessages: ChatMessage[];
  session: ChatSession;
  isThread?: boolean;
  searching?: boolean;
  historyBusy?: boolean;
  onHistory?: () => void;
  onReply: (message: ChatMessage) => void;
  onOpenThread: (message: ChatMessage) => void;
}) {
  const scroll = useRef<HTMLElement>(null);
  const bottom = useRef(true);
  useEffect(() => {
    if (messages.length > 0 && bottom.current && !searching && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [messages.length, searching]);
  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (bottom.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <section
      className="chat-timeline"
      aria-label={isThread ? "Сообщения ветки" : "Переписка"}
      ref={scroll}
      onScroll={() => {
        const el = scroll.current;
        if (el)
          bottom.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 100;
      }}
    >
      {onHistory && messages.length > 0 && !searching && (
        <button
          className="chat-history"
          type="button"
          disabled={historyBusy}
          onClick={() => {
            bottom.current = false;
            onHistory();
          }}
        >
          {historyBusy ? "Загружаем…" : "Более ранние сообщения"}
        </button>
      )}
      {searching && (
        <p className="chat-timeline-note">
          Найдено: {messages.length}. Показаны до 100 результатов.
        </p>
      )}
      {!messages.length && (
        <div className="chat-empty">
          <h2>{searching ? "Ничего не найдено" : "Начало разговора"}</h2>
          <p>
            {searching
              ? "Попробуйте другой запрос."
              : "Напишите команде первое сообщение."}
          </p>
        </div>
      )}
      {messages.map((message, index) => (
        <div key={message.event.id}>
          {(index === 0 ||
            new Date(
              messages[index - 1].event.created_at * 1000,
            ).toDateString() !==
              new Date(message.event.created_at * 1000).toDateString()) && (
            <div className="chat-date">
              <span>
                {new Date(message.event.created_at * 1000).toLocaleDateString(
                  "ru",
                  { day: "numeric", month: "long" },
                )}
              </span>
            </div>
          )}
          <MessageRow
            message={message}
            session={session}
            replies={
              isThread
                ? 0
                : allMessages.filter((other) => other.root === message.event.id)
                    .length
            }
            onReply={() => onReply(message)}
            onOpenThread={() => onOpenThread(message)}
          />
        </div>
      ))}
    </section>
  );
}
