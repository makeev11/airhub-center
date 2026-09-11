import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WelcomeGuestStatus } from "./WelcomeGuestStatus.tsx";

test("guest connection notice is localized, actionable and disappears after receipt", (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else delete globalThis.localStorage;
  });
  for (const [locale, retry] of [
    ["ru-RU", "Проверить снова"],
    ["en-US", "Check again"],
    ["pt-BR", "Verificar novamente"],
    ["tr-TR", "Tekrar kontrol et"],
  ]) {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { getItem: () => locale },
    });
    const render = (status) =>
      renderToStaticMarkup(
        createElement(WelcomeGuestStatus, { status, onRetry() {} }),
      );
    assert.equal(render(null), "");
    assert(!render("loading").includes("<button"));
    for (const status of ["error", "missing", "paused", "waiting"]) {
      const html = render(status);
      assert(html.includes('role="status"'));
      assert(html.includes(retry));
      assert(html.includes("<button"));
    }
  }
});
