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

test("cards match only the current built-in persona ids", () => {
  const cards = materializeAirhopAgentCards(
    [
      {
        pubkey: "a".repeat(64),
        personaId: "builtin:airhop-fizz",
        model: "managed-model",
        status: "running",
        lastError: null,
        respondTo: "owner-only",
      },
    ],
    "ru-RU",
  );

  assert.equal(cards[0].name, "Физ");
  assert.equal(cards[0].state, "running");
  assert.equal(cards[0].model, "managed-model");
  assert.equal(cards[1].state, "unavailable");
});
