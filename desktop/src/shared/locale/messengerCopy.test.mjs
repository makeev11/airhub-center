import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MESSENGER_RU,
  messageText,
  messengerCount,
  messageError,
  messengerTyping,
} from "./messengerCopy.ts";
import {
  formatDayHeading,
  formatTime,
  formatThreadSummaryLastReplyTime,
} from "../../features/messages/lib/dateFormatters.ts";
import { getEphemeralChannelDisplay } from "../../features/channels/lib/ephemeralChannel.ts";
import { resolveUserLabel } from "../../features/profile/lib/identity.ts";
import { formatDmParticipantDisplayName } from "../../features/channels/lib/dmParticipantDisplay.ts";

test("DM participant summaries keep authored names and localize hidden counts", () => {
  const participants = ["Alice", "Bob", "Carol", "Dan"].map((displayName) => ({
    displayName,
  }));
  assert.equal(
    formatDmParticipantDisplayName(participants, "ru-RU"),
    "Alice, Bob, Carol, ещё 1",
  );
  assert.equal(
    formatDmParticipantDisplayName(participants, "en-US"),
    "Alice, Bob, Carol, +1 more",
  );
});

test("copy and grammatical counts remain bilingual", () => {
  for (const [n, word] of [
    [0, "агентов"],
    [1, "агент"],
    [2, "агента"],
    [5, "агентов"],
    [11, "агентов"],
    [21, "агент"],
    [22, "агента"],
  ])
    assert.equal(messengerCount(n, "agent", "ru-RU"), n + " " + word);
  assert.equal(messengerCount(2, "reply", "en-US"), "2 replies");
  assert.equal(messageText("Add agents", {}, "ru-RU"), "Добавить AI-агентов");
  assert.equal(messageText("Add agents", {}, "en-US"), "Add agents");
  assert.equal(messageText("agent", {}, "ru-RU"), "агент");
  assert.equal(messageText("agent", {}, "en-US"), "agent");
  assert.equal(
    messageText("Remove {name}", { name: "Honey" }, "ru-RU"),
    "Убрать: Honey",
  );
  for (const [key, value] of Object.entries(MESSENGER_RU)) {
    assert.equal(typeof value, "string", key);
    assert.ok(/[а-яё]/i.test(value), key);
  }
});
test("dynamic typing and invitations contain whole localized sentences", () => {
  assert.equal(messengerTyping(["Alice"], "ru-RU"), "Alice печатает…");
  assert.equal(
    messengerTyping(["Alice", "Bob"], "ru-RU"),
    "Alice и Bob печатают…",
  );
  assert.equal(
    messengerTyping(["Alice", "Bob", "Carol", "Dan"], "ru-RU"),
    "Alice, Bob и ещё 2 участника печатают…",
  );
  assert.equal(messengerTyping(["Alice"], "en-US"), "Alice is typing...");
  assert.equal(messengerTyping([], "ru-RU"), "");
  assert.match(
    messageText(
      "{names} are not in this channel. Invite them, or send without inviting them.",
      { names: "Alice, Bob" },
      "ru-RU",
    ),
    /^В этом канале нет: Alice, Bob/,
  );
});

test("dates, errors and identity labels react to the selected locale without translating authored names", () => {
  const descriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  let locale = "ru-RU";
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => locale },
  });
  try {
    const time = new Date(2026, 8, 7, 12, 30).getTime() / 1000;
    assert.match(formatDayHeading(time), /сентября/);
    assert.match(formatTime(time), /12:30/);
    assert.equal(
      formatThreadSummaryLastReplyTime(time, time + 120),
      "2 минуты назад",
    );
    assert.equal(resolveUserLabel({ pubkey: "a", currentPubkey: "a" }), "Вы");
    assert.equal(
      resolveUserLabel({
        pubkey: "b",
        currentPubkey: "a",
        profiles: { b: { displayName: "You" } },
      }),
      "You",
    );
    assert.match(messageError(new Error("raw RPC failure")), /Не удалось/);
    const expired = getEphemeralChannelDisplay({
      ttlSeconds: 3600,
      ttlDeadline: new Date(0).toISOString(),
    });
    assert.equal(expired.tooltipLabel, "Временный канал. Срок хранения истёк.");
    locale = "en-US";
    assert.match(formatDayHeading(time), /September/);
    assert.equal(resolveUserLabel({ pubkey: "a", currentPubkey: "a" }), "You");
    assert.equal(messageError(new Error("raw RPC failure")), "raw RPC failure");
  } finally {
    if (descriptor)
      Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
  }
});
