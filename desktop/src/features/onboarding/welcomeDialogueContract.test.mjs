import assert from "node:assert/strict";
import test from "node:test";

import * as e2eBridge from "../../testing/e2eBridge.ts";

function createFixture(overrides = {}) {
  return e2eBridge.createMockWelcomeAgentTeamFixture({
    locale: "ru-RU",
    routeTargetByEvent: {},
    unavailableRoles: [],
    completedKickoffStages: [],
    pendingActions: [],
    ...overrides,
  });
}

test("the E2E bridge exposes a deterministic Welcome agent-team fixture", () => {
  const createFixture = e2eBridge.createMockWelcomeAgentTeamFixture;
  assert.equal(typeof createFixture, "function");
  if (!createFixture) return;

  const fixture = createFixture({
    locale: "ru-RU",
    routeTargetByEvent: { "event-admin": "administrator" },
    unavailableRoles: ["analyst"],
    completedKickoffStages: ["fizz_intro"],
    pendingActions: [
      {
        id: "action-1",
        previewEventId: "a".repeat(64),
        specialistRole: "administrator",
        status: "pending",
        bookingCoreCommitted: false,
      },
    ],
  });

  assert.deepEqual(fixture.snapshot(), {
    locale: "ru-RU",
    routeTargetByEvent: { "event-admin": "administrator" },
    unavailableRoles: ["analyst"],
    completedKickoffStages: ["fizz_intro"],
    pendingActions: [
      {
        id: "action-1",
        previewEventId: "a".repeat(64),
        specialistRole: "administrator",
        status: "pending",
        bookingCoreCommitted: false,
      },
    ],
  });
});

test("provider absence emits one localized Fizz notice across reloads", () => {
  const fixture = createFixture();

  const first = fixture.providerNotice?.();
  assert.deepEqual(first?.respondingRoles, ["fizz"]);
  assert.equal(first?.messages.length, 1);
  assert.match(first?.messages[0] ?? "", /AI-/i);
  assert.equal(fixture.providerNotice?.(), null);

  const reloaded = fixture.reload();
  assert.equal(reloaded.providerNotice?.(), null);
});

test("a degraded specialist never causes a fallback agent reply", () => {
  const fixture = createFixture({
    routeTargetByEvent: { "event-analyst": "analyst" },
    unavailableRoles: ["analyst"],
  });

  const failure = fixture.respondToEvent?.("event-analyst");
  assert.equal(failure?.targetRole, "analyst");
  assert.deepEqual(failure?.respondingRoles, []);
  assert.deepEqual(failure?.messages, []);
  assert.equal(failure?.notices.length, 1);
  assert.match(failure?.notices[0] ?? "", /Аналитик/);
});

test("action confirmation stays silent until Booking Core commits", () => {
  const fixture = createFixture({
    pendingActions: [
      {
        id: "action-1",
        previewEventId: "a".repeat(64),
        specialistRole: "administrator",
        status: "pending",
        bookingCoreCommitted: false,
      },
    ],
  });

  const confirmed = fixture.confirmAction?.("action-1");
  assert.equal(confirmed?.status, "confirmed");
  assert.deepEqual(confirmed?.messages, []);

  const committed = fixture.recordBookingCoreCommit?.("action-1");
  assert.equal(committed?.status, "committed");
  assert.equal(committed?.bookingCoreCommitted, true);
  assert.deepEqual(committed?.respondingRoles, ["administrator"]);
  assert.equal(committed?.messages.length, 1);
});
function sentenceCount(message) {
  return message
    .split(/[.!?]+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean).length;
}

function assertDialogueContract(turn) {
  assert.ok(turn.messages.length >= 1 && turn.messages.length <= 3);
  assert.ok(turn.messages.every((message) => sentenceCount(message) <= 3));
  assert.equal(new Set(turn.respondingRoles).size, 1);
  assert.equal(turn.hasHeading, false);
  assert.equal(turn.reasksKnownFact, false);
}

test("dialogue scenarios stay short, single-responder, and context-aware", () => {
  const scenarios = [
    {
      name: "long free-form answer",
      eventId: "event-long",
      humanMessage:
        "У нас два филиала, пять залов, восемь преподавателей и около ста двадцати детей. Работаем каждый день.",
      knownFactKeys: ["branches", "rooms", "teachers", "children"],
      requestedFactKeys: ["age_ranges"],
      messages: [
        { role: "fizz", content: "Понял общую структуру центра." },
        { role: "fizz", content: "С какими возрастами вы работаете?" },
      ],
    },
    {
      name: "multiple facts",
      eventId: "event-facts",
      humanMessage: "Оплаты ежемесячные, занятия дважды в неделю.",
      knownFactKeys: ["payment_cycle", "weekly_frequency"],
      requestedFactKeys: ["trial_policy"],
      messages: [
        {
          role: "fizz",
          content: "Зафиксировал ритм занятий и оплат. Есть пробные занятия?",
        },
      ],
    },
    {
      name: "counter-question",
      eventId: "event-question",
      humanMessage: "А зачем вам сейчас количество залов?",
      knownFactKeys: [],
      requestedFactKeys: [],
      messages: [
        {
          role: "fizz",
          content: "Чтобы корректно собрать расписание без пересечений.",
        },
      ],
    },
    {
      name: "Admin without an at-sign",
      eventId: "event-admin",
      humanMessage: "Админ, проверь расписание филиала Центр.",
      knownFactKeys: ["branch_centre"],
      requestedFactKeys: ["schedule"],
      messages: [
        {
          role: "administrator",
          content: "Проверяю расписание филиала Центр.",
        },
      ],
    },
    {
      name: "pause",
      eventId: "event-pause",
      humanMessage: "Давайте пока остановимся.",
      knownFactKeys: [],
      requestedFactKeys: [],
      messages: [
        {
          role: "fizz",
          content: "Хорошо. Продолжим, когда вам будет удобно.",
        },
      ],
    },
  ];

  const fixture = createFixture({
    routeTargetByEvent: { "event-admin": "administrator" },
  });
  for (const scenario of scenarios) {
    const turn = fixture.observeTurn?.(scenario);
    assert.ok(turn, scenario.name);
    assertDialogueContract(turn);
  }
});

test("a correction supersedes the old preview before confirmation", () => {
  const fixture = createFixture({
    pendingActions: [
      {
        id: "action-old",
        previewEventId: "a".repeat(64),
        specialistRole: "administrator",
        status: "pending",
        bookingCoreCommitted: false,
      },
    ],
  });
  const replacement = {
    id: "action-new",
    previewEventId: "b".repeat(64),
    specialistRole: "administrator",
    status: "pending",
    bookingCoreCommitted: false,
  };

  const replaced = fixture.replacePendingAction?.("action-old", replacement);
  assert.ok(replaced);
  assert.equal(
    fixture.snapshot().pendingActions.find(({ id }) => id === "action-old")
      ?.status,
    "superseded",
  );
  assert.equal(fixture.confirmAction("action-old"), null);
  assert.equal(fixture.confirmAction("action-new")?.status, "confirmed");
});

test("a direct language switch changes subsequent fixture turns", () => {
  const fixture = createFixture();

  fixture.setLocale?.("en-US");
  assert.equal(fixture.snapshot().locale, "en-US");
  const turn = fixture.observeTurn?.({
    eventId: "event-language",
    humanMessage: "Please continue in English.",
    knownFactKeys: [],
    requestedFactKeys: [],
    messages: [
      {
        role: "fizz",
        content: "Sure. We can continue in English.",
      },
    ],
  });
  assert.ok(turn);
  assertDialogueContract(turn);
});

test("an open question stays quiet without reminder events", () => {
  const fixture = createFixture();

  assert.deepEqual(fixture.idleMessages?.(), []);
  assert.deepEqual(fixture.reload().idleMessages?.(), []);
});
