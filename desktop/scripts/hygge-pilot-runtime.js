// Bundled after the site's own validated, read-only loadHyggeCenter adapter.
(() => {
  const panel = document.querySelector("[data-hygge-center]");
  if (!panel) return;
  const status = panel.querySelector("[data-hygge-status]");
  const list = panel.querySelector("[data-hygge-lessons]");
  const link = panel.querySelector("a[href^='/booking']");
  // Load the canonical Center form only after a click. The ordinary link stays
  // usable without JavaScript; no second booking implementation lives here.
  if (typeof HTMLDialogElement !== "undefined") {
    let dialog;
    let previousOverflow;
    link.addEventListener("click", (event) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      event.preventDefault();
      if (!dialog) {
        const style = document.createElement("style");
        style.textContent = `.hygge-booking-dialog{padding:0;border:0;border-radius:1rem;width:calc(100vw - 1rem);max-width:64rem;height:calc(100dvh - 1rem);max-height:calc(100dvh - 1rem);background:#fff}.hygge-booking-dialog[open]{display:flex;flex-direction:column}.hygge-booking-dialog::backdrop{background:#172320a8}.hygge-booking-dialog>header{display:flex;justify-content:flex-end;padding:.25rem .75rem;border-bottom:1px solid #ddd}.hygge-booking-dialog button{min-height:2.75rem;padding:.5rem;cursor:pointer;font:inherit}.hygge-booking-dialog iframe{border:0;width:100%;flex:1;min-height:0}`;
        document.head.append(style);
        dialog = document.createElement("dialog");
        dialog.className = "hygge-booking-dialog";
        dialog.setAttribute("aria-label", "Запись на занятие в Хюге");
        const header = document.createElement("header");
        const close = document.createElement("button");
        close.type = "button";
        close.textContent = "Закрыть запись ×";
        close.addEventListener("click", () => dialog.close());
        header.append(close);
        const frame = document.createElement("iframe");
        frame.title = "Онлайн-запись Хюге — AirHop Center";
        frame.setAttribute("data-hygge-booking-frame", "");
        frame.src = "/booking";
        frame.addEventListener("load", () => {
          frame.contentDocument?.addEventListener("keydown", (key) => {
            if (key.key === "Escape") {
              key.preventDefault();
              dialog.close();
            }
          });
        });
        dialog.append(header, frame);
        dialog.addEventListener("close", () => {
          document.body.style.overflow = previousOverflow;
          link.focus({ preventScroll: true });
        });
        document.body.append(dialog);
      }
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      dialog.showModal();
    });
  }
  let pending = false;
  async function refresh() {
    if (pending) return;
    pending = true;
    try {
      const result = await loadHyggeCenter();
      list.replaceChildren();
      list.hidden = result.status !== "ready";
      link.hidden = result.status === "wrong_tenant";
      if (result.status === "ready") {
        status.textContent = `Ближайшие занятия из Center. Часовой пояс: ${result.timeZone}. Свободные места и стоимость повторно проверяются при записи.`;
        for (const lesson of result.lessons) {
          const row = document.createElement("li");
          const title = document.createElement("strong");
          title.textContent = lesson.groupName;
          const time = document.createElement("span");
          time.textContent = `${lesson.date} · ${lesson.startTime}–${lesson.endTime}`;
          const price = document.createElement("small");
          price.textContent =
            lesson.priceRub === null
              ? "Стоимость уточняется в форме Center"
              : `${lesson.priceRub.toLocaleString("ru-RU")} ₽ · пробное`;
          row.append(title, time, price);
          list.append(row);
        }
      } else {
        status.textContent =
          result.status === "empty"
            ? "В тестовом Center пока нет доступных занятий. Они появятся здесь после настройки расписания."
            : result.status === "wrong_tenant"
              ? "Привязка организации изменилась. Запись временно закрыта, чтобы данные не попали в другой Center."
              : "Не удалось получить расписание. Актуальное состояние можно проверить в форме Center.";
      }
    } finally {
      pending = false;
    }
  }
  void refresh();
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) void refresh();
  });
})();
