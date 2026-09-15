import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Bold, Code, Italic, Paperclip, Send, Smile, Type } from "lucide-react";
import type { Event } from "nostr-tools/pure";
import type { ChatSession } from "../lib/session";
import { uploadFile } from "../lib/media";

export type ComposerDraft = {
  text: string;
  attachments: Awaited<ReturnType<typeof uploadFile>>[];
  pending: Event | null;
};

export function Composer({
  session,
  channel,
  parent,
  onCancelReply,
  disabled,
  draft,
  label = "Сообщение",
  submitLabel = "Отправить",
  placeholder = "Написать сообщение…",
  showReplyContext = true,
}: {
  session: ChatSession;
  channel: string;
  parent?: Event;
  onCancelReply: () => void;
  disabled: boolean;
  draft: ComposerDraft;
  label?: string;
  submitLabel?: string;
  placeholder?: string;
  showReplyContext?: boolean;
}) {
  const [text, updateText] = useState(draft.text);
  const [attachments, updateAttachments] = useState(draft.attachments);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pending, updatePending] = useState<Event | null>(draft.pending);
  const [error, setError] = useState("");
  const [formatOpen, setFormatOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const mounted = useRef(true);
  useLayoutEffect(() => {
    const field = textarea.current;
    if (!field) return;
    field.style.height = text.length ? "0px" : "auto";
    if (text.length)
      field.style.height = `${Math.min(field.scrollHeight, 112)}px`;
  }, [text]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const setText = (value: string) => {
    draft.text = value;
    if (mounted.current) updateText(value);
  };
  const setAttachments = (value: typeof attachments) => {
    draft.attachments = value;
    if (mounted.current) updateAttachments(value);
  };
  const setPending = (value: Event | null) => {
    draft.pending = value;
    if (mounted.current) updatePending(value);
  };
  const insert = (before: string, after = "") => {
    const start = textarea.current?.selectionStart ?? text.length;
    const end = textarea.current?.selectionEnd ?? start;
    setText(
      text.slice(0, start) +
        before +
        text.slice(start, end) +
        after +
        text.slice(end),
    );
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(
        start + before.length,
        end + before.length,
      );
    });
  };
  // Composer is remounted between conversations. Do not post after leaving a draft.
  const send = async () => {
    if ((!text.trim() && !attachments.length && !pending) || busy || uploading)
      return;
    setBusy(true);
    setError("");
    try {
      const event =
        pending ??
        session.prepareMessage(
          channel,
          [text.trim(), ...attachments.map((item) => item.content)]
            .filter(Boolean)
            .join("\n\n"),
          parent,
          attachments.map((item) => item.tag),
        );
      setPending(event);
      await session.send(event);
      setPending(null);
      setText("");
      setAttachments([]);
      if (mounted.current) onCancelReply();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Не удалось отправить сообщение.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className={`chat-composer${formatOpen ? " chat-composer-format-open" : ""}`}
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <fieldset
        className="chat-format-tools"
        aria-label="Форматирование сообщения"
      >
        <button
          type="button"
          title="Жирный текст"
          aria-label="Жирный текст"
          disabled={disabled || Boolean(pending)}
          onClick={() => insert("**", "**")}
        >
          <Bold size={16} />
        </button>
        <button
          type="button"
          title="Курсив"
          aria-label="Курсив"
          disabled={disabled || Boolean(pending)}
          onClick={() => insert("_", "_")}
        >
          <Italic size={16} />
        </button>
        <button
          type="button"
          title="Код"
          aria-label="Код"
          disabled={disabled || Boolean(pending)}
          onClick={() => insert("`", "`")}
        >
          <Code size={17} />
        </button>
      </fieldset>
      {parent && showReplyContext && (
        <div className="chat-reply-to">
          Ответ: {session.label(parent.pubkey)}
          <button
            type="button"
            disabled={Boolean(pending)}
            onClick={onCancelReply}
          >
            Отменить ответ
          </button>
        </div>
      )}
      {attachments.map((item, index) => (
        <div className="chat-file-chip" key={item.content}>
          {item.tag.find((tag) => tag.startsWith("filename "))?.slice(9)}
          <button
            type="button"
            disabled={Boolean(pending)}
            aria-label="Убрать вложение"
            onClick={() =>
              setAttachments(attachments.filter((_, i) => i !== index))
            }
          >
            ×
          </button>
        </div>
      ))}
      <textarea
        ref={textarea}
        aria-label={label}
        placeholder={disabled ? "Отправка недоступна" : placeholder}
        rows={1}
        enterKeyHint="enter"
        autoCapitalize="sentences"
        maxLength={20_000}
        value={text}
        onChange={(event) => setText(event.target.value)}
        disabled={disabled}
        readOnly={Boolean(pending)}
        onKeyDown={(event) => {
          if (
            !event.nativeEvent.isComposing &&
            event.key === "Enter" &&
            (event.ctrlKey || event.metaKey)
          ) {
            event.preventDefault();
            void send();
          }
        }}
      />
      <div className="chat-composer-tools">
        <button
          type="button"
          className="chat-format-toggle"
          aria-label="Форматирование"
          aria-expanded={formatOpen}
          onClick={() => setFormatOpen((value) => !value)}
        >
          <Type size={20} />
        </button>
        <input
          ref={fileInput}
          type="file"
          className="chat-file-input"
          aria-label={
            label === "Сообщение" ? "Выбрать файл" : "Выбрать файл в канале"
          }
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setUploading(true);
            setError("");
            void uploadFile(session.identity, file)
              .then((attachment) =>
                setAttachments([...draft.attachments, attachment]),
              )
              .catch((cause) =>
                setError(
                  cause instanceof Error ? cause.message : "Ошибка загрузки.",
                ),
              )
              .finally(() => setUploading(false));
          }}
        />
        <button
          type="button"
          title="Прикрепить файл · до 20 МБ"
          aria-label="Прикрепить файл"
          disabled={
            disabled ||
            busy ||
            uploading ||
            Boolean(pending) ||
            attachments.length >= 4
          }
          onClick={() => fileInput.current?.click()}
        >
          {uploading ? "…" : <Paperclip size={19} />}
        </button>
        <button
          type="button"
          title="Добавить улыбку"
          className="chat-emoji-button"
          aria-label="Добавить улыбку"
          disabled={disabled || Boolean(pending)}
          onClick={() => insert("🙂")}
        >
          <Smile size={19} />
        </button>
        <span className="chat-send-hint">Ctrl / ⌘ Enter — отправить</span>
        <button
          type="submit"
          className="chat-primary"
          aria-label={
            busy ? "Отправляем…" : pending ? "Повторить отправку" : submitLabel
          }
          title={pending ? "Повторить отправку" : submitLabel}
          onPointerDown={(event) => {
            // Cancelling a touch pointerdown suppresses the click in WebKit.
            if (
              event.pointerType === "mouse" &&
              document.activeElement === textarea.current
            )
              event.preventDefault();
          }}
          onClick={() => textarea.current?.focus({ preventScroll: true })}
          disabled={
            disabled ||
            busy ||
            uploading ||
            (!text.trim() && !attachments.length && !pending)
          }
        >
          {busy ? "…" : pending ? "Повторить отправку" : <Send size={17} />}
        </button>
      </div>
      {error && (
        <p role="alert" className="chat-error">
          {error}
          {pending &&
            " Повторная отправка использует тот же ID, без дубликата."}
        </p>
      )}
    </form>
  );
}
