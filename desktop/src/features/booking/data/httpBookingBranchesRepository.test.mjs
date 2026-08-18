import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { BookingRevisionConflictError } from "./bookingRepository.ts";
import {
  BookingBranchesApiError,
  HttpBookingBranchesRepository,
} from "./httpBookingBranchesRepository.ts";

const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BRANCH_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ROOM_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const GROUP_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const RULE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const EXCEPTION_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

function signedEvent(input) {
  return {
    id: "event-id",
    pubkey: "staff-pubkey",
    created_at: 1,
    kind: input.kind,
    tags: input.tags,
    content: input.content,
    sig: "signature",
  };
}

function organization() {
  return {
    id: ORGANIZATION_ID,
    name: "Каляка Маляка",
    locale: "ru-RU",
    timeZone: "Europe/Moscow",
    defaultTrialPolicy: { mode: "free" },
    trackAttendanceByDefault: true,
    allowSingleVisitsByDefault: false,
    existingStudentsOnboarding: { status: "not_started" },
    publicBooking: { purpose: "trial", appearance: "automatic" },
    paymentDayOfMonth: 5,
  };
}

function branch(overrides = {}) {
  return {
    id: BRANCH_ID,
    organizationId: ORGANIZATION_ID,
    name: "Курская",
    address: "Земляной Вал, 1",
    workingHours: {
      monday: [{ startTime: "09:00", endTime: "18:00" }],
      tuesday: [],
      wednesday: [],
      thursday: [],
      friday: [],
      saturday: [],
      sunday: [],
    },
    defaultBuzzChannelId: null,
    status: "active",
    version: 1,
    ...overrides,
  };
}

function room(overrides = {}) {
  return {
    id: ROOM_ID,
    organizationId: ORGANIZATION_ID,
    branchId: BRANCH_ID,
    name: "Большой зал",
    status: "active",
    version: 1,
    ...overrides,
  };
}

function group(overrides = {}) {
  return {
    id: GROUP_ID,
    organizationId: ORGANIZATION_ID,
    branchId: BRANCH_ID,
    roomId: ROOM_ID,
    name: "Воздушные полотна 7–9",
    teacherIds: [],
    minAgeMonths: 84,
    maxAgeMonths: 119,
    capacity: 10,
    activeEnrollmentCount: 0,
    status: "active",
    version: 1,
    ...overrides,
  };
}

function rule(overrides = {}) {
  return {
    id: RULE_ID,
    organizationId: ORGANIZATION_ID,
    groupId: GROUP_ID,
    startsOn: "2026-08-17",
    endsOn: "2026-11-17",
    weekdays: ["monday"],
    startTime: "17:00",
    endTime: "18:00",
    status: "active",
    version: 1,
    ...overrides,
  };
}

function lessonException(overrides = {}) {
  return {
    id: EXCEPTION_ID,
    organizationId: ORGANIZATION_ID,
    recurrenceRuleId: RULE_ID,
    originalDate: "2026-08-17",
    original: {
      startTime: "17:00",
      endTime: "18:00",
      branchId: BRANCH_ID,
      roomId: ROOM_ID,
      teacherIds: [],
    },
    kind: "override",
    override: { endTime: "18:30" },
    version: 1,
    updatedAt: "2026-08-10T10:00:00Z",
    ...overrides,
  };
}

function directory(
  items = [],
  organizationVersion = 3,
  rooms = [],
  groups = [],
  recurrenceRules = [],
  lessonExceptions = [],
) {
  return {
    organization: organization(),
    organizationVersion,
    items,
    rooms,
    groups,
    recurrenceRules,
    lessonExceptions,
  };
}

function mutation(version = 1) {
  return { branchId: BRANCH_ID, version, replayed: false };
}

function roomMutation(version = 1) {
  return { roomId: ROOM_ID, version, replayed: false };
}

function groupMutation(version = 1) {
  return { groupId: GROUP_ID, version, replayed: false };
}

function lessonMutation(version = 1, exceptionId = EXCEPTION_ID) {
  return {
    recurrenceRuleId: RULE_ID,
    originalDate: "2026-08-17",
    exceptionId,
    version,
    action: exceptionId ? "override" : "restore",
    cancelledBookingCount: 0,
    replayed: false,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function draftFrom(workspace, branches) {
  const { revision: _revision, ...draft } = workspace;
  return { ...draft, branches };
}

function draftWithRooms(workspace, rooms) {
  const { revision: _revision, ...draft } = workspace;
  return { ...draft, rooms };
}

function draftWithGroups(workspace, groups, recurrenceRules) {
  const { revision: _revision, ...draft } = workspace;
  return { ...draft, groups, recurrenceRules };
}

function draftWithExceptions(workspace, lessonExceptions) {
  const { revision: _revision, ...draft } = workspace;
  return { ...draft, lessonExceptions };
}

test("branches repository creates a server-owned branch and reloads it", async () => {
  const requests = [];
  const signedInputs = [];
  let getCount = 0;
  const repository = new HttpBookingBranchesRepository({
    relayHttpUrl: async () => "https://center.example/",
    idempotencyKeyFactory: () => "branch-command-1234567890",
    nonceFactory: () => `nonce-${requests.length}`,
    signEvent: async (input) => {
      signedInputs.push(input);
      return signedEvent(input);
    },
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      if (init.method === "GET") {
        getCount += 1;
        return jsonResponse(
          getCount === 1 ? directory() : directory([branch()]),
        );
      }
      return jsonResponse(mutation());
    },
  });

  const current = await repository.load();
  const temporary = {
    ...branch(),
    id: "branch-temporary",
    defaultBuzzChannelId: undefined,
    version: undefined,
  };
  delete temporary.version;
  const saved = await repository.save(
    draftFrom(current, [temporary]),
    current.revision,
  );

  assert.equal(saved.branches[0].id, BRANCH_ID);
  assert.equal(saved.revision, 4);
  const post = requests[1];
  const body = JSON.parse(post.init.body);
  assert.equal(post.url, "https://center.example/api/airhop/staff/v1/branches");
  assert.equal(post.init.method, "POST");
  assert.equal(
    post.init.headers["Idempotency-Key"],
    "branch-command-1234567890",
  );
  assert.equal(body.name, "Курская");
  assert.equal(body.id, undefined);
  assert.deepEqual(body.workingHours.monday, [
    { startTime: "09:00", endTime: "18:00" },
  ]);
  const payloadTag = signedInputs[1].tags.find(([name]) => name === "payload");
  assert.equal(
    payloadTag[1],
    createHash("sha256").update(post.init.body).digest("hex"),
  );
});

test("branches repository sends row version for update and archive", async () => {
  const requests = [];
  let getCount = 0;
  const repository = new HttpBookingBranchesRepository({
    relayHttpUrl: async () => "https://center.example",
    nonceFactory: () => "nonce",
    signEvent: async (input) => signedEvent(input),
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      if (init.method === "GET") {
        getCount += 1;
        return jsonResponse(
          directory([
            branch(
              getCount === 1
                ? { version: 2 }
                : { version: 3, status: "archived" },
            ),
          ]),
        );
      }
      return jsonResponse(mutation(3));
    },
  });

  const current = await repository.load();
  const archived = { ...current.branches[0], status: "archived" };
  const saved = await repository.save(
    draftFrom(current, [archived]),
    current.revision,
  );

  const put = requests[1];
  assert.equal(
    put.url,
    `https://center.example/api/airhop/staff/v1/branches/${BRANCH_ID}`,
  );
  assert.equal(put.init.method, "PUT");
  assert.equal(JSON.parse(put.init.body).expectedVersion, 2);
  assert.equal(JSON.parse(put.init.body).status, "archived");
  assert.equal(saved.branches[0].status, "archived");
});

test("branches repository creates a server-owned room and reloads it", async () => {
  const requests = [];
  let getCount = 0;
  const repository = new HttpBookingBranchesRepository({
    relayHttpUrl: async () => "https://center.example",
    idempotencyKeyFactory: () => "room-command-1234567890",
    nonceFactory: () => "nonce",
    signEvent: async (input) => signedEvent(input),
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      if (init.method === "GET") {
        getCount += 1;
        return jsonResponse(
          directory([branch()], 3, getCount === 1 ? [] : [room()]),
        );
      }
      return jsonResponse(roomMutation());
    },
  });
  const current = await repository.load();
  const temporary = {
    ...room(),
    id: "room-temporary",
  };
  delete temporary.version;

  const saved = await repository.save(
    draftWithRooms(current, [temporary]),
    current.revision,
  );

  assert.equal(saved.rooms[0].id, ROOM_ID);
  assert.equal(saved.revision, 5);
  const post = requests[1];
  assert.equal(
    post.url,
    `https://center.example/api/airhop/staff/v1/branches/${BRANCH_ID}/rooms`,
  );
  assert.equal(post.init.method, "POST");
  assert.equal(post.init.headers["Idempotency-Key"], "room-command-1234567890");
  assert.deepEqual(JSON.parse(post.init.body), { name: "Большой зал" });
});

test("branches repository sends room row version for update and archive", async () => {
  const requests = [];
  let getCount = 0;
  const repository = new HttpBookingBranchesRepository({
    relayHttpUrl: async () => "https://center.example",
    nonceFactory: () => "nonce",
    signEvent: async (input) => signedEvent(input),
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      if (init.method === "GET") {
        getCount += 1;
        return jsonResponse(
          directory([branch()], 3, [
            room(
              getCount === 1
                ? { version: 2 }
                : { version: 3, status: "archived" },
            ),
          ]),
        );
      }
      return jsonResponse(roomMutation(3));
    },
  });
  const current = await repository.load();
  const archived = { ...current.rooms[0], status: "archived" };

  const saved = await repository.save(
    draftWithRooms(current, [archived]),
    current.revision,
  );

  const put = requests[1];
  assert.equal(
    put.url,
    `https://center.example/api/airhop/staff/v1/branches/${BRANCH_ID}/rooms/${ROOM_ID}`,
  );
  assert.equal(put.init.method, "PUT");
  assert.deepEqual(JSON.parse(put.init.body), {
    expectedVersion: 2,
    name: "Большой зал",
    status: "archived",
  });
  assert.equal(saved.rooms[0].status, "archived");
});

test("branches repository creates a group and its schedule atomically", async () => {
  const requests = [];
  let getCount = 0;
  const repository = new HttpBookingBranchesRepository({
    relayHttpUrl: async () => "https://center.example",
    idempotencyKeyFactory: () => "group-command-1234567890",
    nonceFactory: () => "nonce",
    signEvent: async (input) => signedEvent(input),
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      if (init.method === "GET") {
        getCount += 1;
        return jsonResponse(
          directory(
            [branch()],
            3,
            [room()],
            getCount === 1 ? [] : [group()],
            getCount === 1 ? [] : [rule()],
          ),
        );
      }
      return jsonResponse(groupMutation());
    },
  });
  const current = await repository.load();
  const temporaryGroup = {
    ...group(),
    id: "group-temporary",
  };
  delete temporaryGroup.version;
  const temporaryRule = {
    ...rule(),
    id: "rule-temporary",
    groupId: temporaryGroup.id,
  };
  delete temporaryRule.version;

  const saved = await repository.save(
    draftWithGroups(current, [temporaryGroup], [temporaryRule]),
    current.revision,
  );

  assert.equal(saved.groups[0].id, GROUP_ID);
  assert.equal(saved.recurrenceRules[0].id, RULE_ID);
  const post = requests[1];
  assert.equal(post.url, "https://center.example/api/airhop/staff/v1/groups");
  assert.equal(post.init.method, "POST");
  const body = JSON.parse(post.init.body);
  assert.equal(body.group.name, "Воздушные полотна 7–9");
  assert.equal(body.activeRules.length, 1);
  assert.equal(body.activeRules[0].id, undefined);
  assert.deepEqual(body.activeRules[0].weekdays, ["monday"]);
});

test("branches repository sends one aggregate version for a group schedule update", async () => {
  const requests = [];
  let getCount = 0;
  const repository = new HttpBookingBranchesRepository({
    relayHttpUrl: async () => "https://center.example",
    nonceFactory: () => "nonce",
    signEvent: async (input) => signedEvent(input),
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      if (init.method === "GET") {
        getCount += 1;
        return jsonResponse(
          directory(
            [branch()],
            3,
            [room()],
            [group({ version: getCount === 1 ? 4 : 5 })],
            [
              rule({
                version: getCount === 1 ? 2 : 3,
                endTime: getCount === 1 ? "18:00" : "18:30",
              }),
            ],
          ),
        );
      }
      return jsonResponse(groupMutation(5));
    },
  });
  const current = await repository.load();
  const updatedRule = { ...current.recurrenceRules[0], endTime: "18:30" };

  await repository.save(
    draftWithGroups(current, current.groups, [updatedRule]),
    current.revision,
  );

  const put = requests[1];
  assert.equal(
    put.url,
    `https://center.example/api/airhop/staff/v1/groups/${GROUP_ID}`,
  );
  const body = JSON.parse(put.init.body);
  assert.equal(body.expectedVersion, 4);
  assert.equal(body.activeRules[0].id, RULE_ID);
  assert.equal(body.activeRules[0].endTime, "18:30");
});

test("schedule repository creates one server-owned lesson override", async () => {
  const requests = [];
  let getCount = 0;
  const repository = new HttpBookingBranchesRepository({
    relayHttpUrl: async () => "https://center.example",
    idempotencyKeyFactory: () => "lesson-command-1234567890",
    nonceFactory: () => "nonce",
    signEvent: async (input) => signedEvent(input),
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      if (init.method === "GET") {
        getCount += 1;
        return jsonResponse(
          directory(
            [branch()],
            3,
            [room()],
            [group()],
            [rule()],
            getCount === 1 ? [] : [lessonException()],
          ),
        );
      }
      return jsonResponse(lessonMutation());
    },
  });
  const current = await repository.load();
  const temporary = {
    ...lessonException(),
    id: "exception-temporary",
  };
  delete temporary.version;
  delete temporary.updatedAt;

  const saved = await repository.save(
    draftWithExceptions(current, [temporary]),
    current.revision,
  );

  assert.equal(saved.lessonExceptions[0].id, EXCEPTION_ID);
  const put = requests[1];
  assert.equal(
    put.url,
    `https://center.example/api/airhop/staff/v1/lesson-exceptions/${RULE_ID}/2026-08-17`,
  );
  assert.equal(put.init.method, "PUT");
  assert.equal(
    put.init.headers["Idempotency-Key"],
    "lesson-command-1234567890",
  );
  assert.deepEqual(JSON.parse(put.init.body), {
    action: "override",
    expectedVersion: 0,
    override: {
      endTime: "18:30",
      roomOverrideSet: false,
      capacityOverrideSet: false,
    },
  });
});

test("schedule repository cancels and restores with the server exception version", async () => {
  const requests = [];
  let state = "override";
  const repository = new HttpBookingBranchesRepository({
    relayHttpUrl: async () => "https://center.example",
    nonceFactory: () => "nonce",
    signEvent: async (input) => signedEvent(input),
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      if (init.method === "GET") {
        const exceptions =
          state === "restored"
            ? []
            : [
                state === "override"
                  ? lessonException({ version: 2 })
                  : lessonException({
                      kind: "cancelled",
                      override: undefined,
                      version: 3,
                    }),
              ];
        return jsonResponse(
          directory([branch()], 3, [room()], [group()], [rule()], exceptions),
        );
      }
      const action = JSON.parse(init.body).action;
      state = action === "restore" ? "restored" : "cancelled";
      return jsonResponse(
        action === "restore"
          ? lessonMutation(4, null)
          : { ...lessonMutation(3), action: "cancel" },
      );
    },
  });
  const current = await repository.load();
  const cancelled = {
    id: EXCEPTION_ID,
    organizationId: ORGANIZATION_ID,
    recurrenceRuleId: RULE_ID,
    originalDate: "2026-08-17",
    original: current.lessonExceptions[0].original,
    kind: "cancelled",
  };
  const afterCancel = await repository.save(
    draftWithExceptions(current, [cancelled]),
    current.revision,
  );
  assert.equal(JSON.parse(requests[1].init.body).expectedVersion, 2);
  assert.equal(JSON.parse(requests[1].init.body).action, "cancel");
  assert.equal(afterCancel.lessonExceptions[0].kind, "cancelled");

  const afterRestore = await repository.save(
    draftWithExceptions(afterCancel, []),
    afterCancel.revision,
  );
  assert.equal(JSON.parse(requests[3].init.body).expectedVersion, 3);
  assert.equal(JSON.parse(requests[3].init.body).action, "restore");
  assert.equal(afterRestore.lessonExceptions.length, 0);
});

test("branches repository reloads a stale server version as a conflict", async () => {
  let call = 0;
  const repository = new HttpBookingBranchesRepository({
    relayHttpUrl: async () => "https://center.example",
    nonceFactory: () => "nonce",
    signEvent: async (input) => signedEvent(input),
    fetch: async (_url, init) => {
      call += 1;
      if (init.method === "PUT") {
        return jsonResponse({ error: "reload before saving" }, 409);
      }
      return jsonResponse(
        directory([branch({ version: call === 1 ? 1 : 2 })], 1),
      );
    },
  });
  const current = await repository.load();
  const renamed = { ...current.branches[0], name: "Новая Курская" };

  await assert.rejects(
    repository.save(draftFrom(current, [renamed]), current.revision),
    (error) =>
      error instanceof BookingRevisionConflictError &&
      error.expectedRevision === 2 &&
      error.actualRevision === 3,
  );
});

test("branches repository rejects malformed successful responses", async () => {
  const repository = new HttpBookingBranchesRepository({
    relayHttpUrl: async () => "https://center.example",
    nonceFactory: () => "nonce",
    signEvent: async (input) => signedEvent(input),
    fetch: async () => jsonResponse({ ok: true }),
  });

  await assert.rejects(
    repository.load(),
    (error) => error instanceof BookingBranchesApiError && error.status === 502,
  );
});
