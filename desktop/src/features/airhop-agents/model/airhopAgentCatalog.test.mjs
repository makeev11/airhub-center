import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AIRHOP_AGENT_CATALOG,
  materializeAirhopAgentCards,
} from "./airhopAgentCatalog.ts";

test("Airhop presents the approved team in a stable order", () => {
  assert.deepEqual(
    AIRHOP_AGENT_CATALOG.map(({ personaId }) => personaId),
    [
      "builtin:airhop-fizz",
      "builtin:airhop-administrator",
      "builtin:airhop-analyst",
      "builtin:airhop-content-marketer",
    ],
  );
  assert.deepEqual(
    AIRHOP_AGENT_CATALOG.map(({ avatarUrl }) => avatarUrl),
    [
      "/agents/fizz.png",
      "/agents/administrator.png",
      "/agents/analyst.png",
      "/agents/editor.png",
    ],
  );
});

test("Airhop agent names are available in every supported locale", () => {
  for (const agent of AIRHOP_AGENT_CATALOG) {
    assert.deepEqual(Object.keys(agent.name).sort(), [
      "en-US",
      "pt-BR",
      "ru-RU",
      "tr-TR",
    ]);
  }
  assert.equal(AIRHOP_AGENT_CATALOG[0].name["ru-RU"], "Физ");
  assert.equal(AIRHOP_AGENT_CATALOG[3].name["en-US"], "Content Marketer");
});

const managed = (pubkey, relayUrl = "wss://demo.airhop.ru") => ({
  pubkey,
  relayUrl,
  personaId: "builtin:airhop-fizz",
  model: "test",
  status: "running",
  lastError: null,
  respondTo: "owner-only",
});
test("registered identity wins over an unrelated local duplicate with the same role", () => {
  const canonical = "a".repeat(64),
    duplicate = "b".repeat(64);
  const cards = materializeAirhopAgentCards(
    [managed(duplicate), managed(canonical)],
    "ru-RU",
    "wss://demo.airhop.ru",
    [{ role: "fizz", pubkey: canonical }],
  );
  assert.equal(cards.length, 1);
  assert.equal(cards[0].pubkey, canonical);
  assert.equal(cards[0].name, "Физ");
  assert.equal(cards[0].state, "running");
  assert.equal(cards[0].controllable, true);
});
test("unregistered personas cannot appear; remote registration does not imply a local running process", () => {
  const key = "a".repeat(64);
  assert.deepEqual(
    materializeAirhopAgentCards(
      [managed(key)],
      "ru-RU",
      "wss://demo.airhop.ru",
    ),
    [],
  );
  const [card] = materializeAirhopAgentCards(
    [managed(key, "wss://other.example")],
    "en-US",
    "wss://demo.airhop.ru",
    [{ role: "fizz", pubkey: key }],
  );
  assert.equal(card.name, "Fizz");
  assert.equal(card.state, "registered");
  assert.equal(card.controllable, false);
});
