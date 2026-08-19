import assert from "node:assert/strict";
import test from "node:test";

import {
  AIRHOP_LOCALE_STORAGE_KEY,
  AIRHOP_LOCALES,
  isAirHopLocale,
  loadAirHopLocale,
  persistAirHopLocale,
  resolveAirHopLocale,
} from "./airhopLocale.ts";

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

test("Airhop exposes every selectable owner locale", () => {
  assert.deepEqual(AIRHOP_LOCALES, ["ru-RU", "en-US", "tr-TR", "pt-BR"]);
  assert.equal(isAirHopLocale("pt-BR"), true);
  assert.equal(isAirHopLocale("de-DE"), false);
});

test("Airhop locale persists through the shared storage contract", () => {
  const target = storage();
  persistAirHopLocale("tr-TR", target);
  assert.equal(target.getItem(AIRHOP_LOCALE_STORAGE_KEY), "tr-TR");
  assert.equal(loadAirHopLocale(target), "tr-TR");
});

test("Airhop defaults to English until the user makes a choice", () => {
  globalThis.localStorage = storage();
  assert.equal(resolveAirHopLocale(), "en-US");
  delete globalThis.localStorage;
});
