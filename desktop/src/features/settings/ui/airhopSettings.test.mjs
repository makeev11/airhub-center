import assert from "node:assert/strict";
import test from "node:test";

import {
  AIRHOP_SETTING_IDS,
  airHopSettingsCopy,
  resolveAirHopSettingsSection,
} from "./airhopSettings.ts";

test("Airhop exposes only approved Center settings", () => {
  assert.deepEqual(AIRHOP_SETTING_IDS, [
    "appearance",
    "profile",
    "notifications",
    "shortcuts",
    "agents",
    "community-members",
    "custom-emoji",
    "mobile",
    "updates",
  ]);
});

test("legacy Buzz settings fail closed to appearance", () => {
  assert.equal(resolveAirHopSettingsSection("profile"), "profile");
  assert.equal(resolveAirHopSettingsSection("voice"), "appearance");
  assert.equal(resolveAirHopSettingsSection("compute"), "appearance");
  assert.equal(resolveAirHopSettingsSection(null), "appearance");
});

test("every selected locale owns Center settings copy", () => {
  assert.equal(airHopSettingsCopy("ru-RU").labels.agents, "AI-агенты");
  assert.equal(airHopSettingsCopy("en-US").labels.agents, "AI agents");
  assert.equal(airHopSettingsCopy("tr-TR").groups.center, "Merkez");
  assert.equal(airHopSettingsCopy("pt-BR").groups.center, "Centro");
});
