import { z } from "zod";
import { organizationSchema } from "@/features/booking/model/bookingCore";

const count = z.number().int().nonnegative().safe();
const signedAmount = z.number().int().safe();
const date = z.iso.date();
const currency = z.string().regex(/^[A-Z]{3}$/);

/** Shared wire contract: aggregates only, never family/child identifiers. */
export const centerAnalyticsReportSchema = z.object({
  version: z.literal(1),
  generatedAt: z.iso.datetime({ offset: true }),
  timeZone: z.string().min(1),
  periodStart: date,
  asOfDate: date,
  today: date,
  isPartial: z.boolean(),
  previousPeriodStart: date,
  previousPeriodEnd: date,
  coverage: z.object({
    firstLessonDate: date.nullable(),
    firstAttendanceDate: date.nullable(),
    attributedBookings: count,
    unattributedBookings: count,
    unmarkedLessons: count,
  }),
  cohort: z.object({
    bookings: count,
    trialBookings: count,
    confirmed: count,
    pending: count,
    cancelled: count,
    attended: count,
    enrollments: count,
    payingEnrollments: count,
  }),
  attendance: z.object({
    present: count,
    absent: count,
    children: count,
    lessons: count,
  }),
  students: z.object({
    active: count,
    paused: count,
    newEnrollments: count,
    repeatPayingEnrollments: count,
    unlinkedEnrollments: count,
    previousVisitors: count,
    returnedVisitors: count,
  }),
  days: z
    .array(z.object({ date, bookings: count, present: count }))
    .min(1)
    .max(366),
  attendanceGroups: z
    .array(
      z.object({
        groupId: z.string(),
        groupName: z.string(),
        branchId: z.string(),
        branchName: z.string(),
        present: count,
        absent: count,
        children: count,
      }),
    )
    .max(100),
  attendanceGroupsTruncated: z.boolean(),
  capacity: z.object({
    throughDate: date,
    lessons: count,
    occupied: count,
    places: count,
    unknownCapacityLessons: count,
    overbookedLessons: count,
    itemsTruncated: z.boolean(),
    items: z
      .array(
        z.object({
          recurrenceRuleId: z.string(),
          originalDate: date,
          date,
          startTime: z.string(),
          groupId: z.string(),
          groupName: z.string(),
          branchId: z.string(),
          branchName: z.string(),
          capacity: count.positive().nullable(),
          occupied: count,
        }),
      )
      .max(100),
  }),
  money: z.array(
    z.object({
      currency,
      receiptsMinor: count,
      refundsMinor: count,
      outstandingMinor: count,
      overdueMinor: count,
    }),
  ),
  sourcesTruncated: z.boolean(),
  sources: z
    .array(
      z.object({
        source: z.string(),
        trackingLinkId: z.string().nullable(),
        linkName: z.string().nullable(),
        bookings: count,
        confirmed: count,
        attended: count,
        enrollments: count,
        payingEnrollments: count,
        money: z.array(z.object({ currency, netMinor: signedAmount })),
      }),
    )
    .max(100),
});

export const staffCenterAnalyticsSchema = z.object({
  organization: organizationSchema,
  analytics: centerAnalyticsReportSchema,
});
export type CenterAnalyticsReport = z.infer<typeof centerAnalyticsReportSchema>;
export type StaffCenterAnalytics = z.infer<typeof staffCenterAnalyticsSchema>;
export type AnalyticsUntil = "today" | "yesterday";
