import {
  parseBookingWorkspace,
  type BookingBranch as CoreBookingBranch,
  type BookingGroup,
  type BookingWorkspace,
  type TrialPolicy,
  type Weekday,
} from "@/features/booking/model/bookingCore";
import {
  materializeSchedule,
  type ScheduleOccurrence,
} from "@/features/booking/model/materializeSchedule";
import {
  formatBookingAgeRange,
  getBookingMessages,
} from "@/features/booking/lib/bookingLocale";
import { lessonOccupancy } from "@/features/booking/model/bookingOperations";

export type BookingBranch = {
  id: string;
  name: string;
  address: string;
};

export type TrialOffer =
  | { mode: "disabled" }
  | { mode: "free" }
  | { mode: "paid"; amountMinor: number; currency: string };

export type ScheduleLesson = {
  id: string;
  recurrenceRuleId: string;
  groupId: string;
  originalDate: string;
  originalStartTime: string;
  originalEndTime: string;
  exceptionId?: string;
  dayIndex: number;
  date: string;
  startTime: string;
  endTime: string;
  branchId: string;
  branchName: string;
  branchAddress: string;
  branchStatus: "active" | "archived";
  groupName: string;
  ageLabel: string;
  room?: string;
  roomId?: string;
  teachers?: string[];
  teacherIds: string[];
  capacity?: number;
  booked: number;
  status: "scheduled" | "moved" | "modified" | "cancelled";
  movedFrom?: {
    date: string;
    startTime: string;
    endTime: string;
  };
  trial: TrialOffer;
  singleVisitAllowed: boolean;
  trackAttendance: boolean;
};

type DemoSeed = {
  id: string;
  dayIndex: number;
  startsOn?: string;
  startTime: string;
  endTime: string;
  branchId: "kurskaya" | "akademicheskaya";
  groupName: string;
  minAgeMonths?: number;
  maxAgeMonths?: number;
  room?: string;
  teachers: string[];
  capacity?: number;
  trial: TrialOffer;
};

export const BOOKING_TIME_ZONE = "Europe/Moscow";
export const DEMO_WEEK_START = "2026-08-03";
const DEMO_END_DATE = "2026-12-31";

const WEEKDAYS: readonly Weekday[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const DEMO_SEEDS: readonly DemoSeed[] = [
  {
    id: "robotics-junior",
    dayIndex: 0,
    startTime: "10:00",
    endTime: "11:00",
    branchId: "kurskaya",
    groupName: "Робототехника Junior",
    minAgeMonths: 60,
    maxAgeMonths: 84,
    room: "Лаборатория 1",
    teachers: ["Анна Орлова"],
    capacity: 8,
    trial: { mode: "free" },
  },
  {
    id: "animation",
    dayIndex: 0,
    startTime: "18:30",
    endTime: "20:00",
    branchId: "akademicheskaya",
    groupName: "Мультстудия",
    minAgeMonths: 96,
    maxAgeMonths: 132,
    room: "Медиа-зал",
    teachers: ["Илья Соколов", "Мария Волкова"],
    capacity: 10,
    trial: { mode: "paid", amountMinor: 90_000, currency: "RUB" },
  },
  {
    id: "chess-start",
    dayIndex: 1,
    startTime: "12:00",
    endTime: "13:00",
    branchId: "kurskaya",
    groupName: "Шахматы: первый ход",
    minAgeMonths: 72,
    teachers: ["Павел Миронов"],
    trial: { mode: "free" },
  },
  {
    id: "science-lab",
    dayIndex: 1,
    startTime: "17:00",
    endTime: "18:30",
    branchId: "akademicheskaya",
    groupName: "Научная лаборатория",
    minAgeMonths: 108,
    maxAgeMonths: 144,
    room: "Лаборатория 2",
    teachers: [],
    capacity: 8,
    trial: { mode: "paid", amountMinor: 120_000, currency: "RUB" },
  },
  {
    id: "english-play",
    dayIndex: 2,
    startTime: "10:00",
    endTime: "11:00",
    branchId: "kurskaya",
    groupName: "English Play",
    minAgeMonths: 48,
    maxAgeMonths: 72,
    room: "Зал 2",
    teachers: ["Елена Смирнова"],
    capacity: 12,
    trial: { mode: "free" },
  },
  {
    id: "theatre",
    dayIndex: 2,
    startTime: "18:00",
    endTime: "19:30",
    branchId: "akademicheskaya",
    groupName: "Театральная студия",
    minAgeMonths: 84,
    maxAgeMonths: 120,
    teachers: ["Нина Белова"],
    capacity: 14,
    trial: { mode: "paid", amountMinor: 70_000, currency: "RUB" },
  },
  {
    id: "ceramics",
    dayIndex: 3,
    startTime: "10:30",
    endTime: "12:00",
    branchId: "akademicheskaya",
    groupName: "Керамика",
    minAgeMonths: 72,
    maxAgeMonths: 108,
    room: "Мастерская",
    teachers: ["Ольга Рябова"],
    capacity: 7,
    trial: { mode: "paid", amountMinor: 110_000, currency: "RUB" },
  },
  {
    id: "programming",
    dayIndex: 3,
    startTime: "17:30",
    endTime: "19:00",
    branchId: "kurskaya",
    groupName: "Программирование",
    minAgeMonths: 120,
    maxAgeMonths: 156,
    room: "Компьютерный класс",
    teachers: ["Денис Котов"],
    capacity: 10,
    trial: { mode: "free" },
  },
  {
    id: "dance-kids",
    dayIndex: 4,
    startTime: "16:00",
    endTime: "17:00",
    branchId: "kurskaya",
    groupName: "Танцы Kids",
    minAgeMonths: 36,
    maxAgeMonths: 60,
    room: "Большой зал",
    teachers: ["Алина Яковлева", "Софья Лебедева"],
    capacity: 16,
    trial: { mode: "paid", amountMinor: 60_000, currency: "RUB" },
  },
  {
    id: "math-club",
    dayIndex: 4,
    startTime: "18:30",
    endTime: "19:30",
    branchId: "akademicheskaya",
    groupName: "Математический клуб",
    minAgeMonths: 96,
    room: "Кабинет 4",
    teachers: ["Роман Егоров"],
    trial: { mode: "free" },
  },
  {
    id: "family-art",
    dayIndex: 5,
    startTime: "11:00",
    endTime: "12:30",
    branchId: "kurskaya",
    groupName: "Семейная арт-мастерская",
    room: "Мастерская",
    teachers: ["Дарья Попова"],
    capacity: 18,
    trial: { mode: "paid", amountMinor: 150_000, currency: "RUB" },
  },
  {
    id: "music-start",
    dayIndex: 5,
    startTime: "14:00",
    endTime: "15:00",
    branchId: "akademicheskaya",
    groupName: "Музыка с нуля",
    minAgeMonths: 60,
    maxAgeMonths: 96,
    teachers: [],
    capacity: 9,
    trial: { mode: "free" },
  },
  {
    id: "architecture",
    dayIndex: 6,
    startTime: "12:00",
    endTime: "13:30",
    branchId: "kurskaya",
    groupName: "Архитектура для детей",
    minAgeMonths: 108,
    maxAgeMonths: 168,
    room: "Зал 3",
    teachers: ["Максим Фролов"],
    capacity: 12,
    trial: { mode: "paid", amountMinor: 100_000, currency: "RUB" },
  },
  {
    id: "public-speaking",
    dayIndex: 6,
    startTime: "16:30",
    endTime: "18:00",
    branchId: "akademicheskaya",
    groupName: "Уверенная речь",
    minAgeMonths: 132,
    maxAgeMonths: 180,
    room: "Зал 1",
    teachers: ["Вера Крылова"],
    capacity: 10,
    trial: { mode: "free" },
  },
  {
    id: "public-limited",
    dayIndex: 0,
    startsOn: "2026-08-10",
    startTime: "15:00",
    endTime: "16:00",
    branchId: "kurskaya",
    groupName: "Открытая лаборатория",
    minAgeMonths: 60,
    maxAgeMonths: 96,
    room: "Лаборатория записи",
    teachers: ["Анна Орлова"],
    capacity: 1,
    trial: { mode: "free" },
  },
  {
    id: "public-disabled",
    dayIndex: 0,
    startsOn: "2026-08-10",
    startTime: "16:30",
    endTime: "17:30",
    branchId: "kurskaya",
    groupName: "Закрытая демонстрационная группа",
    minAgeMonths: 60,
    maxAgeMonths: 96,
    teachers: [],
    trial: { mode: "disabled" },
  },
];

function workingHours(startTime: string, endTime: string) {
  return Object.fromEntries(
    WEEKDAYS.map((weekday) => [weekday, [{ startTime, endTime }]]),
  );
}

function roomIdForSeed(seed: DemoSeed): string | undefined {
  return seed.room ? `${seed.id}-room` : undefined;
}

function teacherIdForName(name: string): string {
  const index = uniqueTeacherNames.indexOf(name);
  return `teacher-${index + 1}`;
}

function trialPolicyForOffer(offer: TrialOffer): TrialPolicy {
  if (offer.mode === "paid") {
    return {
      mode: "paid",
      price: { amountMinor: offer.amountMinor, currency: offer.currency },
    };
  }
  return { mode: offer.mode };
}

const uniqueTeacherNames = [
  ...new Set(DEMO_SEEDS.flatMap((seed) => seed.teachers)),
];

const DEMO_BRANCH_RECORDS: readonly CoreBookingBranch[] = [
  {
    id: "kurskaya",
    organizationId: "airhop",
    name: "Курская",
    address: "ул. Земляной Вал, 27",
    workingHours: workingHours("09:00", "21:00"),
    status: "active",
  },
  {
    id: "akademicheskaya",
    organizationId: "airhop",
    name: "Академическая",
    address: "Профсоюзная ул., 17",
    workingHours: workingHours("10:00", "22:00"),
    status: "active",
  },
];

export const DEMO_BOOKING_WORKSPACE: BookingWorkspace = parseBookingWorkspace({
  schemaVersion: 8,
  revision: 0,
  organization: {
    id: "airhop",
    name: "Каляка Маляка",
    locale: "ru-RU",
    timeZone: BOOKING_TIME_ZONE,
    defaultTrialPolicy: { mode: "free" },
    trackAttendanceByDefault: true,
    allowSingleVisitsByDefault: false,
    existingStudentsOnboarding: { status: "not_started" },
    paymentDayOfMonth: 5,
  },
  branches: DEMO_BRANCH_RECORDS,
  rooms: DEMO_SEEDS.flatMap((seed) => {
    const roomId = roomIdForSeed(seed);
    return roomId
      ? [
          {
            id: roomId,
            organizationId: "airhop",
            branchId: seed.branchId,
            name: seed.room,
            status: "active",
          },
        ]
      : [];
  }),
  teachers: uniqueTeacherNames.map((displayName) => ({
    id: teacherIdForName(displayName),
    organizationId: "airhop",
    displayName,
    status: "active",
  })),
  groups: DEMO_SEEDS.map(
    (seed): BookingGroup => ({
      id: seed.id,
      organizationId: "airhop",
      branchId: seed.branchId,
      name: seed.groupName,
      ...(seed.room ? { roomId: roomIdForSeed(seed) } : {}),
      teacherIds: seed.teachers.map(teacherIdForName),
      ...(seed.minAgeMonths === undefined
        ? {}
        : { minAgeMonths: seed.minAgeMonths }),
      ...(seed.maxAgeMonths === undefined
        ? {}
        : { maxAgeMonths: seed.maxAgeMonths }),
      ...(seed.capacity === undefined ? {} : { capacity: seed.capacity }),
      trialPolicyOverride: trialPolicyForOffer(seed.trial),
      status: "active",
    }),
  ),
  recurrenceRules: DEMO_SEEDS.map((seed) => ({
    id: `${seed.id}-weekly`,
    organizationId: "airhop",
    groupId: seed.id,
    startsOn: seed.startsOn ?? DEMO_WEEK_START,
    endsOn: DEMO_END_DATE,
    weekdays: [WEEKDAYS[seed.dayIndex]],
    startTime: seed.startTime,
    endTime: seed.endTime,
    status: "active",
  })),
  lessonExceptions: [
    {
      id: "english-play-moved",
      organizationId: "airhop",
      recurrenceRuleId: "english-play-weekly",
      originalDate: "2026-08-05",
      original: {
        startTime: "10:00",
        endTime: "11:00",
        branchId: "kurskaya",
        roomId: "english-play-room",
        teacherIds: [teacherIdForName("Елена Смирнова")],
      },
      kind: "override",
      override: { startTime: "11:00", endTime: "12:00" },
      reason: "Демонстрационный перенос",
    },
    {
      id: "theatre-cancelled",
      organizationId: "airhop",
      recurrenceRuleId: "theatre-weekly",
      originalDate: "2026-08-05",
      original: {
        startTime: "18:00",
        endTime: "19:30",
        branchId: "akademicheskaya",
        roomId: null,
        teacherIds: [teacherIdForName("Нина Белова")],
      },
      kind: "cancelled",
      reason: "Демонстрационная отмена",
    },
  ],
  families: [],
  representatives: [],
  children: [],
  duplicateCandidates: [],
  bookings: [],
  tariffs: [
    {
      id: "tariff-weekly-1",
      organizationId: "airhop",
      name: "1 раз в неделю",
      description: "Одно регулярное занятие в неделю",
      priceMinor: 400_000,
      currency: "RUB",
      weeklyScheduleLimit: 1,
      status: "active",
      createdAt: "2026-08-01T09:00:00.000Z",
      updatedAt: "2026-08-01T09:00:00.000Z",
    },
    {
      id: "tariff-weekly-2",
      organizationId: "airhop",
      name: "2 раза в неделю",
      description: "Два регулярных занятия в неделю",
      priceMinor: 600_000,
      currency: "RUB",
      weeklyScheduleLimit: 2,
      status: "active",
      createdAt: "2026-08-01T09:00:00.000Z",
      updatedAt: "2026-08-01T09:00:00.000Z",
    },
    {
      id: "tariff-weekly-3",
      organizationId: "airhop",
      name: "3 раза в неделю",
      description: "Три регулярных занятия в неделю",
      priceMinor: 800_000,
      currency: "RUB",
      weeklyScheduleLimit: 3,
      status: "active",
      createdAt: "2026-08-01T09:00:00.000Z",
      updatedAt: "2026-08-01T09:00:00.000Z",
    },
  ],
  enrollments: [],
  paymentExpectations: [],
  intakeRequests: [],
  pendingActions: [],
  attendanceRecords: [],
});

export const DEMO_BRANCHES: BookingBranch[] =
  DEMO_BOOKING_WORKSPACE.branches.map((branch) => ({
    id: branch.id,
    name: branch.name,
    address: branch.address,
  }));

function shiftIsoDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayOffset(startDate: string, date: string): number {
  const start = new Date(`${startDate}T12:00:00Z`).getTime();
  const current = new Date(`${date}T12:00:00Z`).getTime();
  return Math.round((current - start) / 86_400_000);
}

export function getIsoDateInTimeZone(
  timeZone: string,
  now: Date = new Date(),
): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(
    parts
      .filter(
        ({ type }) => type === "year" || type === "month" || type === "day",
      )
      .map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function startOfIsoWeek(isoDate: string): string {
  const weekday = new Date(`${isoDate}T12:00:00Z`).getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  return shiftIsoDate(isoDate, -daysSinceMonday);
}

function trialOfferFromPolicy(policy: TrialPolicy): TrialOffer {
  if (policy.mode === "paid") {
    return {
      mode: "paid",
      amountMinor: policy.price.amountMinor,
      currency: policy.price.currency,
    };
  }
  return { mode: policy.mode };
}

export function getBookingBranches(
  workspace: BookingWorkspace = DEMO_BOOKING_WORKSPACE,
): BookingBranch[] {
  return workspace.branches
    .filter((branch) => branch.status === "active")
    .map((branch) => ({
      id: branch.id,
      name: branch.name,
      address: branch.address,
    }));
}

export function getWorkspaceWeek(
  workspace: BookingWorkspace,
  weekOffset = 0,
  referenceDate = getIsoDateInTimeZone(workspace.organization.timeZone),
) {
  const messages = getBookingMessages(workspace.organization.locale);
  const branchById = new Map(
    workspace.branches.map((branch) => [branch.id, branch]),
  );
  const groupById = new Map(workspace.groups.map((group) => [group.id, group]));
  const roomById = new Map(workspace.rooms.map((room) => [room.id, room]));
  const teacherById = new Map(
    workspace.teachers.map((teacher) => [teacher.id, teacher]),
  );
  function toScheduleLesson(
    occurrence: ScheduleOccurrence,
    weekStartDate: string,
  ): ScheduleLesson {
    const group = groupById.get(occurrence.groupId);
    const branch = branchById.get(occurrence.branchId);
    const teachers = occurrence.teacherIds
      .map((teacherId) => teacherById.get(teacherId)?.displayName)
      .filter((name): name is string => Boolean(name));
    const room = occurrence.roomId
      ? roomById.get(occurrence.roomId)?.name
      : undefined;

    return {
      id: occurrence.id,
      recurrenceRuleId: occurrence.recurrenceRuleId,
      groupId: occurrence.groupId,
      originalDate: occurrence.originalDate,
      originalStartTime: occurrence.originalStartTime,
      originalEndTime: occurrence.originalEndTime,
      ...(occurrence.exceptionId
        ? { exceptionId: occurrence.exceptionId }
        : {}),
      dayIndex: dayOffset(weekStartDate, occurrence.date),
      date: occurrence.date,
      startTime: occurrence.startTime,
      endTime: occurrence.endTime,
      branchId: occurrence.branchId,
      branchName: branch?.name ?? occurrence.branchId,
      branchAddress: branch?.address ?? messages.addressMissing,
      branchStatus: branch?.status ?? "active",
      groupName: group?.name ?? messages.unnamedGroup,
      ageLabel: group
        ? formatBookingAgeRange({
            locale: workspace.organization.locale,
            minAgeMonths: group.minAgeMonths,
            maxAgeMonths: group.maxAgeMonths,
          })
        : messages.unlimited,
      ...(room ? { room } : {}),
      ...(occurrence.roomId ? { roomId: occurrence.roomId } : {}),
      ...(teachers.length ? { teachers } : {}),
      teacherIds: [...occurrence.teacherIds],
      ...(occurrence.capacity === undefined
        ? {}
        : { capacity: occurrence.capacity }),
      booked: lessonOccupancy(workspace, {
        groupId: occurrence.groupId,
        date: occurrence.date,
        lessonRef: {
          recurrenceRuleId: occurrence.recurrenceRuleId,
          originalDate: occurrence.originalDate,
        },
      }),
      status: occurrence.status,
      ...(occurrence.date !== occurrence.originalDate ||
      occurrence.startTime !== occurrence.originalStartTime ||
      occurrence.endTime !== occurrence.originalEndTime
        ? {
            movedFrom: {
              date: occurrence.originalDate,
              startTime: occurrence.originalStartTime,
              endTime: occurrence.originalEndTime,
            },
          }
        : {}),
      trial: trialOfferFromPolicy(occurrence.trialPolicy),
      singleVisitAllowed: occurrence.singleVisitAllowed,
      trackAttendance: occurrence.trackAttendance,
    };
  }

  const startDate = shiftIsoDate(startOfIsoWeek(referenceDate), weekOffset * 7);
  const dates = Array.from({ length: 7 }, (_, dayIndex) =>
    shiftIsoDate(startDate, dayIndex),
  );
  const occurrences = materializeSchedule(workspace, {
    startsOn: startDate,
    endsOn: dates[6],
  });

  return {
    startDate,
    endDate: dates[6],
    dates,
    lessons: occurrences.map((occurrence) =>
      toScheduleLesson(occurrence, startDate),
    ),
  };
}

export function getDemoWeek(weekOffset = 0, referenceDate = DEMO_WEEK_START) {
  return getWorkspaceWeek(DEMO_BOOKING_WORKSPACE, weekOffset, referenceDate);
}

export function getBranch(branchId: string) {
  return DEMO_BRANCHES.find((branch) => branch.id === branchId);
}

export function getAvailablePlaces(lesson: ScheduleLesson) {
  return lesson.capacity === undefined
    ? null
    : Math.max(lesson.capacity - lesson.booked, 0);
}
