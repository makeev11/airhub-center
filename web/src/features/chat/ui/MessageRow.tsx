import { useEffect, useRef, useState } from "react";
import { MessageSquare, Pencil, SmilePlus, Trash2 } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "../lib/model";
import type { ChatSession } from "../lib/session";
import { fetchMedia, mediaUrl } from "../lib/media";

function Attachment({
  href,
  name,
  session,
}: {
  href: string;
  name: string;
  session: ChatSession;
}) {
  const [blobUrl, setBlobUrl] = useState("");
  const [image, setImage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(
    () => () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    },
    [blobUrl],
  );
  const load = async () => {
    setBusy(true);
    setError("");
    controller.current = new AbortController();
    try {
      const blob = await fetchMedia(
        session.identity,
        href,
        controller.current.signal,
      );
      if (controller.current.signal.aborted) return;
      const safeImage = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
      ].includes(blob.type);
      setImage(safeImage);
      // Non-image attachments must download, never execute as same-origin HTML.
      setBlobUrl(
        URL.createObjectURL(
          safeImage
            ? blob
            : new Blob([blob], { type: "application/octet-stream" }),
        ),
      );
    } catch (cause) {
      if (!controller.current.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Файл недоступен.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="chat-attachment">
      {blobUrl ? (
        <>
          {image && <img src={blobUrl} alt={name} />}
          <a href={blobUrl} download={name}>
            {name} · Скачать
          </a>
        </>
      ) : (
        <button type="button" disabled={busy} onClick={() => void load()}>
          {busy ? "Загружаем…" : `Открыть файл: ${name}`}
        </button>
      )}
      {error && <span role="alert">{error}</span>}
    </span>
  );
}

export function MessageRow({
  message,
  session,
  replies,
  onReply,
  onOpenThread,
}: {
  message: ChatMessage;
  session: ChatSession;
  replies: number;
  onReply: () => void;
  onOpenThread: () => void;
}) {
  const row = useRef<HTMLElement>(null);
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(message.content);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const event = message.event;
  const mine = event.pubkey === session.identity.pubkey;
  useEffect(() => {
    let visible = false;
    const read = () => {
      if (
        visible &&
        document.visibilityState === "visible" &&
        document.hasFocus()
      )
        session.markRead([event]);
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting && entry.intersectionRatio >= 0.5;
        read();
      },
      { threshold: 0.5 },
    );
    if (row.current) observer.observe(row.current);
    window.addEventListener("focus", read);
    document.addEventListener("visibilitychange", read);
    return () => {
      observer.disconnect();
      window.removeEventListener("focus", read);
      document.removeEventListener("visibilitychange", read);
    };
  }, [event, session]);
  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      setEditing(false);
      setDeleting(false);
    } catch (error) {
      session.report(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <article
      ref={row}
      className={`chat-message${mine ? " chat-message-mine" : ""}`}
      data-message-id={event.id}
    >
      <div className="chat-avatar" aria-hidden="true">
        {session.label(event.pubkey).slice(0, 1).toUpperCase()}
      </div>
      <div className="chat-message-main">
        <header>
          <strong>{session.label(event.pubkey)}</strong>
          <time
            dateTime={new Date(event.created_at * 1000).toISOString()}
            title={new Date(event.created_at * 1000).toLocaleString("ru")}
          >
            {new Date(event.created_at * 1000).toLocaleTimeString("ru", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
          {message.edited && <span className="chat-muted">изменено</span>}
        </header>
        {message.deleted ? (
          <p className="chat-muted">Сообщение удалено</p>
        ) : editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(() => session.edit(event, content));
            }}
          >
            <textarea
              aria-label="Редактировать сообщение"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              maxLength={20_000}
            />
            <button type="submit" disabled={busy || !content.trim()}>
              Сохранить
            </button>
            <button type="button" onClick={() => setEditing(false)}>
              Отмена
            </button>
          </form>
        ) : (
          <div className="chat-markdown">
            <Markdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children }) =>
                  href && mediaUrl(href, session.identity.origin) ? (
                    <Attachment
                      key={href}
                      href={href}
                      name={
                        typeof children === "string" ? children : "Вложение"
                      }
                      session={session}
                    />
                  ) : (
                    <a href={href} target="_blank" rel="noopener noreferrer">
                      {children}
                    </a>
                  ),
                img: ({ src, alt }) =>
                  typeof src === "string" &&
                  mediaUrl(src, session.identity.origin) ? (
                    <Attachment
                      key={src}
                      href={src}
                      name={alt || "Изображение"}
                      session={session}
                    />
                  ) : (
                    <span className="chat-muted">
                      Внешнее изображение скрыто
                    </span>
                  ),
              }}
            >
              {message.content}
            </Markdown>
          </div>
        )}
        {!message.deleted && !editing && (
          <div className="chat-message-actions">
            {message.reactions.map((reaction) => (
              <button
                key={reaction.emoji}
                type="button"
                className="chat-reaction-pill"
                aria-pressed={Boolean(reaction.mine)}
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    session.react(event, reaction.emoji, reaction.mine),
                  )
                }
              >
                {reaction.emoji} {reaction.count}
              </button>
            ))}
            {!message.reactions.some((r) => r.emoji === "👍") && (
              <button
                type="button"
                aria-label="Поставить 👍"
                title="Поставить 👍"
                className="chat-hover-action"
                disabled={busy}
                onClick={() => void act(() => session.react(event, "👍"))}
              >
                <SmilePlus size={16} />
              </button>
            )}
            <button
              type="button"
              className="chat-hover-action"
              aria-label="Ответить"
              title="Ответить в ветке"
              onClick={onReply}
            >
              <MessageSquare size={16} />
            </button>
            {replies > 0 && (
              <button
                type="button"
                className="chat-thread-link"
                aria-label={`Ветка · ${replies}`}
                onClick={onOpenThread}
              >
                <MessageSquare size={14} /> {replies} в ветке
              </button>
            )}
            {mine && (
              <>
                <button
                  type="button"
                  className="chat-hover-action"
                  aria-label="Изменить"
                  title="Изменить"
                  onClick={() => {
                    setContent(message.content);
                    setEditing(true);
                  }}
                >
                  <Pencil size={15} />
                </button>
                <button
                  type="button"
                  className="chat-hover-action"
                  aria-label="Удалить"
                  title="Удалить"
                  onClick={() => setDeleting(true)}
                >
                  <Trash2 size={15} />
                </button>
              </>
            )}
          </div>
        )}
        {deleting && (
          <div role="alert" className="chat-delete-confirm">
            Удалить сообщение?
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(() => session.deleteMessage(event))}
            >
              Да, удалить
            </button>
            <button type="button" onClick={() => setDeleting(false)}>
              Отмена
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
