import assert from "node:assert/strict";
import test from "node:test";
import { withWelcomeGuestProfile } from "./welcomeGuestProfile.ts";

const key = "a".repeat(64);
test("guest fallback requires the registered key and does not mutate source profiles", () => {
  const profiles = {};
  assert.equal(withWelcomeGuestProfile(profiles, null, "ru-RU"), profiles);
  assert.equal(withWelcomeGuestProfile(profiles, "spoofed", "ru-RU"), profiles);
  const result = withWelcomeGuestProfile(profiles, key.toUpperCase(), "ru-RU");
  assert.equal(result[key].displayName, "Гермес");
  assert.equal(result[key].avatarUrl, "/agents/hermes.png");
  assert.equal(result[key].isAgent, true);
  assert.deepEqual(profiles, {});
  assert.equal(
    withWelcomeGuestProfile({}, key, "pt-BR")[key].displayName,
    "Hermes",
  );
});
test("guest fallback preserves a real customized profile and other participants", () => {
  const profile = {
    displayName: "Администратор мастерской",
    avatarUrl: "https://example.org/avatar.png",
    nip05Handle: "hermes",
    ownerPubkey: null,
    isAgent: true,
  };
  const other = {
    displayName: "Андрей",
    avatarUrl: null,
    nip05Handle: null,
    ownerPubkey: null,
  };
  const result = withWelcomeGuestProfile(
    { [key]: profile, other },
    key,
    "ru-RU",
  );
  assert.deepEqual(result[key], profile);
  assert.equal(result.other, other);
});
