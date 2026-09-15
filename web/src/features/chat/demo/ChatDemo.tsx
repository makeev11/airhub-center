import { useEffect, useState } from "react";
import { importIdentity } from "../lib/identity";
import { ChatSession } from "../lib/session";
import { ChatWorkspace } from "../ui/ChatWorkspace";
import { ChatViewport } from "../ui/ChatViewport";
import "../ui/chat.css";
import "../ui/chat-mobile.css";
import "./demo.css";

/** Local interactive demo; its identities exist only in the preview process. */
export function ChatDemo() {
  const [session, setSession] = useState<ChatSession | null>(null);
  const [error, setError] = useState("");
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    if (closed) return;
    let disposed = false;
    let active: ChatSession | null = null;
    const abort = new AbortController();
    setError("");
    const connect = async () => {
      try {
        if (
          location.hostname !== "127.0.0.1" ||
          import.meta.env.MODE !== "chat-demo"
        )
          throw new Error(
            "Демонстрация доступна только локально на этом компьютере.",
          );
        const response = await fetch("/__demo__/session", {
          signal: abort.signal,
          cache: "no-store",
        });
        if (!response.ok)
          throw new Error(
            "Не удалось запустить демонстрацию. Перезапустите локальный просмотр.",
          );
        const identity = importIdentity(await response.text(), location.origin);
        if (disposed) {
          identity.secret.fill(0);
          return;
        }
        active = new ChatSession(identity);
        setSession(active);
        await active.start();
      } catch (cause) {
        if (!disposed)
          setError(cause instanceof Error ? cause.message : "Демо недоступно.");
      }
    };
    void connect();
    return () => {
      disposed = true;
      abort.abort();
      active?.dispose();
      active?.identity.secret.fill(0);
    };
  }, [closed]);
  return (
    <ChatViewport>
      <div className="chat-demo-root">
        <aside className="chat-demo-banner" aria-label="Режим демонстрации">
          <div>
            <strong>Демо чата Center</strong>
            <span>
              Вымышленные сотрудники. Сообщения остаются на этом компьютере.
            </span>
          </div>
          <details>
            <summary>Что попробовать</summary>
            <p>
              Напишите сообщение — Анна пришлёт явно обозначенный демо-ответ.
              Откройте ветку, личный чат или приложите тестовый файл. Это не ваш
              рабочий Center; настоящие документы и ключи здесь не нужны. После
              перезапуска демо переписка и файлы сбрасываются.
            </p>
          </details>
        </aside>
        {session && !closed ? (
          <ChatWorkspace
            session={session}
            initialChannelId="demo-team"
            onLock={() => {
              session.dispose();
              setSession(null);
              setClosed(true);
            }}
          />
        ) : (
          <div className="chat-connect">
            <div className="chat-connect-card">
              <h1>{closed ? "Демонстрация закрыта" : "Открываем чат…"}</h1>
              {error && <p role="alert">{error}</p>}
              {closed && (
                <button
                  type="button"
                  className="chat-primary"
                  onClick={() => setClosed(false)}
                >
                  Открыть демо снова
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </ChatViewport>
  );
}
