import assert from "node:assert/strict";
import test from "node:test";

import { getAppearanceMessages } from "./appearanceLocale.ts";

test("appearance copy localizes the center and booking widget targets", () => {
  const russian = getAppearanceMessages("ru-RU");
  const english = getAppearanceMessages("en-US");

  assert.equal(russian.title, "Внешний вид");
  assert.equal(russian.widgetTarget, "Виджет записи");
  assert.equal(english.title, "Appearance");
  assert.equal(english.widgetTarget, "Booking widget");
});

test("Turkish falls back to English while Brazilian Portuguese is complete", () => {
  assert.equal(getAppearanceMessages("tr-TR").widgetSave, "Save changes");
  assert.equal(getAppearanceMessages("pt-BR").widgetSave, "Salvar alterações");
  assert.equal(
    getAppearanceMessages("pt-BR").widgetTarget,
    "Widget de agendamento",
  );
});
