import { z } from "zod";

import { currencyMinorUnitExponent } from "@/features/booking/lib/bookingMoney";
import { migrateBookingWorkspace } from "@/features/booking/model/bookingWorkspaceMigration";
import {
  BookingWorkspaceValidationError,
  isValidLocale,
  isValidTimeZone,
  type BookingValidationIssue,
} from "@/features/booking/model/bookingOperationalValidation";
import { validateBookingWorkspaceReferences } from "@/features/booking/model/bookingWorkspaceValidation";

export { BookingWorkspaceValidationError };
export type { BookingValidationIssue };
export { isRecurrenceRuleOccurrence } from "@/features/booking/model/bookingRecurrence";
export { validateBookingWorkspaceReferences } from "@/features/booking/model/bookingWorkspaceValidation";

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export const bookingIdSchema = z.string().regex(ID_PATTERN);
export const isoDateSchema = z
  .string()
  .refine(isRealIsoDate, "Invalid ISO date");
export const localTimeSchema = z.string().regex(LOCAL_TIME_PATTERN);

export const weekdaySchema = z.enum([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

export type Weekday = z.infer<typeof weekdaySchema>;

const moneySchema = z.object({
  amountMinor: z.number().int().nonnegative(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .refine((currency) => currencyMinorUnitExponent(currency) !== null, {
      message: "Unknown currency",
    }),
});

export const trialPolicySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("disabled") }),
  z.object({ mode: z.literal("free") }),
  z.object({ mode: z.literal("paid"), price: moneySchema }),
]);

export type TrialPolicy = z.infer<typeof trialPolicySchema>;

export const publicBookingPurposeSchema = z.enum(["trial", "lesson"]);
export const publicBookingAppearanceSchema = z.enum([
  "automatic",
  "light",
  "dark",
]);
export const publicBookingSettingsSchema = z
  .object({
    purpose: publicBookingPurposeSchema.default("trial"),
    appearance: publicBookingAppearanceSchema.default("automatic"),
  })
  .default({ purpose: "trial", appearance: "automatic" });

export const existingStudentsOnboardingSchema = z.object({
  status: z.enum(["not_started", "in_progress", "postponed", "completed"]),
});

export const workingPeriodSchema = z
  .object({
    startTime: localTimeSchema,
    endTime: localTimeSchema,
  })
  .refine(({ startTime, endTime }) => startTime < endTime, {
    message: "Working period must end after it starts",
  });

export const weeklyWorkingHoursSchema = z.object({
  monday: z.array(workingPeriodSchema).optional(),
  tuesday: z.array(workingPeriodSchema).optional(),
  wednesday: z.array(workingPeriodSchema).optional(),
  thursday: z.array(workingPeriodSchema).optional(),
  friday: z.array(workingPeriodSchema).optional(),
  saturday: z.array(workingPeriodSchema).optional(),
  sunday: z.array(workingPeriodSchema).optional(),
});

export const organizationSchema = z.object({
  id: bookingIdSchema,
  name: z.string().trim().min(1).max(160),
  locale: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .refine(isValidLocale, "Invalid locale"),
  timeZone: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine(isValidTimeZone, "Invalid IANA time zone"),
  defaultTrialPolicy: trialPolicySchema,
  trackAttendanceByDefault: z.boolean(),
  allowSingleVisitsByDefault: z.boolean(),
  existingStudentsOnboarding: existingStudentsOnboardingSchema,
  publicBooking: publicBookingSettingsSchema,
  paymentDayOfMonth: z.number().int().min(1).max(28),
});

export const branchSchema = z.object({
  id: bookingIdSchema,
  organizationId: bookingIdSchema,
  name: z.string().trim().min(1).max(160),
  address: z.string().trim().min(1).max(500),
  workingHours: weeklyWorkingHoursSchema,
  defaultBuzzChannelId: bookingIdSchema.optional(),
  status: z.enum(["active", "archived"]),
});

export const roomSchema = z.object({
  id: bookingIdSchema,
  organizationId: bookingIdSchema,
  branchId: bookingIdSchema,
  name: z.string().trim().min(1).max(160),
  status: z.enum(["active", "archived"]),
});

export const teacherSchema = z.object({
  id: bookingIdSchema,
  organizationId: bookingIdSchema,
  displayName: z.string().trim().min(1).max(160),
  buzzUsername: z.string().trim().min(1).max(160).optional(),
  status: z.enum(["active", "archived"]),
});

export const groupSchema = z
  .object({
    id: bookingIdSchema,
    organizationId: bookingIdSchema,
    branchId: bookingIdSchema,
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(4_000).optional(),
    roomId: bookingIdSchema.optional(),
    teacherIds: z.array(bookingIdSchema),
    minAgeMonths: z.number().int().nonnegative().optional(),
    maxAgeMonths: z.number().int().nonnegative().optional(),
    capacity: z.number().int().positive().optional(),
    trialPolicyOverride: trialPolicySchema.optional(),
    trackAttendanceOverride: z.boolean().optional(),
    allowSingleVisitsOverride: z.boolean().optional(),
    status: z.enum(["active", "archived"]),
  })
  .refine(
    ({ minAgeMonths, maxAgeMonths }) =>
      minAgeMonths === undefined ||
      maxAgeMonths === undefined ||
      minAgeMonths <= maxAgeMonths,
    { message: "Minimum age cannot exceed maximum age" },
  )
  .refine(({ teacherIds }) => new Set(teacherIds).size === teacherIds.length, {
    message: "Group teachers must be unique",
  });

export const recurrenceRuleSchema = z
  .object({
    id: bookingIdSchema,
    organizationId: bookingIdSchema,
    groupId: bookingIdSchema,
    startsOn: isoDateSchema,
    endsOn: isoDateSchema,
    weekdays: z.array(weekdaySchema).min(1),
    startTime: localTimeSchema,
    endTime: localTimeSchema,
    branchIdOverride: bookingIdSchema.optional(),
    roomIdOverride: bookingIdSchema.nullable().optional(),
    teacherIdsOverride: z.array(bookingIdSchema).optional(),
    capacityOverride: z.number().int().positive().nullable().optional(),
    trialPolicyOverride: trialPolicySchema.optional(),
    status: z.enum(["active", "archived"]),
  })
  .refine(({ startsOn, endsOn }) => startsOn <= endsOn, {
    message: "Recurrence range is reversed",
  })
  .refine(({ startTime, endTime }) => startTime < endTime, {
    message: "Lesson must end after it starts",
  })
  .refine(({ weekdays }) => new Set(weekdays).size === weekdays.length, {
    message: "Recurrence weekdays must be unique",
  })
  .refine(
    ({ teacherIdsOverride }) =>
      !teacherIdsOverride ||
      new Set(teacherIdsOverride).size === teacherIdsOverride.length,
    { message: "Recurrence teachers must be unique" },
  );

const occurrenceOverrideSchema = z
  .object({
    date: isoDateSchema.optional(),
    startTime: localTimeSchema.optional(),
    endTime: localTimeSchema.optional(),
    branchId: bookingIdSchema.optional(),
    roomId: bookingIdSchema.nullable().optional(),
    teacherIds: z.array(bookingIdSchema).optional(),
    capacity: z.number().int().positive().nullable().optional(),
    trialPolicy: trialPolicySchema.optional(),
    allowSingleVisits: z.boolean().optional(),
  })
  .refine((override) => Object.keys(override).length > 0, {
    message: "An occurrence override must change at least one field",
  })
  .refine(
    ({ startTime, endTime }) =>
      startTime === undefined || endTime === undefined || startTime < endTime,
    { message: "Overridden lesson must end after it starts" },
  )
  .refine(
    ({ teacherIds }) =>
      !teacherIds || new Set(teacherIds).size === teacherIds.length,
    { message: "Overridden lesson teachers must be unique" },
  );

const occurrenceOriginalSchema = z
  .object({
    startTime: localTimeSchema,
    endTime: localTimeSchema,
    branchId: bookingIdSchema,
    roomId: bookingIdSchema.nullable(),
    teacherIds: z.array(bookingIdSchema),
  })
  .refine(({ startTime, endTime }) => startTime < endTime, {
    message: "Original lesson must end after it starts",
  })
  .refine(({ teacherIds }) => new Set(teacherIds).size === teacherIds.length, {
    message: "Original lesson teachers must be unique",
  });

const occurrenceEffectiveSchema = z
  .object({
    date: isoDateSchema,
    startTime: localTimeSchema,
    endTime: localTimeSchema,
    branchId: bookingIdSchema,
    roomId: bookingIdSchema.nullable(),
    teacherIds: z.array(bookingIdSchema),
    capacity: z.number().int().positive().nullable(),
    trialPolicy: trialPolicySchema,
    allowSingleVisits: z.boolean(),
  })
  .refine(({ startTime, endTime }) => startTime < endTime, {
    message: "Effective lesson must end after it starts",
  })
  .refine(({ teacherIds }) => new Set(teacherIds).size === teacherIds.length, {
    message: "Effective lesson teachers must be unique",
  });

export const lessonExceptionSchema = z.discriminatedUnion("kind", [
  z.object({
    id: bookingIdSchema,
    organizationId: bookingIdSchema,
    recurrenceRuleId: bookingIdSchema,
    originalDate: isoDateSchema,
    original: occurrenceOriginalSchema,
    kind: z.literal("cancelled"),
    effective: occurrenceEffectiveSchema.optional(),
    reason: z.string().trim().max(1_000).optional(),
  }),
  z.object({
    id: bookingIdSchema,
    organizationId: bookingIdSchema,
    recurrenceRuleId: bookingIdSchema,
    originalDate: isoDateSchema,
    original: occurrenceOriginalSchema,
    kind: z.literal("override"),
    override: occurrenceOverrideSchema,
    reason: z.string().trim().max(1_000).optional(),
  }),
]);

export const stableLessonReferenceSchema = z.object({
  recurrenceRuleId: bookingIdSchema,
  originalDate: isoDateSchema,
});

export const preferredContactChannelSchema = z.enum([
  "telegram",
  "max",
  "whatsapp",
  "phone",
  "none",
]);

export const familySchema = z.object({
  id: bookingIdSchema,
  organizationId: bookingIdSchema,
  displayName: z.string().trim().min(1).max(200),
  primaryRepresentativeId: bookingIdSchema,
  status: z.enum(["active", "archived"]),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const representativeSchema = z.object({
  id: bookingIdSchema,
  organizationId: bookingIdSchema,
  familyId: bookingIdSchema,
  displayName: z.string().trim().min(1).max(160),
  phoneNormalized: z.string().regex(/^\+[1-9]\d{9,14}$/),
  phoneDisplay: z.string().trim().min(1).max(80),
  preferredContactChannel: preferredContactChannelSchema,
  messengerAccounts: z.array(
    z.object({
      channel: z.enum(["telegram", "max", "whatsapp"]),
      externalUserId: z.string().trim().min(1).max(200),
      displayHandle: z.string().trim().min(1).max(200).optional(),
    }),
  ),
  consentVersion: z.string().trim().min(1).max(80),
  consentAcceptedAt: z.string().datetime({ offset: true }),
  status: z.enum(["active", "archived"]),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const childSchema = z.object({
  id: bookingIdSchema,
  organizationId: bookingIdSchema,
  familyId: bookingIdSchema,
  displayName: z.string().trim().min(1).max(160),
  birthDate: isoDateSchema,
  note: z.string().trim().max(4_000).optional(),
  status: z.enum(["active", "archived"]),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const duplicateCandidateSchema = z.object({
  id: bookingIdSchema,
  organizationId: bookingIdSchema,
  newEntityType: z.enum(["representative", "child"]),
  newEntityId: bookingIdSchema,
  existingEntityType: z.enum(["representative", "child"]),
  existingEntityId: bookingIdSchema,
  signals: z
    .array(z.enum(["phone", "messenger", "name_and_birth_date"]))
    .min(1),
  status: z.enum(["pending", "merged", "dismissed"]),
  createdAt: z.string().datetime({ offset: true }),
  resolvedAt: z.string().datetime({ offset: true }).optional(),
  resolvedBy: z.string().trim().min(1).max(200).optional(),
});

export const bookingApplicantSnapshotSchema = z.object({
  parentName: z.string().trim().min(1).max(160),
  phoneNormalized: z.string().regex(/^\+[1-9]\d{9,14}$/),
  phoneDisplay: z.string().trim().min(1).max(80),
  childName: z.string().trim().min(1).max(160),
  childBirthDate: isoDateSchema,
  consentVersion: z.string().trim().min(1).max(80),
  consentAcceptedAt: z.string().datetime({ offset: true }),
  preferredContactChannel: preferredContactChannelSchema,
});

export const bookingStatusSchema = z.enum([
  "pending_confirmation",
  "confirmed",
  "rejected",
  "cancelled_by_parent",
  "cancelled_by_center",
]);

export const bookingVisitKindSchema = z.enum(["trial", "single"]);

export const bookingSourceChannelSchema = z.enum([
  "website",
  "phone",
  "visit",
  "telegram",
  "max",
  "whatsapp",
  "buzz",
  "other",
]);

export const bookingTransferRequestSchema = z.object({
  status: z.literal("pending"),
  requestedAt: z.string().datetime({ offset: true }),
  comment: z.string().trim().max(1_000).optional(),
});

export const bookingSchema = z.object({
  id: bookingIdSchema,
  organizationId: bookingIdSchema,
  familyId: bookingIdSchema,
  representativeId: bookingIdSchema,
  childId: bookingIdSchema,
  lessonRef: stableLessonReferenceSchema,
  applicant: bookingApplicantSnapshotSchema,
  visitKind: bookingVisitKindSchema,
  status: bookingStatusSchema,
  transferRequest: bookingTransferRequestSchema.nullable(),
  managementTokenDigest: z.string().regex(/^[a-f0-9]{64}$/),
  idempotencyKeyDigest: z.string().regex(/^[a-f0-9]{64}$/),
  source: z.object({
    surface: z.enum(["standalone", "embedded", "staff_ui", "fizz"]),
    attributionBranchId: bookingIdSchema.optional(),
    purpose: publicBookingPurposeSchema.default("trial"),
    channel: bookingSourceChannelSchema,
    workflow: z.enum(["direct", "request"]).default("request"),
  }),
  createdBy: z.string().trim().min(1).max(200),
  internalComment: z.string().trim().max(4_000).optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const tariffSchema = z.object({
  id: bookingIdSchema,
  organizationId: bookingIdSchema,
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4_000).optional(),
  priceMinor: z.number().int().nonnegative().safe(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .refine((currency) => currencyMinorUnitExponent(currency) !== null, {
      message: "Unknown currency",
    }),
  weeklyScheduleLimit: z.number().int().min(1).max(7),
  paymentDayOfMonth: z.number().int().min(1).max(28).optional(),
  status: z.enum(["active", "archived"]),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const weeklyScheduleSelectionSchema = z.object({
  recurrenceRuleId: bookingIdSchema,
  weekday: weekdaySchema,
});

const enrollmentBaseShape = {
  id: bookingIdSchema,
  organizationId: bookingIdSchema,
  familyId: bookingIdSchema,
  childId: bookingIdSchema,
  groupId: bookingIdSchema,
  startDate: isoDateSchema,
  endDate: isoDateSchema.optional(),
  status: z.enum(["active", "paused", "ended"]),
  source: z.enum(["staff_ui", "fizz", "import"]),
  createdBy: z.string().trim().min(1).max(200),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
};

export const enrollmentSchema = z
  .discriminatedUnion("assignmentState", [
    z.object({
      ...enrollmentBaseShape,
      assignmentState: z.literal("needs_assignment"),
      tariffId: z.never().optional(),
      weeklyScheduleSelections: z.array(weeklyScheduleSelectionSchema).max(0),
    }),
    z.object({
      ...enrollmentBaseShape,
      assignmentState: z.literal("configured"),
      tariffId: bookingIdSchema,
      weeklyScheduleSelections: z.array(weeklyScheduleSelectionSchema).min(1),
    }),
  ])
  .refine(
    ({ startDate, endDate }) => endDate === undefined || startDate <= endDate,
    { message: "Enrollment range is reversed" },
  );

export const paymentExpectationStatusSchema = z.enum([
  "expected",
  "paid",
  "cancelled",
]);

export const paymentExpectationSchema = z
  .object({
    id: bookingIdSchema,
    organizationId: bookingIdSchema,
    familyId: bookingIdSchema,
    childId: bookingIdSchema,
    enrollmentId: bookingIdSchema,
    tariffId: bookingIdSchema,
    tariffNameSnapshot: z.string().trim().min(1).max(160),
    amountMinor: z.number().int().nonnegative().safe(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .refine((currency) => currencyMinorUnitExponent(currency) !== null, {
        message: "Unknown currency",
      }),
    dueDate: isoDateSchema,
    status: paymentExpectationStatusSchema,
    paidAt: z.string().datetime({ offset: true }).optional(),
    paidBy: z.string().trim().min(1).max(200).optional(),
    cancelledAt: z.string().datetime({ offset: true }).optional(),
    cancelledBy: z.string().trim().min(1).max(200).optional(),
    internalReason: z.string().trim().min(1).max(4_000).optional(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .superRefine((payment, context) => {
    const addStatusIssue = (message: string) => {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message,
      });
    };
    if (
      payment.status === "expected" &&
      (payment.paidAt ||
        payment.paidBy ||
        payment.cancelledAt ||
        payment.cancelledBy ||
        payment.internalReason)
    ) {
      addStatusIssue("Expected payment cannot contain resolution fields");
    }
    if (
      payment.status === "paid" &&
      (!payment.paidAt ||
        !payment.paidBy ||
        payment.cancelledAt ||
        payment.cancelledBy ||
        payment.internalReason)
    ) {
      addStatusIssue("Paid payment requires paid audit fields only");
    }
    if (
      payment.status === "cancelled" &&
      (!payment.cancelledAt ||
        !payment.cancelledBy ||
        !payment.internalReason ||
        payment.paidAt ||
        payment.paidBy)
    ) {
      addStatusIssue("Cancelled payment requires cancellation audit fields");
    }
  });

export const intakeRequestSchema = z.object({
  id: bookingIdSchema,
  organizationId: bookingIdSchema,
  familyId: bookingIdSchema,
  representativeId: bookingIdSchema,
  childId: bookingIdSchema,
  branchId: bookingIdSchema.optional(),
  groupId: bookingIdSchema.optional(),
  sourceChannel: bookingSourceChannelSchema.exclude(["website", "buzz"]),
  internalComment: z.string().trim().max(4_000).optional(),
  status: z.enum(["new", "converted", "closed"]),
  bookingId: bookingIdSchema.optional(),
  createdBy: z.string().trim().min(1).max(200),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const attendanceRecordSchema = z.object({
  id: bookingIdSchema,
  organizationId: bookingIdSchema,
  childId: bookingIdSchema,
  lessonRef: stableLessonReferenceSchema,
  status: z.enum(["present", "absent"]),
  markedBy: z.string().trim().min(1).max(200),
  markedAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const pendingActionSchema = z.object({
  id: bookingIdSchema,
  organizationId: bookingIdSchema,
  command: z.object({
    type: z.string().trim().min(1).max(120),
    payload: z.record(z.string(), z.unknown()),
  }),
  expectedRevision: z.number().int().nonnegative(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  idempotencyKey: z.string().trim().min(1).max(200),
  requestedBy: z.string().trim().min(1).max(200),
  requestedThroughAgentId: z.string().trim().min(1).max(200),
  channelId: z.string().trim().min(1).max(200),
  threadId: z.string().trim().min(1).max(200),
  preview: z.object({
    locale: z.string().trim().min(2).max(32),
    title: z.string().trim().min(1).max(200),
    lines: z.array(z.string().trim().min(1).max(500)),
  }),
  status: z.enum(["pending", "committed", "cancelled", "expired", "failed"]),
  resultIds: z.array(bookingIdSchema).optional(),
  createdAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  confirmedAt: z.string().datetime({ offset: true }).optional(),
  confirmedBy: z.string().trim().min(1).max(200).optional(),
});

export const bookingWorkspaceSchema = z.object({
  schemaVersion: z.literal(8),
  revision: z.number().int().nonnegative(),
  organization: organizationSchema,
  branches: z.array(branchSchema),
  rooms: z.array(roomSchema),
  teachers: z.array(teacherSchema),
  groups: z.array(groupSchema),
  recurrenceRules: z.array(recurrenceRuleSchema),
  lessonExceptions: z.array(lessonExceptionSchema),
  families: z.array(familySchema),
  representatives: z.array(representativeSchema),
  children: z.array(childSchema),
  duplicateCandidates: z.array(duplicateCandidateSchema),
  bookings: z.array(bookingSchema),
  tariffs: z.array(tariffSchema),
  enrollments: z.array(enrollmentSchema),
  paymentExpectations: z.array(paymentExpectationSchema),
  intakeRequests: z.array(intakeRequestSchema),
  pendingActions: z.array(pendingActionSchema),
  attendanceRecords: z.array(attendanceRecordSchema),
});

export type BookingOrganization = z.infer<typeof organizationSchema>;
export type PublicBookingPurpose = z.infer<typeof publicBookingPurposeSchema>;
export type PublicBookingAppearance = z.infer<
  typeof publicBookingAppearanceSchema
>;
export type PublicBookingSettings = z.infer<typeof publicBookingSettingsSchema>;
export type BookingBranch = z.infer<typeof branchSchema>;
export type WorkingPeriod = z.infer<typeof workingPeriodSchema>;
export type WeeklyWorkingHours = z.infer<typeof weeklyWorkingHoursSchema>;
export type BookingRoom = z.infer<typeof roomSchema>;
export type BookingTeacher = z.infer<typeof teacherSchema>;
export type BookingGroup = z.infer<typeof groupSchema>;
export type RecurrenceRule = z.infer<typeof recurrenceRuleSchema>;
export type LessonException = z.infer<typeof lessonExceptionSchema>;
export type LessonOriginal = z.infer<typeof occurrenceOriginalSchema>;
export type LessonEffective = z.infer<typeof occurrenceEffectiveSchema>;
export type StableLessonReference = z.infer<typeof stableLessonReferenceSchema>;
export type PreferredContactChannel = z.infer<
  typeof preferredContactChannelSchema
>;
export type BookingFamily = z.infer<typeof familySchema>;
export type BookingRepresentative = z.infer<typeof representativeSchema>;
export type BookingChild = z.infer<typeof childSchema>;
export type BookingDuplicateCandidate = z.infer<
  typeof duplicateCandidateSchema
>;
export type BookingApplicantSnapshot = z.infer<
  typeof bookingApplicantSnapshotSchema
>;
export type BookingStatus = z.infer<typeof bookingStatusSchema>;
export type BookingVisitKind = z.infer<typeof bookingVisitKindSchema>;
export type BookingSourceChannel = z.infer<typeof bookingSourceChannelSchema>;
export type BookingTransferRequest = z.infer<
  typeof bookingTransferRequestSchema
>;
export type PublicLessonBooking = z.infer<typeof bookingSchema>;
export type BookingTariff = z.infer<typeof tariffSchema>;
export type WeeklyScheduleSelection = z.infer<
  typeof weeklyScheduleSelectionSchema
>;
export type BookingEnrollment = z.infer<typeof enrollmentSchema>;
export type ConfiguredBookingEnrollment = Extract<
  BookingEnrollment,
  { assignmentState: "configured" }
>;
export type PaymentExpectationStatus = z.infer<
  typeof paymentExpectationStatusSchema
>;
export type PaymentExpectation = z.infer<typeof paymentExpectationSchema>;
export type BookingIntakeRequest = z.infer<typeof intakeRequestSchema>;
export type BookingAttendanceRecord = z.infer<typeof attendanceRecordSchema>;
export type BookingPendingAction = z.infer<typeof pendingActionSchema>;
export type BookingWorkspace = z.infer<typeof bookingWorkspaceSchema>;
export type BookingWorkspaceDraft = Omit<BookingWorkspace, "revision">;

export function parseBookingWorkspace(input: unknown): BookingWorkspace {
  const workspace = bookingWorkspaceSchema.parse(
    migrateBookingWorkspace(input),
  );
  const issues = validateBookingWorkspaceReferences(workspace);
  if (issues.length) throw new BookingWorkspaceValidationError(issues);
  return workspace;
}
