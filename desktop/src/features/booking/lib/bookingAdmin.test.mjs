import assert from "node:assert/strict";
import test from "node:test";

import {
  branchUsage,
  currencyMinorUnitExponent,
  effectiveGroupAttendanceTracking,
  effectiveGroupTrialPolicy,
  findGroupScheduleConflicts,
  findLessonScheduleConflicts,
  findWorkingHoursOverlaps,
  groupUsage,
  invalidWorkingPeriods,
  majorMoneyInput,
  parseMajorMoneyInput,
  roomUsage,
  teacherUsage,
  workingHoursCounts,
} from "./bookingAdmin.ts";
import { getBookingAdminMessages } from "./bookingAdminLocale.ts";
import { DEMO_BOOKING_WORKSPACE } from "../model/demoSchedule.ts";
import {
  findBuzzWorkChannel,
  normalizeBuzzChannelName,
  suggestBuzzWorkChannels,
} from "./buzzChannelRouting.ts";

function channel(overrides) {
  return {
    id: overrides.id ?? overrides.name,
    name: overrides.name,
    channelType: overrides.channelType ?? "stream",
    visibility: "private",
    description: "",
    topic: null,
    purpose: null,
    memberCount: 1,
    memberPubkeys: [],
    lastMessageAt: null,
    archivedAt: overrides.archivedAt ?? null,
    participants: [],
    participantPubkeys: [],
    isMember: true,
    ttlSeconds: null,
    ttlDeadline: null,
  };
}

test("Russian administration copy exposes the tariff catalog contract", () => {
  const messages = getBookingAdminMessages("ru-RU");

  assert.equal(messages.navTariffs, "Тарифы");
  assert.equal(messages.navPayments, "Оплаты");
  assert.equal(messages.tariffsTitle, "Тарифы");
  assert.equal(messages.addTariff, "Добавить тариф");
  assert.equal(messages.tariffWeeklyScheduleLimit, "Занятий в неделю");
  assert.equal(
    messages.tariffPaymentDayInherited(5),
    "Как у центра — 5-го числа",
  );
  assert.equal(messages.tariffPaymentDayCustom, "Другой день");
  assert.equal(messages.centerPaymentDay, "Число месяца оплаты по умолчанию");
  assert.equal(
    messages.centerPaymentDayHint,
    "Новые тарифы используют это число, если для них не задан другой день.",
  );
  assert.equal(messages.paymentsTitle, "Оплаты");
  assert.equal(messages.paymentMarkPaid, "Отметить оплату");
  assert.equal(messages.paymentCancelReason, "Внутренняя причина");
});

test("Buzz channel routing accepts # names, finds active streams and suggests close matches", () => {
  const channels = [
    channel({ name: "Курская-клиенты" }),
    channel({ name: "Курская-оплаты" }),
    channel({ name: "Курская-архив", archivedAt: "2026-08-01" }),
    channel({ name: "Курская-форум", channelType: "forum" }),
  ];

  assert.equal(
    normalizeBuzzChannelName("  ##Курская-клиенты  "),
    "Курская-клиенты",
  );
  assert.equal(
    findBuzzWorkChannel(channels, "#курская-КЛИЕНТЫ")?.name,
    "Курская-клиенты",
  );
  assert.deepEqual(
    suggestBuzzWorkChannels(channels, "курская").map(({ name }) => name),
    ["Курская-клиенты", "Курская-оплаты"],
  );
  assert.equal(findBuzzWorkChannel(channels, "Курская-архив"), null);
  assert.equal(findBuzzWorkChannel(channels, "Курская-форум"), null);
});

test("working hours distinguish invalid periods from intentional overlaps", () => {
  const hours = {
    monday: [
      { startTime: "09:00", endTime: "13:00" },
      { startTime: "12:00", endTime: "18:00" },
    ],
    tuesday: [{ startTime: "18:00", endTime: "10:00" }],
  };

  assert.deepEqual(invalidWorkingPeriods(hours), [
    { weekday: "tuesday", periodIndex: 0 },
  ]);
  assert.deepEqual(findWorkingHoursOverlaps(hours), [
    { weekday: "monday", firstIndex: 0, secondIndex: 1 },
  ]);
  assert.deepEqual(workingHoursCounts(hours), { days: 2, periods: 3 });
});

test("money input uses each currency minor-unit exponent", () => {
  assert.equal(currencyMinorUnitExponent("RUB"), 2);
  assert.equal(currencyMinorUnitExponent("usd"), 2);
  assert.equal(currencyMinorUnitExponent("EUR"), 2);
  assert.equal(currencyMinorUnitExponent("JPY"), 0);
  assert.equal(currencyMinorUnitExponent("KWD"), 3);

  assert.equal(parseMajorMoneyInput("900", "RUB"), 90_000);
  assert.equal(parseMajorMoneyInput("900,50", "USD"), 90_050);
  assert.equal(majorMoneyInput(90_050, "EUR"), "900.50");
  assert.equal(parseMajorMoneyInput("900", "JPY"), 900);
  assert.equal(majorMoneyInput(900, "JPY"), "900");
  assert.equal(parseMajorMoneyInput("900.50", "JPY"), null);
  assert.equal(parseMajorMoneyInput("1.234", "KWD"), 1_234);
  assert.equal(majorMoneyInput(1_234, "KWD"), "1.234");
  assert.equal(parseMajorMoneyInput("1.2345", "KWD"), null);
  assert.equal(parseMajorMoneyInput("-1", "RUB"), null);
  assert.equal(parseMajorMoneyInput("1.999", "RUB"), null);
  assert.equal(parseMajorMoneyInput("10", "bad"), null);
  assert.throws(() => majorMoneyInput(1_000, "bad"), RangeError);
});

test("branch usage includes rooms, groups and schedule rules", () => {
  const usage = branchUsage(DEMO_BOOKING_WORKSPACE, "kurskaya");
  assert.ok(usage.groups > 0);
  assert.ok(usage.rooms > 0);
  assert.ok(usage.rules > 0);
});

test("branch usage counts a rule only for its effective branch", () => {
  const workspace = structuredClone(DEMO_BOOKING_WORKSPACE);
  const rule = workspace.recurrenceRules[0];
  const group = workspace.groups.find(({ id }) => id === rule.groupId);
  assert.ok(group);
  const target = workspace.branches.find(({ id }) => id !== group.branchId);
  assert.ok(target);
  const sourceBefore = branchUsage(workspace, group.branchId).rules;
  const targetBefore = branchUsage(workspace, target.id).rules;

  rule.branchIdOverride = target.id;

  assert.equal(branchUsage(workspace, group.branchId).rules, sourceBefore - 1);
  assert.equal(branchUsage(workspace, target.id).rules, targetBefore + 1);
});

test("room usage distinguishes active assignments from historical snapshots", () => {
  const usage = roomUsage(DEMO_BOOKING_WORKSPACE, "english-play-room");
  assert.ok(usage.active > 0);
  assert.ok(usage.historical > 0);
  assert.ok(usage.groups > 0);
  assert.ok(usage.exceptions > 0);
});

test("group settings inherit center defaults and allow independent overrides", () => {
  const workspace = structuredClone(DEMO_BOOKING_WORKSPACE);
  const group = workspace.groups[0];
  delete group.trialPolicyOverride;
  delete group.trackAttendanceOverride;
  workspace.organization.defaultTrialPolicy = { mode: "free" };
  workspace.organization.trackAttendanceByDefault = true;

  assert.equal(effectiveGroupTrialPolicy(workspace, group).mode, "free");
  assert.equal(effectiveGroupAttendanceTracking(workspace, group), true);

  group.trialPolicyOverride = { mode: "disabled" };
  group.trackAttendanceOverride = false;
  assert.equal(effectiveGroupTrialPolicy(workspace, group).mode, "disabled");
  assert.equal(effectiveGroupAttendanceTracking(workspace, group), false);
});

test("schedule validation reports working-hours, room and teacher conflicts", () => {
  const workspace = structuredClone(DEMO_BOOKING_WORKSPACE);
  const existingGroup = workspace.groups.find(
    (group) => group.id === "robotics-junior",
  );
  const existingRule = workspace.recurrenceRules.find(
    (rule) => rule.groupId === existingGroup.id,
  );
  const candidateGroup = {
    ...existingGroup,
    id: "candidate-group",
    name: "Конфликтная группа",
  };
  const shared = {
    id: "candidate-shared",
    organizationId: workspace.organization.id,
    groupId: candidateGroup.id,
    startsOn: existingRule.startsOn,
    endsOn: existingRule.endsOn,
    weekdays: [...existingRule.weekdays],
    startTime: existingRule.startTime,
    endTime: existingRule.endTime,
    status: "active",
  };
  const outside = {
    ...shared,
    id: "candidate-outside",
    startTime: "07:00",
    endTime: "08:00",
  };
  const conflicts = findGroupScheduleConflicts(workspace, candidateGroup, [
    shared,
    outside,
  ]);

  assert.ok(conflicts.some(({ kind }) => kind === "room"));
  assert.ok(conflicts.some(({ kind }) => kind === "teacher"));
  assert.ok(
    conflicts.some(
      ({ kind, templateId }) =>
        kind === "outside-working-hours" && templateId === outside.id,
    ),
  );

  const crossBranch = findGroupScheduleConflicts(
    workspace,
    { ...candidateGroup, branchId: "akademicheskaya", roomId: undefined },
    [{ ...shared, id: "candidate-cross-branch" }],
  );
  assert.ok(crossBranch.some(({ kind }) => kind === "teacher"));
  assert.ok(!crossBranch.some(({ kind }) => kind === "room"));
});

test("lesson validation uses final date, room, teacher and working hours", () => {
  const base = {
    recurrenceRuleId: "math-club-weekly",
    originalDate: "2026-08-07",
    date: "2026-08-03",
    startTime: "10:00",
    endTime: "11:00",
    branchId: "kurskaya",
    roomId: "robotics-junior-room",
    teacherIds: ["teacher-1"],
  };
  const conflicts = findLessonScheduleConflicts(DEMO_BOOKING_WORKSPACE, base);
  assert.ok(conflicts.some(({ kind }) => kind === "room"));
  assert.ok(conflicts.some(({ kind }) => kind === "teacher"));

  const outside = findLessonScheduleConflicts(DEMO_BOOKING_WORKSPACE, {
    ...base,
    date: "2026-08-04",
    startTime: "07:00",
    endTime: "08:00",
    roomId: undefined,
    teacherIds: [],
  });
  assert.deepEqual(outside, [{ kind: "outside-working-hours" }]);

  const crossBranch = findLessonScheduleConflicts(DEMO_BOOKING_WORKSPACE, {
    ...base,
    branchId: "akademicheskaya",
    roomId: undefined,
  });
  assert.ok(crossBranch.some(({ kind }) => kind === "teacher"));
  assert.ok(!crossBranch.some(({ kind }) => kind === "room"));
});

test("teacher and group usage include preserved historical relations", () => {
  const group = DEMO_BOOKING_WORKSPACE.groups.find(
    (candidate) => candidate.teacherIds.length > 0,
  );
  const teacherId = group.teacherIds[0];
  const teacherRelations = teacherUsage(DEMO_BOOKING_WORKSPACE, teacherId);
  const groupRelations = groupUsage(DEMO_BOOKING_WORKSPACE, group.id);

  assert.ok(teacherRelations.groups > 0);
  assert.ok(teacherRelations.rules > 0);
  assert.ok(groupRelations.rules > 0);
});
