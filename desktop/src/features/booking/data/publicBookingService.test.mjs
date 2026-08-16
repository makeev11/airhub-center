import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryBookingRepository } from "./bookingRepository.ts";
import {
  PublicBookingAgeMismatchError,
  PublicBookingTransitionError,
  PublicBookingUnavailableError,
  PublicBookingValidationError,
  WorkspacePublicBookingService,
} from "./publicBookingService.ts";
import {
  DEMO_BOOKING_WORKSPACE,
  getWorkspaceWeek,
} from "../model/demoSchedule.ts";
import { upsertBookingGroup } from "../model/bookingMutations.ts";

const NOW = new Date("2026-08-04T09:00:00.000Z");

function applicant(overrides = {}) {
  return {
    parentName: "Мария Соколова",
    phone: "+7 999 123-45-67",
    childName: "Лев",
    childBirthDate: "2020-08-10",
    consentAccepted: true,
    ...overrides,
  };
}

function createService(repository, suffix = "one") {
  return new WorkspacePublicBookingService(repository, {
    clock: () => new Date(NOW),
    idFactory: () => suffix,
    tokenFactory: () => suffix.padEnd(43, "T").slice(0, 43),
  });
}

async function limitedOccurrence(service) {
  const occurrence = (
    await service.findOccurrences({ groupId: "public-limited" })
  ).find((candidate) => candidate.lessonRef.originalDate === "2026-08-10");
  assert.ok(occurrence);
  return occurrence;
}

function command(lessonRef, overrides = {}) {
  return {
    lessonRef,
    applicant: applicant(),
    idempotencyKey: "public-booking-command-0001",
    source: { surface: "standalone" },
    ...overrides,
  };
}

test("public booking create is idempotent and persists only credential digests", async () => {
  const repository = new InMemoryBookingRepository(DEMO_BOOKING_WORKSPACE);
  const service = createService(repository);
  const occurrence = await limitedOccurrence(service);

  const attributedCommand = command(occurrence.lessonRef, {
    source: {
      surface: "standalone",
      attributionBranchId: "kurskaya",
    },
  });
  const first = await service.createBooking(attributedCommand);
  const replay = await service.createBooking(attributedCommand);
  const workspace = await repository.load();

  assert.equal(workspace.bookings.length, 1);
  assert.equal(workspace.families.length, 1);
  assert.equal(workspace.representatives.length, 1);
  assert.equal(workspace.children.length, 1);
  assert.equal(workspace.bookings[0].familyId, workspace.families[0].id);
  assert.equal(
    workspace.bookings[0].representativeId,
    workspace.representatives[0].id,
  );
  assert.equal(workspace.bookings[0].childId, workspace.children[0].id);
  assert.equal(
    workspace.bookings[0].applicant.phoneDisplay,
    "+7 999 123-45-67",
  );
  assert.equal(first.managementToken, replay.managementToken);
  assert.equal(first.card.status, "pending_confirmation");
  assert.equal(first.card.maskedPhone, "+79 ••• ••• 45 67");
  assert.match(first.managementToken, /^[A-Za-z0-9_-]{43}$/);
  assert.match(workspace.bookings[0].managementTokenDigest, /^[a-f0-9]{64}$/);
  assert.match(workspace.bookings[0].idempotencyKeyDigest, /^[a-f0-9]{64}$/);
  assert.equal(
    JSON.stringify(workspace).includes(first.managementToken),
    false,
  );
  assert.deepEqual(workspace.bookings[0].lessonRef, occurrence.lessonRef);
  assert.equal(workspace.bookings[0].source.attributionBranchId, "kurskaya");
});

test("archiving a recurrence rule keeps an existing management card readable", async () => {
  const repository = new InMemoryBookingRepository(DEMO_BOOKING_WORKSPACE);
  const service = createService(repository, "archive");
  const occurrence = await limitedOccurrence(service);
  const created = await service.createBooking(command(occurrence.lessonRef));
  const workspace = await repository.load();
  const group = workspace.groups.find(
    (candidate) => candidate.id === "public-limited",
  );
  assert.ok(group);
  await repository.save(
    upsertBookingGroup(workspace, { group, activeRules: [] }),
    workspace.revision,
  );

  const card = await service.getManagementCard(created.managementToken);
  assert.equal(card?.groupName, "Открытая лаборатория");
  assert.equal(card?.date, "2026-08-10");
});

test("management lookup is neutral and parent cancellation is idempotent", async () => {
  const repository = new InMemoryBookingRepository(DEMO_BOOKING_WORKSPACE);
  const service = createService(repository, "cancel");
  const occurrence = await limitedOccurrence(service);
  const created = await service.createBooking(command(occurrence.lessonRef));

  assert.equal(await service.getManagementCard("invalid"), null);
  assert.equal(await service.getManagementCard("Z".repeat(43)), null);

  const cancelled = await service.cancelByParent(created.managementToken);
  const replay = await service.cancelByParent(created.managementToken);
  assert.equal(cancelled.status, "cancelled_by_parent");
  assert.equal(replay.status, "cancelled_by_parent");
  assert.equal(replay.canCancel, false);

  const reopened = await service.findOccurrences({ groupId: "public-limited" });
  assert.ok(
    reopened.some(
      (candidate) =>
        candidate.lessonRef.originalDate === occurrence.lessonRef.originalDate,
    ),
  );
});

test("a transfer request is idempotent and does not move or free the seat", async () => {
  const repository = new InMemoryBookingRepository(DEMO_BOOKING_WORKSPACE);
  const service = createService(repository, "transfer");
  const occurrence = await limitedOccurrence(service);
  const created = await service.createBooking(
    command(occurrence.lessonRef, {
      idempotencyKey: "public-booking-transfer-0001",
    }),
  );

  const requested = await service.requestTransfer(
    created.managementToken,
    "Нужен вечер",
  );
  const replay = await service.requestTransfer(
    created.managementToken,
    "Другая заметка",
  );
  const workspace = await repository.load();

  assert.equal(requested.transferRequest.status, "pending");
  assert.equal(requested.transferRequest.comment, "Нужен вечер");
  assert.deepEqual(replay.transferRequest, requested.transferRequest);
  assert.deepEqual(workspace.bookings[0].lessonRef, occurrence.lessonRef);
  const heldOccurrence = (
    await service.findOccurrences({ groupId: "public-limited" })
  ).find(
    (candidate) =>
      candidate.lessonRef.originalDate === occurrence.lessonRef.originalDate,
  );
  assert.equal(heldOccurrence?.available, false);
  assert.equal(heldOccurrence?.remaining, 0);

  const changed = await service.setPreferredContactChannel(
    created.managementToken,
    "telegram",
  );
  assert.equal(changed.preferredContactChannel, "telegram");

  const cancelled = await service.cancelByParent(created.managementToken);
  assert.equal(cancelled.transferRequest, null);
  assert.equal(cancelled.status, "cancelled_by_parent");
});

test("public and admin occupancy use the same persisted stable occurrence", async () => {
  const repository = new InMemoryBookingRepository(DEMO_BOOKING_WORKSPACE);
  const service = createService(repository, "occupancy");
  const occurrence = await limitedOccurrence(service);
  const created = await service.createBooking(
    command(occurrence.lessonRef, {
      idempotencyKey: "public-booking-occupancy-0001",
    }),
  );

  const held = (
    await service.findOccurrences({ groupId: "public-limited" })
  ).find(
    (candidate) =>
      candidate.lessonRef.originalDate === occurrence.lessonRef.originalDate,
  );
  assert.equal(held?.remaining, 0);
  assert.equal(held?.available, false);

  const occupiedWorkspace = await repository.load();
  const bookedLesson = getWorkspaceWeek(
    occupiedWorkspace,
    1,
    "2026-08-04",
  ).lessons.find(
    (lesson) =>
      lesson.recurrenceRuleId === "public-limited-weekly" &&
      lesson.originalDate === "2026-08-10",
  );
  const neighborLesson = getWorkspaceWeek(
    occupiedWorkspace,
    2,
    "2026-08-04",
  ).lessons.find(
    (lesson) =>
      lesson.recurrenceRuleId === "public-limited-weekly" &&
      lesson.originalDate === "2026-08-17",
  );
  assert.equal(bookedLesson?.booked, 1);
  assert.equal(neighborLesson?.booked, 0);

  await service.cancelByParent(created.managementToken);
  const reopened = (
    await service.findOccurrences({ groupId: "public-limited" })
  ).find(
    (candidate) =>
      candidate.lessonRef.originalDate === occurrence.lessonRef.originalDate,
  );
  assert.equal(reopened?.remaining, 1);
  assert.equal(reopened?.available, true);
  const reopenedWorkspace = await repository.load();
  assert.equal(
    getWorkspaceWeek(reopenedWorkspace, 1, "2026-08-04").lessons.find(
      (lesson) =>
        lesson.recurrenceRuleId === "public-limited-weekly" &&
        lesson.originalDate === "2026-08-10",
    )?.booked,
    0,
  );
});

test("the final capacity place is won atomically across service instances", async () => {
  const repository = new InMemoryBookingRepository(DEMO_BOOKING_WORKSPACE);
  const first = createService(repository, "first");
  const second = createService(repository, "second");
  const occurrence = await limitedOccurrence(first);

  const results = await Promise.allSettled([
    first.createBooking(
      command(occurrence.lessonRef, {
        idempotencyKey: "public-booking-concurrent-first",
      }),
    ),
    second.createBooking(
      command(occurrence.lessonRef, {
        idempotencyKey: "public-booking-concurrent-second",
      }),
    ),
  ]);

  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  const rejected = results.find((result) => result.status === "rejected");
  assert.ok(rejected);
  assert.ok(rejected.reason instanceof PublicBookingUnavailableError);
  assert.equal((await repository.load()).bookings.length, 1);
});

test("create revalidates exact age, phone and consent", async () => {
  const repository = new InMemoryBookingRepository(DEMO_BOOKING_WORKSPACE);
  const service = createService(repository, "validate");
  const occurrence = await limitedOccurrence(service);

  await assert.rejects(
    service.createBooking(
      command(occurrence.lessonRef, {
        applicant: applicant({ childBirthDate: "2010-08-10" }),
        idempotencyKey: "public-booking-age-mismatch",
      }),
    ),
    PublicBookingAgeMismatchError,
  );
  await assert.rejects(
    service.createBooking(
      command(occurrence.lessonRef, {
        applicant: applicant({ phone: "123" }),
        idempotencyKey: "public-booking-phone-invalid",
      }),
    ),
    PublicBookingValidationError,
  );
  await assert.rejects(
    service.createBooking(
      command(occurrence.lessonRef, {
        applicant: applicant({ consentAccepted: false }),
        idempotencyKey: "public-booking-no-consent",
      }),
    ),
    PublicBookingValidationError,
  );
  await assert.rejects(
    service.createBooking(
      command(occurrence.lessonRef, {
        applicant: applicant({ childBirthDate: "2026-08-05" }),
        idempotencyKey: "public-booking-future-birth-date",
      }),
    ),
    (error) => {
      assert.ok(error instanceof PublicBookingValidationError);
      assert.deepEqual(error.issues, ["birth_date_in_future"]);
      return true;
    },
  );
});

test("catalog current date follows the organization timezone at midnight", async () => {
  const repository = new InMemoryBookingRepository(DEMO_BOOKING_WORKSPACE);
  const service = new WorkspacePublicBookingService(repository, {
    clock: () => new Date("2026-08-03T21:30:00.000Z"),
  });
  assert.equal(
    (await service.getCatalog()).organization.currentDate,
    "2026-08-04",
  );
});

test("cancelled bookings cannot request a transfer", async () => {
  const repository = new InMemoryBookingRepository(DEMO_BOOKING_WORKSPACE);
  const service = createService(repository, "terminal");
  const occurrence = await limitedOccurrence(service);
  const created = await service.createBooking(
    command(occurrence.lessonRef, {
      idempotencyKey: "public-booking-terminal-0001",
    }),
  );
  await service.cancelByParent(created.managementToken);

  await assert.rejects(
    service.requestTransfer(created.managementToken),
    PublicBookingTransitionError,
  );
});
