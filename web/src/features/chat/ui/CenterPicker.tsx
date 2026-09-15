import { useEffect, useState } from "react";
import { parseCenters, type ChatCenter } from "../lib/centers";

/** Shared app entry point; no credentials or messages are loaded before Center selection. */
export function CenterPicker({
  onSelect,
}: {
  onSelect: (center: ChatCenter) => void;
}) {
  const [centers, setCenters] = useState<ChatCenter[]>([]);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void fetch(`/chat-centers.json?attempt=${retry}`, {
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("Не удалось загрузить список Центров.");
        const list = parseCenters(await response.json());
        if (!controller.signal.aborted) setCenters(list);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            "Не удалось загрузить Центры. Проверьте интернет и попробуйте ещё раз.",
          );
      });
    return () => controller.abort();
  }, [retry]);
  return (
    <div className="chat-connect">
      <section className="chat-connect-card">
        <p className="chat-eyebrow">AIRHOP CENTER · ЧАТ</p>
        <h1>Ваш Центр</h1>
        <p>
          Выберите рабочий Центр и подключите этот телефон. Здесь будет
          существующая переписка вашей команды.
        </p>
        <div className="chat-center-list">
          {centers.map((center) => (
            <button
              type="button"
              key={center.id}
              onClick={() => onSelect(center)}
            >
              <strong>{center.name}</strong>
              <span>{new URL(center.origin).host}</span>
            </button>
          ))}
        </div>
        {!centers.length && !error && <p role="status">Загружаем Центры…</p>}
        {error && (
          <>
            <p role="alert">{error}</p>
            <button
              type="button"
              onClick={() => setRetry((value) => value + 1)}
            >
              Повторить
            </button>
          </>
        )}
        <p className="chat-small chat-muted">
          Нет вашего Центра? Попросите администратора AirHop подключить его
          адрес. Переписка доступна только сотрудникам после подтверждения
          доступа.
        </p>
        <p className="chat-pilot">
          Пилотная версия. Фоновые уведомления пока не подключены.
        </p>
      </section>
    </div>
  );
}
