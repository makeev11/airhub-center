import assert from "node:assert/strict";
import test from "node:test";
import { clientMessagePresentation } from "./clientPresentation.ts";

const connector = "ab".repeat(32);
const clients = [
  {
    rootEventId: "root-a",
    title: "Анна · Семья Ивановых",
    parentName: "Анна",
    connectorPubkey: connector,
    provider: "telegram",
  },
  {
    rootEventId: "root-b",
    title: "Новый контакт",
    parentName: null,
    connectorPubkey: connector,
    provider: "telegram",
  },
];
test("shared connector retains distinct conversation names without changing source", () => {
  const message = { id: "reply", rootId: "root-a", pubkey: connector };
  assert.equal(clientMessagePresentation(clients, message).parentLabel, "Анна");
  assert.equal(
    clientMessagePresentation(clients, { ...message, rootId: "root-b" })
      .parentLabel,
    "Клиент · telegram",
  );
  assert.equal(message.pubkey, connector);
});
test("unknown root and different signer never inherit parent identity", () => {
  assert.equal(
    clientMessagePresentation(clients, { id: "unknown", pubkey: connector }),
    null,
  );
  const result = clientMessagePresentation(clients, {
    id: "reply",
    rootId: "root-a",
    pubkey: connector,
    signerPubkey: "cd".repeat(32),
  });
  assert.equal(result.parentLabel, null);
});
test("updated authoritative title retains the same root", () => {
  const message = { id: "root-a", pubkey: connector };
  assert.equal(clientMessagePresentation(clients, message).isRoot, true);
  const updated = [
    { ...clients[0], title: "Анна Петрова", parentName: "Анна Петрова" },
  ];
  assert.equal(
    clientMessagePresentation(updated, message).title,
    "Анна Петрова",
  );
  assert.equal(
    clientMessagePresentation(updated, message).conversation.rootEventId,
    "root-a",
  );
});
