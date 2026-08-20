import assert from "node:assert/strict";
import test from "node:test";

import { isBuzzTheme, usesBuzzVibrancy } from "./ThemeProvider.tsx";
import {
  resolveShikiThemeName,
  resolveSystemTheme,
  SYNTAX_THEMES,
} from "./theme-loader.ts";

test("New Slack is a paired Airhop chrome theme", () => {
  assert.ok(SYNTAX_THEMES.includes("new-slack"));
  assert.ok(SYNTAX_THEMES.includes("new-slack-dark"));
  assert.equal(resolveSystemTheme("new-slack", true), "new-slack-dark");
  assert.equal(resolveSystemTheme("new-slack-dark", false), "new-slack");
  assert.equal(resolveShikiThemeName("new-slack"), "slack-ochin");
  assert.equal(resolveShikiThemeName("new-slack-dark"), "slack-dark");
});

test("New Slack keeps Buzz chrome without native translucency", () => {
  assert.equal(isBuzzTheme("new-slack"), true);
  assert.equal(isBuzzTheme("new-slack-dark"), true);
  assert.equal(usesBuzzVibrancy("new-slack"), false);
  assert.equal(usesBuzzVibrancy("new-slack-dark"), false);
  assert.equal(usesBuzzVibrancy("buzz"), true);
  assert.equal(usesBuzzVibrancy("buzz-dark"), true);
});
