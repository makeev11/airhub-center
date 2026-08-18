import type {
  StaffBookingFunnelAnalytics,
  StaffBookingFunnelPeriod,
  StaffBookingFunnelSegment,
  StaffBookingFunnelStages,
} from "@/features/booking/data/staffPaymentService";
import { organizationLocalDateTime } from "@/features/booking/lib/bookingDateTime";
import type { BookingWorkspace } from "@/features/booking/model/bookingCore";
import { materializeScheduleOccurrence } from "@/features/booking/model/materializeSchedule";

export type BookingFunnelReport = StaffBookingFunnelAnalytics["analytics"];

function monthStart(year: number, monthIndex: number): string {
  const normalizedYear = year + Math.floor(monthIndex / 12);
  const normalizedMonth = ((monthIndex % 12) + 12) % 12;
  return `${normalizedYear}-${String(normalizedMonth + 1).padStart(2, "0")}-01`;
}

function sixPeriodsEndingAt(asOfDate: string): string[] {
  const year = Number(asOfDate.slice(0, 4));
  const monthIndex = Number(asOfDate.slice(5, 7)) - 1;
  return Array.from({ length: 6 }, (_, index) =>
    monthStart(year, monthIndex - 5 + index),
  );
}

function emptyStages(): StaffBookingFunnelStages {
  return {
    trialBookings: 0,
    confirmedTrials: 0,
    attendedTrials: 0,
    permanentEnrollments: 0,
    firstPaymentsPaid: 0,
  };
}

function addStages(
  target: StaffBookingFunnelStages,
  source: StaffBookingFunnelStages,
) {
  target.trialBookings += source.trialBookings;
  target.confirmedTrials += source.confirmedTrials;
  target.attendedTrials += source.attendedTrials;
  target.permanentEnrollments += source.permanentEnrollments;
  target.firstPaymentsPaid += source.firstPaymentsPaid;
}

function currencyTotals(segments: StaffBookingFunnelSegment[]) {
  const totals = new Map<string, { paidCount: number; paidMinor: number }>();
  for (const segment of segments) {
    for (const amount of segment.firstPaidCurrencies) {
      const total = totals.get(amount.currency) ?? {
        paidCount: 0,
        paidMinor: 0,
      };
      total.paidCount += amount.paidCount;
      total.paidMinor += amount.paidMinor;
      totals.set(amount.currency, total);
    }
  }
  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, total]) => ({ currency, ...total }));
}

/** Recalculates visible totals from joint source-and-branch segments. */
export function aggregateBookingFunnelSegments(
  segments: StaffBookingFunnelSegment[],
  sourceChannel?: string,
  branchId?: string,
) {
  const selected = segments.filter(
    (segment) =>
      (!sourceChannel || segment.sourceChannel === sourceChannel) &&
      (!branchId || segment.branchId === branchId),
  );
  const stages = emptyStages();
  for (const segment of selected) addStages(stages, segment.stages);
  return { stages, firstPaidCurrencies: currencyTotals(selected) };
}

function emptyPeriod(periodStart: string): StaffBookingFunnelPeriod {
  return {
    periodStart,
    stages: emptyStages(),
    firstPaidCurrencies: [],
    segments: [],
  };
}

/** Builds the preview-only equivalent of the authoritative cohort read model. */
export function buildBookingFunnelAnalytics(
  workspace: BookingWorkspace,
  asOfDate: string,
): BookingFunnelReport {
  const periods = sixPeriodsEndingAt(asOfDate).map(emptyPeriod);
  const periodByStart = new Map(
    periods.map((period) => [period.periodStart, period] as const),
  );
  const branches = new Map(
    workspace.branches.map((branch) => [branch.id, branch] as const),
  );
  const segments = new Map<string, StaffBookingFunnelSegment>();

  for (const booking of workspace.bookings) {
    if (booking.visitKind !== "trial") continue;
    const createdDate = organizationLocalDateTime(
      workspace.organization.timeZone,
      new Date(booking.createdAt),
    ).date;
    const periodStart = `${createdDate.slice(0, 7)}-01`;
    const period = periodByStart.get(periodStart);
    if (!period) continue;
    const occurrence = materializeScheduleOccurrence(
      workspace,
      booking.lessonRef.recurrenceRuleId,
      booking.lessonRef.originalDate,
    );
    if (!occurrence) continue;
    const branch = branches.get(occurrence.branchId);
    if (!branch) continue;

    const segmentKey = `${periodStart}:${booking.source.channel}:${branch.id}`;
    let segment = segments.get(segmentKey);
    if (!segment) {
      segment = {
        sourceChannel: booking.source.channel,
        branchId: branch.id,
        branchName: branch.name,
        stages: emptyStages(),
        firstPaidCurrencies: [],
      };
      segments.set(segmentKey, segment);
      period.segments.push(segment);
    }

    segment.stages.trialBookings += 1;
    if (
      booking.source.workflow === "direct" ||
      booking.status === "confirmed"
    ) {
      segment.stages.confirmedTrials += 1;
    }
    const attended = workspace.attendanceRecords.some(
      (record) =>
        record.childId === booking.childId &&
        record.lessonRef.recurrenceRuleId ===
          booking.lessonRef.recurrenceRuleId &&
        record.lessonRef.originalDate === booking.lessonRef.originalDate &&
        record.status === "present",
    );
    if (attended) segment.stages.attendedTrials += 1;

    // Browser previews do not retain domain events, so use the first matching
    // configured enrollment after the trial booking as the closest equivalent.
    const enrollment = workspace.enrollments
      .filter(
        (candidate) =>
          candidate.assignmentState === "configured" &&
          candidate.childId === booking.childId &&
          candidate.groupId === occurrence.groupId &&
          candidate.createdAt >= booking.createdAt,
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
    if (!enrollment) continue;
    segment.stages.permanentEnrollments += 1;

    const firstPayment = workspace.paymentExpectations
      .filter((payment) => payment.enrollmentId === enrollment.id)
      .sort((left, right) => {
        const leftPeriod = left.billingPeriod ?? left.dueDate;
        const rightPeriod = right.billingPeriod ?? right.dueDate;
        return (
          leftPeriod.localeCompare(rightPeriod) ||
          left.createdAt.localeCompare(right.createdAt) ||
          left.id.localeCompare(right.id)
        );
      })[0];
    if (firstPayment?.status !== "paid") continue;
    segment.stages.firstPaymentsPaid += 1;
    const amount = segment.firstPaidCurrencies.find(
      ({ currency }) => currency === firstPayment.currency,
    );
    if (amount) {
      amount.paidCount += 1;
      amount.paidMinor += firstPayment.amountMinor;
    } else {
      segment.firstPaidCurrencies.push({
        currency: firstPayment.currency,
        paidCount: 1,
        paidMinor: firstPayment.amountMinor,
      });
    }
  }

  for (const period of periods) {
    period.segments.sort(
      (left, right) =>
        left.sourceChannel.localeCompare(right.sourceChannel) ||
        left.branchName.localeCompare(right.branchName) ||
        left.branchId.localeCompare(right.branchId),
    );
    const total = aggregateBookingFunnelSegments(period.segments);
    period.stages = total.stages;
    period.firstPaidCurrencies = total.firstPaidCurrencies;
  }
  return { asOfDate, periods };
}
