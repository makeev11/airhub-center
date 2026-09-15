import { useEffect, useRef, useState } from "react";
import type QrScanner from "qr-scanner";
import {
  openIdentity,
  sealIdentity,
  VAULT_KEY,
  type ChatIdentity,
} from "../lib/identity";
import { PairingSession, type PairingStep } from "../lib/pairing";

function Camera({
  onCode,
  onClose,
}: {
  onCode: (code: string) => void;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let scanner: QrScanner | undefined;
    void import("qr-scanner")
      .then(async ({ default: Scanner }) => {
        if (!active || !video.current) return;
        scanner = new Scanner(
          video.current,
          (result) => {
            if (active) onCode(result.data);
          },
          {
            preferredCamera: "environment",
            highlightScanRegion: true,
            returnDetailedScanResult: true,
          },
        );
        await scanner.start();
        if (!active) scanner.destroy();
      })
      .catch(() => {
        if (active)
          setError(
            "Камера недоступна. Разрешите доступ в браузере или вставьте код вручную.",
          );
      });
    return () => {
      active = false;
      scanner?.destroy();
    };
  }, [onCode]);
  return (
    <div className="chat-camera">
      <video ref={video} muted playsInline aria-label="Сканирование QR-кода" />
      {error && <p role="alert">{error}</p>}
      <button type="button" onClick={onClose}>
        Закрыть камеру
      </button>
    </div>
  );
}

export function ConnectChat({
  origin,
  onConnect,
  vaultKey = VAULT_KEY,
  onChangeCenter,
}: {
  origin: string;
  onConnect: (identity: ChatIdentity) => void;
  vaultKey?: string;
  onChangeCenter?: () => void;
}) {
  const [stored, setStored] = useState(() => {
    try {
      return localStorage.getItem(vaultKey);
    } catch {
      return null;
    }
  });
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const [forget, setForget] = useState(false);
  const [step, setStep] = useState<PairingStep | null>(null);
  const pairing = useRef<PairingSession | null>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      pairing.current?.close();
    };
  }, []);

  const unlock = async () => {
    if (!stored) return;
    setBusy(true);
    setError("");
    try {
      const identity = await openIdentity(stored, password, origin);
      if (active.current) {
        setPassword("");
        onConnect(identity);
      } else identity.secret.fill(0);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Не удалось открыть чат.",
      );
    } finally {
      if (active.current) setBusy(false);
    }
  };

  const connect = (input: string) => {
    setCamera(false);
    setError("");
    if (password.length < 12 || password !== confirmation) {
      setError(
        "Придумайте пароль от 12 символов и повторите его без изменений.",
      );
      return;
    }
    pairing.current?.close();
    try {
      const session = new PairingSession(
        input,
        origin,
        setStep,
        async (identity) => {
          const vault = await sealIdentity(identity, password);
          if (!active.current || pairing.current !== session)
            throw new Error("Подключение отменено.");
          localStorage.setItem(vaultKey, JSON.stringify(vault));
        },
        (identity) => {
          setPassword("");
          setConfirmation("");
          setCode("");
          onConnect(identity);
        },
      );
      pairing.current = session;
      setCode("");
      void session.start();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Неверный код.");
    }
  };

  return (
    <div className="chat-connect">
      <section className="chat-connect-card">
        <p className="chat-eyebrow">AIRHOP CENTER · ЧАТ</p>
        <h1>{stored ? "С возвращением" : "Команда всегда рядом"}</h1>
        <p className="chat-muted">
          {stored
            ? "Введите пароль этого браузера, чтобы открыть переписку."
            : "Те же каналы и сообщения Центра — прямо на телефоне."}
        </p>
        <p className="chat-origin">{new URL(origin).host}</p>
        {onChangeCenter && (
          <button
            type="button"
            className="chat-text-button"
            onClick={onChangeCenter}
          >
            Выбрать другой Центр
          </button>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (stored) void unlock();
            else connect(code);
          }}
        >
          <label>
            Пароль этого браузера
            <input
              type="password"
              autoComplete={stored ? "current-password" : "new-password"}
              minLength={stored ? undefined : 12}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy || Boolean(step && step.phase !== "error")}
            />
          </label>
          {!stored && (
            <>
              <label>
                Повторите пароль
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  disabled={Boolean(step && step.phase !== "error")}
                />
              </label>
              <p className="chat-muted chat-small">
                Пароль защищает подключение в этом браузере. Если забудете его,
                сможете снова привязать устройство с компьютера.
              </p>
            </>
          )}
          {stored ? (
            <button className="chat-primary" type="submit" disabled={busy}>
              {busy ? "Открываем…" : "Открыть чат"}
            </button>
          ) : !step || step.phase === "error" ? (
            <>
              <ol className="chat-instructions">
                <li>
                  На компьютере откройте Center → настройки → подключение
                  устройства.
                </li>
                <li>Отсканируйте QR-код или вставьте код подключения.</li>
                <li>Сравните шесть цифр на обоих устройствах.</li>
              </ol>
              <button
                type="button"
                onClick={() => setCamera(true)}
                disabled={password.length < 12 || password !== confirmation}
              >
                Сканировать QR-код
              </button>
              {camera && (
                <Camera onCode={connect} onClose={() => setCamera(false)} />
              )}
              <label>
                Код подключения
                <textarea
                  rows={2}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="nostrpair://…"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  required={!camera}
                />
              </label>
              <button type="submit" className="chat-primary">
                Подключить устройство
              </button>
            </>
          ) : (
            <div className="chat-pairing" aria-live="polite">
              {step.phase === "connecting" && <p>Соединяемся с компьютером…</p>}
              {step.phase === "confirm" && (
                <>
                  <p>На компьютере те же шесть цифр?</p>
                  <strong className="chat-sas">{step.code}</strong>
                  <button
                    type="button"
                    className="chat-primary"
                    disabled={step.confirmed}
                    onClick={() => pairing.current?.confirm()}
                  >
                    {step.confirmed
                      ? "Подтвердите и на компьютере…"
                      : "Да, цифры совпадают"}
                  </button>
                </>
              )}
              {step.phase === "saving" && (
                <p>Проверяем доступ и сохраняем подключение…</p>
              )}
              <button
                type="button"
                onClick={() => {
                  pairing.current?.close();
                  pairing.current = null;
                  setStep(null);
                }}
              >
                Отменить
              </button>
            </div>
          )}
          {(error || step?.error) && (
            <p role="alert" className="chat-error">
              {error || step?.error}
            </p>
          )}
        </form>
        {stored && (
          <div className="chat-forget">
            {forget ? (
              <>
                <p>
                  Удалить только подключение из этого браузера? Переписка на
                  сервере останется. Понадобится новая привязка.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    localStorage.removeItem(vaultKey);
                    setStored(null);
                    setPassword("");
                    setForget(false);
                    setError("");
                  }}
                >
                  Удалить подключение
                </button>
                <button type="button" onClick={() => setForget(false)}>
                  Отмена
                </button>
              </>
            ) : (
              <button
                type="button"
                className="chat-text-button"
                onClick={() => setForget(true)}
              >
                Подключить заново
              </button>
            )}
          </div>
        )}
        <p className="chat-pilot">
          Пилотная версия. Фоновые уведомления пока не подключены.
        </p>
      </section>
    </div>
  );
}
