import { useEffect, useState } from "react";
import { relayHttpBaseUrl } from "@/shared/lib/relay-url";
import { relayOrigin, VAULT_KEY, type ChatIdentity } from "../lib/identity";
import { ChatSession } from "../lib/session";
import { ChatWorkspace } from "./ChatWorkspace";
import { ConnectChat } from "./ConnectChat";
import { ChatViewport } from "./ChatViewport";
import { CenterPicker } from "./CenterPicker";
import {
  centerIdentity,
  centerVaultKey,
  type ChatCenter,
} from "../lib/centers";
import "./chat.css";
import "./chat-mobile.css";

function ConnectedCenter({ center }: { center: ChatCenter | null }) {
  const [identity, setIdentity] = useState<ChatIdentity | null>(null);
  const [session, setSession] = useState<ChatSession | null>(null);
  const [configuration] = useState(() => {
    try {
      return {
        origin: center?.origin ?? relayOrigin(relayHttpBaseUrl()),
        error: "",
      };
    } catch {
      return {
        origin: "",
        error:
          "Для чата нужен HTTPS-адрес Центра. Проверьте настройки подключения.",
      };
    }
  });
  const vaultKey = center ? centerVaultKey(center.origin) : VAULT_KEY;
  useEffect(() => {
    if (
      ["chat", "chat-app"].includes(import.meta.env.MODE) &&
      "serviceWorker" in navigator
    ) {
      void navigator.serviceWorker
        .register("/chat-sw.js", { scope: "/chat" })
        .catch(() => {
          /* The online chat remains usable if shell caching is unavailable. */
        });
    }
  }, []);
  useEffect(() => {
    const manifest = document.createElement("link");
    manifest.rel = "manifest";
    manifest.href = "/chat.webmanifest";
    document.head.append(manifest);
    const icon = document.createElement("link");
    icon.rel = "apple-touch-icon";
    icon.href = "/chat-touch-icon.png";
    document.head.append(icon);
    const title = document.title;
    const language = document.documentElement.lang;
    document.documentElement.lang = "ru";
    document.title = "Чат · AirHop Center";
    return () => {
      manifest.remove();
      icon.remove();
      document.documentElement.lang = language;
      document.title = title;
    };
  }, []);
  useEffect(() => {
    if (!identity) {
      setSession(null);
      return;
    }
    const next = new ChatSession(identity);
    setSession(next);
    void next.start();
    return () => next.dispose();
  }, [identity]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hiddenAt: number | null = null;
    const lock = () => {
      session?.dispose();
      setSession(null);
      identity?.secret.fill(0);
      setIdentity(null);
    };
    const visibility = () => {
      clearTimeout(timer);
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        timer = setTimeout(lock, 10 * 60_000);
      } else {
        if (hiddenAt !== null && Date.now() - hiddenAt >= 10 * 60_000) lock();
        hiddenAt = null;
      }
    };
    const storage = (event: StorageEvent) => {
      if (event.key === vaultKey || event.key === null) lock();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("storage", storage);
    window.addEventListener("pagehide", lock);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("storage", storage);
      window.removeEventListener("pagehide", lock);
    };
  }, [identity, session, vaultKey]);
  const lock = () => {
    session?.dispose();
    identity?.secret.fill(0);
    setSession(null);
    setIdentity(null);
  };
  if (configuration.error)
    return (
      <div className="chat-connect">
        <p role="alert">{configuration.error}</p>
      </div>
    );
  return (
    <ChatViewport>
      {identity && session ? (
        <ChatWorkspace session={session} onLock={lock} />
      ) : (
        <ConnectChat
          origin={configuration.origin}
          vaultKey={vaultKey}
          onChangeCenter={center ? () => window.location.reload() : undefined}
          onConnect={(next) =>
            setIdentity(center ? centerIdentity(next, center) : next)
          }
        />
      )}
    </ChatViewport>
  );
}

export function ChatPage() {
  const [center, setCenter] = useState<ChatCenter | null>(null);
  if (import.meta.env.MODE === "chat-app" && !center)
    return (
      <ChatViewport>
        <CenterPicker onSelect={setCenter} />
      </ChatViewport>
    );
  return <ConnectedCenter key={center?.id ?? "same-origin"} center={center} />;
}
