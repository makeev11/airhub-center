import { z } from "zod";
const count = z.number().int().nonnegative().safe();
/** Fixed observation window; version comparisons are observational, never causal. */
export const consultationLearningSchema = z.object({
  windowDays: z.literal(7),
  comparison: z.literal("observational"),
  metric: z.literal("booking_created_within_7_days"),
  scope: z.enum(["organization_aggregate", "accessible_channels"]),
  eligible: count,
  booked: count,
  pending: count,
  mixed: count,
  unattributed: count,
  versionsTruncated: z.boolean(),
  versions: z
    .array(
      z.object({
        configuration: z.record(z.string(), z.unknown()),
        firstStartedAt: z.iso.datetime({ offset: true }),
        lastStartedAt: z.iso.datetime({ offset: true }),
        started: count,
        eligible: count,
        booked: count,
        pending: count,
        handedOff: count,
        declined: count,
        draftCancelled: count,
        bookingCancelledNow: count,
        bookingRejectedNow: count,
        segments: z.array(
          z.object({
            branchName: z.string().nullable(),
            provider: z.string().nullable(),
            familyLinked: z.boolean(),
            eligible: count,
            booked: count,
          }),
        ),
      }),
    )
    .max(20),
});
export const consultationQuestionSchema = z.enum([
  "age",
  "branch",
  "activity",
  "time",
  "contact",
  "confirmation",
  "other",
]);
export const consultationStatusSchema = z.enum([
  "waiting",
  "quiet",
  "agent_waiting",
  "with_staff",
  "booked",
  "declined",
  "cancelled",
  "delivery_issue",
  "delivery_pending",
  "ongoing",
]);
/** Membership-fenced report; historical uninstrumented dialogues are not inferred. */
export const consultationAnalyticsSchema = z.object({
  version: z.literal(1),
  generatedAt: z.iso.datetime({ offset: true }),
  quietHours: z.literal(48),
  learning: consultationLearningSchema.optional(),
  untrackedConversations: count,
  summary: z.object({
    started: count,
    booked: count,
    waiting: count,
    quiet: count,
    agentWaiting: count,
    withStaff: count,
    declined: count,
    cancelled: count,
    delivery: count,
    ongoing: count,
  }),
  stages: z
    .array(
      z.object({
        key: z.enum([
          "started",
          "group",
          "time",
          "details",
          "confirmation",
          "booked",
        ]),
        reached: count,
      }),
    )
    .length(6),
  questions: z
    .array(
      z.object({
        key: consultationQuestionSchema,
        asked: count,
        answered: count,
        waiting: count,
        quiet: count,
      }),
    )
    .length(7),
  itemsTruncated: z.boolean(),
  items: z
    .array(
      z.object({
        id: z.uuid(),
        conversationId: z.uuid(),
        channelId: z.uuid(),
        rootEventId: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .nullable(),
        title: z.string(),
        branchName: z.string().nullable(),
        connectionName: z.string().nullable(),
        provider: z.string().nullable(),
        startedAt: z.iso.datetime({ offset: true }),
        status: consultationStatusSchema,
        question: consultationQuestionSchema.nullable(),
        questionEventId: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .nullable(),
        waitingSince: z.iso.datetime({ offset: true }).nullable(),
        bookingId: z.uuid().nullable(),
      }),
    )
    .max(200),
});
export type ConsultationAnalytics = z.infer<typeof consultationAnalyticsSchema>;
export type ConsultationQuestion = z.infer<typeof consultationQuestionSchema>;
export type ConsultationStatus = z.infer<typeof consultationStatusSchema>;
