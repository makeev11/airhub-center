import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveWelcomeLocale,
  welcomeRoleDefinition,
} from "./welcomeTeamLocale.ts";

test("Russian locale exposes the localized Airhop team and natural aliases", () => {
  const locale = resolveWelcomeLocale("ru-RU");

  assert.equal(locale.language, "ru");
  assert.deepEqual(locale.names, {
    fizz: "\u0424\u0438\u0437",
    administrator: "\u0410\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440",
    analyst: "\u0410\u043d\u0430\u043b\u0438\u0442\u0438\u043a",
    content_marketer: "\u041a\u043e\u043d\u0442\u0435\u043d\u0442-\u043c\u0430\u0440\u043a\u0435\u0442\u043e\u043b\u043e\u0433",
  });
  assert.ok(locale.aliases.administrator.includes("\u0410\u0434\u043c\u0438\u043d"));
  assert.equal(
    welcomeRoleDefinition("administrator", "ru-RU").name,
    "\u0410\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440",
  );
});

test("English and Portuguese locales keep the same stable roles", () => {
  const english = resolveWelcomeLocale("en-US");
  const portuguese = resolveWelcomeLocale("pt-BR");

  assert.equal(english.language, "en");
  assert.equal(english.names.fizz, "Fizz");
  assert.equal(english.names.content_marketer, "Content Marketer");
  assert.equal(portuguese.language, "pt");
  assert.equal(portuguese.names.administrator, "Administrador");
  assert.equal(portuguese.names.analyst, "Analista");
});

test("unsupported organization locale falls back to concise English copy", () => {
  const locale = resolveWelcomeLocale("de-DE");

  assert.equal(locale.language, "en");
  assert.ok(locale.providerRequired.length > 0);
  assert.ok(locale.providerRequired.length < 180);
  assert.ok(locale.specialistUnavailable("analyst").length < 180);
});

test("kickoff instructions stay semantic, localized, and short", () => {
  const russian = resolveWelcomeLocale("ru-RU").kickoffInstruction(
    "fizz_first_question",
    "\u0410\u043d\u0434\u0440\u0435\u0439",
  );
  const portuguese = resolveWelcomeLocale("pt-BR").kickoffInstruction(
    "administrator_intro",
  );

  assert.match(russian, /\u0410\u043d\u0434\u0440\u0435\u0439/);
  assert.match(russian, /\u0432\u043e\u043f\u0440\u043e\u0441/i);
  assert.match(portuguese, /administrador/i);
  assert.ok(russian.length < 320);
  assert.ok(portuguese.length < 320);
});
