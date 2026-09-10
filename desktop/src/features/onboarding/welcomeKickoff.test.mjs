import assert from "node:assert/strict";
import test from "node:test";

import { createMockWelcomeAgentTeamFixture } from "../../testing/e2eBridge.ts";
import {
  ALL_WELCOME_KICKOFF_STAGES,
  buildKickoffTask,
  buildWelcomeKickoffSnapshot,
  buildWelcomeProviderFallback,
  nextKickoffStages,
  shouldDispatchKickoff,
  welcomeKickoffTargetRole,
  welcomeRuntimeIsReady,
  hasWelcomeGuestIntroduction,
} from "./welcomeKickoff.ts";

const OWNER = "0".repeat(64);
const FIZZ = "1".repeat(64);
const ADMIN = "2".repeat(64);
const ANALYST = "3".repeat(64);
const CONTENT = "4".repeat(64);
const CHANNEL = "11111111-1111-4111-8111-111111111111";

test("Hermes introduction requires the registered guest, never the internal Administrator", () => {
  const guest = "5".repeat(64);
  const introduction = {
    ...event(guest, "hermes_guest_intro"),
    tags: [
      ["h", CHANNEL],
      ["airhop-kickoff-stage", "hermes_guest_intro"],
      ["airhop-guest-invitation", "a".repeat(64)],
    ],
  };
  assert.equal(hasWelcomeGuestIntroduction([introduction], guest), true);
  assert.equal(hasWelcomeGuestIntroduction([introduction], undefined), false);
  assert.equal(
    hasWelcomeGuestIntroduction([{ ...introduction, pubkey: ADMIN }], guest),
    false,
  );
  assert.equal(
    hasWelcomeGuestIntroduction(
      [
        {
          ...introduction,
          tags: [...introduction.tags, ["e", "b".repeat(64)]],
        },
      ],
      guest,
    ),
    false,
  );
});

const agents = {
  fizz: { pubkey: FIZZ },
  administrator: { pubkey: ADMIN },
  analyst: { pubkey: ANALYST },
  content_marketer: { pubkey: CONTENT },
};

function event(pubkey, stage) {
  return {
    id: stage.padEnd(64, "0"),
    pubkey,
    kind: 9,
    content: "model output",
    tags: [
      ["h", CHANNEL],
      ["airhop-kickoff-stage", stage],
    ],
    created_at: 1,
    sig: "f".repeat(128),
  };
}

test("semantic kickoff advances exactly one durable stage at a time", () => {
  assert.deepEqual(nextKickoffStages([]), ["fizz_intro"]);
  assert.deepEqual(nextKickoffStages(["fizz_intro"]), ["administrator_intro"]);
  assert.deepEqual(
    nextKickoffStages(["fizz_intro", "fizz_invite_administrator"]),
    ["administrator_intro"],
  );
  assert.deepEqual(nextKickoffStages(ALL_WELCOME_KICKOFF_STAGES), []);
  assert.deepEqual(
    nextKickoffStages([
      "fizz_intro",
      "administrator_intro",
      "analyst_intro",
      "content_marketer_intro",
    ]),
    ["fizz_first_question"],
  );
});

test("cold Welcome waits for history before treating an empty view as new", () => {
  const empty = buildWelcomeKickoffSnapshot([], OWNER, agents, null);
  assert.equal(shouldDispatchKickoff({ ...empty, historyReady: false }), false);
  assert.equal(shouldDispatchKickoff({ ...empty, historyReady: true }), true);
  const complete = buildWelcomeKickoffSnapshot(
    ALL_WELCOME_KICKOFF_STAGES.map((stage) =>
      event(agents[welcomeKickoffTargetRole(stage)].pubkey, stage),
    ),
    OWNER,
    agents,
    null,
  );
  assert.equal(
    shouldDispatchKickoff({ ...complete, historyReady: true }),
    false,
  );
});

test("stage target roles cover Fizz and all three specialists", () => {
  assert.equal(welcomeKickoffTargetRole("fizz_intro"), "fizz");
  assert.equal(welcomeKickoffTargetRole("fizz_invite_administrator"), "fizz");
  assert.equal(
    welcomeKickoffTargetRole("administrator_intro"),
    "administrator",
  );
  assert.equal(welcomeKickoffTargetRole("analyst_intro"), "analyst");
  assert.equal(welcomeKickoffTargetRole("fizz_explain_team"), "fizz");
  assert.equal(
    welcomeKickoffTargetRole("content_marketer_intro"),
    "content_marketer",
  );
  assert.equal(welcomeKickoffTargetRole("fizz_first_question"), "fizz");
});

test("durable receipts count only when authored by the stage role", () => {
  const snapshot = buildWelcomeKickoffSnapshot(
    [
      event(FIZZ, "fizz_intro"),
      event(FIZZ, "administrator_intro"),
      event(ADMIN, "administrator_intro"),
    ],
    OWNER,
    agents,
    null,
  );

  assert.deepEqual(
    [...snapshot.observedStages],
    ["fizz_intro", "administrator_intro"],
  );
  assert.equal(snapshot.ownerHasSpoken, false);
  assert.equal(snapshot.inFlightStage, null);
});

test("an owner message does not permanently stop unfinished introductions", () => {
  const snapshot = buildWelcomeKickoffSnapshot(
    [
      event(FIZZ, "fizz_intro"),
      {
        ...event(OWNER, "ignored"),
        tags: [["h", CHANNEL]],
        content: "We have two branches.",
      },
    ],
    OWNER,
    agents,
    null,
  );

  assert.equal(snapshot.ownerHasSpoken, true);
  assert.equal(shouldDispatchKickoff(snapshot), false);
  const ownerMessage = {
    ...event(OWNER, "question"),
    tags: [["h", CHANNEL]],
  };
  const answer = {
    ...event(FIZZ, "answer"),
    tags: [
      ["h", CHANNEL],
      ["airhop-responds-to", ownerMessage.id],
    ],
  };
  for (const responder of [OWNER, ANALYST, FIZZ]) {
    const resumed = buildWelcomeKickoffSnapshot(
      [
        event(FIZZ, "fizz_intro"),
        ownerMessage,
        { ...answer, pubkey: responder },
      ],
      OWNER,
      agents,
      null,
    );
    assert.equal(shouldDispatchKickoff(resumed), responder !== OWNER);
  }
});

test("in-flight work and an unready target block duplicate dispatch", () => {
  assert.equal(
    shouldDispatchKickoff({
      observedStages: new Set(),
      ownerHasSpoken: false,
      inFlightStage: "fizz_intro",
    }),
    false,
  );
  assert.equal(
    shouldDispatchKickoff({
      observedStages: new Set(),
      ownerHasSpoken: false,
      inFlightStage: null,
      targetRuntimeReady: false,
    }),
    false,
  );
});

test("kickoff tasks are deterministic, localized, model-driven, and flat", () => {
  const task = buildKickoffTask("administrator_intro", "ru-RU", {
    channelId: CHANNEL,
    ownerName: "Андрей",
    organization: {
      name: "Airhop Kids",
      timeZone: "Europe/Moscow",
    },
  });

  assert.equal(task.targetRole, "administrator");
  assert.equal(task.taskId, `airhop-welcome:${CHANNEL}:administrator_intro`);
  assert.equal(task.parentEventId, null);
  assert.match(task.instruction, /ru/);
  assert.match(task.instruction, /Андрей/);
  assert.match(task.instruction, /Airhop Kids/);
  assert.match(task.instruction, /top-level/i);
  assert.match(task.instruction, /exactly one short message/i);
  assert.match(task.instruction, /expects_reply=false/);
  assert.match(task.instruction, /airhop-kickoff-stage/);
});

test("provider fallback is localized Fizz output but no semantic receipt", () => {
  const fallback = buildWelcomeProviderFallback("pt-BR");

  assert.equal(fallback.targetRole, "fizz");
  assert.equal(fallback.parentEventId, null);
  assert.equal(fallback.kickoffStage, null);
  assert.match(fallback.message, /provedor de IA/i);
});

test("first setup question requires fresh facts and confirmed changes", () => {
  const task = buildKickoffTask("fizz_first_question", "ru", {
    channelId: CHANNEL,
  });
  assert.match(task.instruction, /airhop_read/);
  assert.match(task.instruction, /unknown, not empty/);
  assert.match(
    task.instruction,
    /branches, teachers, groups\/schedule, tariffs, knowledge, Telegram/,
  );
  assert.match(task.instruction, /explicit confirmation/);
  assert.match(task.instruction, /offering to skip/);
  assert.match(task.instruction, /Добавим преподавателей/);
});

test("runtime readiness is scoped to the exact agent and relay", () => {
  const runtimes = [
    {
      pubkey: FIZZ,
      relayUrl: "ws://127.0.0.1:3000",
      lifecycle: "ready",
    },
  ];
  assert.equal(
    welcomeRuntimeIsReady(runtimes, FIZZ, "ws://localhost:3000"),
    true,
  );
  assert.equal(
    welcomeRuntimeIsReady(runtimes, ADMIN, "ws://localhost:3000"),
    false,
  );
  assert.equal(
    welcomeRuntimeIsReady(runtimes, FIZZ, "ws://localhost:3001"),
    false,
  );
});

test("mock reload resumes after durable kickoff receipts without duplication", () => {
  const fixture = createMockWelcomeAgentTeamFixture({
    locale: "ru-RU",
    routeTargetByEvent: {},
    unavailableRoles: [],
    completedKickoffStages: ["fizz_intro"],
    pendingActions: [],
  });

  assert.equal(fixture.nextKickoffStage?.(), "fizz_invite_administrator");
  fixture.completeKickoffStage?.("fizz_invite_administrator");

  const reloaded = fixture.reload?.();
  assert.ok(reloaded);
  assert.equal(reloaded.nextKickoffStage?.(), "administrator_intro");
  assert.deepEqual(reloaded.snapshot().completedKickoffStages, [
    "fizz_intro",
    "fizz_invite_administrator",
  ]);
});
