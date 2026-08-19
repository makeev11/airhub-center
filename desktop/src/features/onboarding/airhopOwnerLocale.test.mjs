import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AIRHOP_OWNER_LOCALE_STORAGE_KEY,
  AIRHOP_OWNER_LOCALES,
  airHopOwnerCopy,
  airHopOwnerError,
  airHopOwnerLanguageLabel,
  loadAirHopOwnerLocale,
  persistAirHopOwnerLocale,
} from "./airhopOwnerLocale.ts";

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

test("owner first run exposes only launched locales in stable order", () => {
  assert.deepEqual(AIRHOP_OWNER_LOCALES, ["en-US", "ru-RU"]);
  assert.deepEqual(AIRHOP_OWNER_LOCALES.map(airHopOwnerLanguageLabel), [
    "English",
    "Русский",
  ]);
});

test("owner locale persists once and rejects unknown stored values", () => {
  const target = storage();
  persistAirHopOwnerLocale("pt-BR", target);
  assert.equal(target.getItem(AIRHOP_OWNER_LOCALE_STORAGE_KEY), "pt-BR");
  assert.equal(loadAirHopOwnerLocale(target), "pt-BR");
  assert.equal(
    loadAirHopOwnerLocale(
      storage({ [AIRHOP_OWNER_LOCALE_STORAGE_KEY]: "de-DE" }),
    ),
    null,
  );
});

test("every supported locale owns compact language, code, and profile copy", () => {
  for (const locale of ["ru-RU", "en-US", "tr-TR", "pt-BR"]) {
    const copy = airHopOwnerCopy(locale);
    for (const value of [
      copy.setupTitle,
      copy.chooseLanguage,
      copy.connectTitle,
      copy.connectHint,
      copy.codeLabel,
      copy.connect,
      copy.changeLanguage,
      copy.profileTitle,
      copy.profileHint,
      copy.nameLabel,
      copy.namePlaceholder,
      copy.next,
    ]) {
      assert.equal(typeof value, "string");
      assert.ok(value.trim().length > 0);
      assert.ok(
        value.length < 120,
        `${locale} copy must stay compact: ${value}`,
      );
    }
  }

  assert.equal(airHopOwnerCopy("ru-RU").setupTitle, "Настроим ваш центр");
  assert.equal(airHopOwnerCopy("en-US").setupTitle, "Set up your center");
  assert.equal(airHopOwnerCopy("tr-TR").setupTitle, "Merkezinizi kuralım");
  assert.equal(
    airHopOwnerCopy("pt-BR").setupTitle,
    "Vamos configurar seu centro",
  );
});

test("owner claim failures never leak raw transport errors", () => {
  assert.equal(
    airHopOwnerError("ru-RU", new TypeError("Load failed")),
    "Не удалось связаться с Airhop. Проверьте подключение и повторите.",
  );
  assert.equal(
    airHopOwnerError(
      "ru-RU",
      new Error("This invite has reached its use limit."),
    ),
    "Проверьте код и попробуйте ещё раз.",
  );
});
