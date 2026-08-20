import assert from "node:assert/strict";
import test from "node:test";

import { isBuzzTheme, usesBuzzVibrancy } from "./ThemeProvider.tsx";

test("New Slack keeps Buzz chrome without native translucency", () => {
  assert.equal(isBuzzTheme("new-slack"), true);
  assert.equal(isBuzzTheme("new-slack-dark"), true);
  assert.equal(usesBuzzVibrancy("new-slack"), false);
  assert.equal(usesBuzzVibrancy("new-slack-dark"), false);
});

test("AirHop themes keep their native macOS vibrancy", () => {
  assert.equal(usesBuzzVibrancy("buzz"), true);
  assert.equal(usesBuzzVibrancy("buzz-dark"), true);
});
