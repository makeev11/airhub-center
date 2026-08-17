import { z } from "zod";

import {
  bookingApplicantSnapshotSchema,
  bookingIdSchema,
  bookingSourceChannelSchema,
  bookingVisitKindSchema,
  isoDateSchema,
  paymentExpectationStatusSchema,
  stableLessonReferenceSchema,
  weeklyScheduleSelectionSchema,
} from "@/features/booking/model/bookingCore";

const existingClientSchema = z.object({
  mode: z.literal("existing"),
  familyId: bookingIdSchema,
  representativeId: bookingIdSchema,
  childId: bookingIdSchema,
});

const newClientSchema = z.object({
  mode: z.literal("new"),
  applicant: bookingApplicantSnapshotSchema,
});

export const airhopClientSelectorSchema = z.discriminatedUnion("mode", [
  existingClientSchema,
  newClientSchema,
]);

const staffSourceChannelSchema = bookingSourceChannelSchema.exclude([
  "website",
  "buzz",
]);

const requestFields = {
  client: airhopClientSelectorSchema,
  sourceChannel: staffSourceChannelSchema,
  internalComment: z.string().trim().max(4_000).optional(),
};

export const airhopActionCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("CreateExistingStudent"),
    client: airhopClientSelectorSchema,
    groupId: bookingIdSchema,
    tariffId: bookingIdSchema,
    weeklyScheduleSelections: z
      .array(weeklyScheduleSelectionSchema)
      .min(1)
      .max(7),
    startDate: isoDateSchema,
  }),
  z.object({
    type: z.literal("CreateTariff"),
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(4_000).optional(),
    priceMinor: z.number().int().nonnegative().safe(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    weeklyScheduleLimit: z.number().int().min(1).max(7),
    paymentDayOfMonth: z.number().int().min(1).max(28).optional(),
  }),
  z.object({
    type: z.literal("UpdateTariff"),
    tariffId: bookingIdSchema,
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(4_000).optional(),
    priceMinor: z.number().int().nonnegative().safe(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    weeklyScheduleLimit: z.number().int().min(1).max(7),
    paymentDayOfMonth: z.number().int().min(1).max(28).optional(),
  }),
  z.object({
    type: z.literal("SetTariffStatus"),
    tariffId: bookingIdSchema,
    status: z.enum(["active", "archived"]),
  }),
  z.object({
    type: z.literal("SetPaymentStatus"),
    paymentId: bookingIdSchema,
    status: paymentExpectationStatusSchema,
    internalReason: z.string().trim().min(1).max(4_000).optional(),
  }),
  z.object({
    type: z.literal("UpdatePaymentAmount"),
    paymentId: bookingIdSchema,
    amountMinor: z.number().int().nonnegative().safe(),
  }),
  z.object({
    type: z.literal("UpdatePaymentDueDate"),
    paymentId: bookingIdSchema,
    dueDate: isoDateSchema,
    internalReason: z.string().trim().min(1).max(4_000),
  }),
  z.object({
    type: z.literal("CreateBookingRequest"),
    ...requestFields,
    lessonRef: stableLessonReferenceSchema,
    visitKind: bookingVisitKindSchema,
  }),
  z.object({
    type: z.literal("CreateUnassignedRequest"),
    ...requestFields,
    branchId: bookingIdSchema.optional(),
    groupId: bookingIdSchema.optional(),
  }),
  z.object({
    type: z.literal("AddLessonParticipant"),
    ...requestFields,
    lessonRef: stableLessonReferenceSchema,
    visitKind: bookingVisitKindSchema,
    submissionMode: z.enum(["direct", "request"]),
  }),
  z.object({
    type: z.literal("MarkAttendance"),
    childId: bookingIdSchema,
    lessonRef: stableLessonReferenceSchema,
    status: z.enum(["present", "absent"]).nullable(),
  }),
]);

export const airhopActorSchema = z.object({
  userId: z.string().trim().min(1).max(200),
  surface: z.enum(["staff_ui", "fizz"]),
  agentId: z.string().trim().min(1).max(200).optional(),
  channelId: z.string().trim().min(1).max(200).optional(),
  threadId: z.string().trim().min(1).max(200).optional(),
});

export type AirhopClientSelector = z.infer<typeof airhopClientSelectorSchema>;
export type AirhopActionCommand = z.infer<typeof airhopActionCommandSchema>;
export type AirhopActor = z.infer<typeof airhopActorSchema>;

export type AirhopActionContext = {
  now: string;
  idempotencyKey: string;
  idFactory: () => string;
  digest: (value: string) => string;
};

export type AirhopActionResult = {
  commandType: AirhopActionCommand["type"];
  entityIds: string[];
};

export type AirhopActionPreview = {
  locale: string;
  title: string;
  lines: string[];
};
