import type {
  AnalyticsUntil,
  CenterAnalyticsReport,
} from "../data/centerAnalyticsSchema";
import type { BookingWorkspace } from "../model/bookingCore";
import { lessonOccupancy } from "../model/bookingOperations";
import {
  materializeSchedule,
  materializeScheduleOccurrence,
} from "../model/materializeSchedule";
import { organizationLocalDateTime } from "./bookingDateTime";

/** Calendar arithmetic, independent of machine timezone and DST length. */
export function shiftAnalyticsDate(date: string, days: number): string {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

/** A zero denominator means unavailable, not a zero percent conversion. */
export function analyticsShare(
  locale: string,
  numerator: number,
  denominator: number,
): string {
  return denominator
    ? new Intl.NumberFormat(locale, {
        style: "percent",
        maximumFractionDigits: 1,
      }).format(numerator / denominator)
    : "—";
}

/** Human labels never reinterpret an unknown website origin as direct traffic. */
export function analyticsSourceLabel(source: string, locale: string): string {
  const labels: Record<string, [string, string]> = {
    direct: ["Прямые заходы", "Direct visits"],
    website: ["Сайт · площадка неизвестна", "Website · origin unknown"],
    unknown: ["Источник неизвестен", "Unknown source"],
    other: ["Другой источник", "Other source"],
    yandex_maps: ["Яндекс Карты", "Yandex Maps"],
    google_maps: ["Google Maps", "Google Maps"],
    two_gis: ["2ГИС", "2GIS"],
    phone: ["Телефон", "Phone"],
    visit: ["Личное обращение", "Walk-in"],
    telegram: ["Telegram", "Telegram"],
    whatsapp: ["WhatsApp", "WhatsApp"],
    max: ["MAX", "MAX"],
    qr: ["QR-код", "QR code"],
    campaign: ["Кампания", "Campaign"],
  };
  return labels[source]?.[locale.startsWith("ru") ? 0 : 1] ?? source;
}

/** Isolated browser preview only. Never a fallback for a failed server read. */
export function buildCenterAnalyticsPreview(
  workspace: BookingWorkspace,
  days: number,
  until: AnalyticsUntil,
  now = new Date(),
): CenterAnalyticsReport {
  const zone = workspace.organization.timeZone;
  const clock = organizationLocalDateTime(zone, now);
  const today = clock.date;
  const end = shiftAnalyticsDate(today, until === "yesterday" ? -1 : 0);
  const start = shiftAnalyticsDate(end, 1 - days);
  const previousStart = shiftAnalyticsDate(start, -days);
  const localDate = (instant: string) =>
    organizationLocalDateTime(zone, new Date(instant)).date;
  const inWindow = (instant: string) =>
    localDate(instant) >= start &&
    localDate(instant) <= end &&
    new Date(instant) <= now;
  const lessons = materializeSchedule(
    workspace,
    { startsOn: previousStart, endsOn: end },
    { includeArchived: true },
  );
  const completed = lessons.filter(
    (o) =>
      o.status !== "cancelled" &&
      (o.date < today || (o.date === today && o.endTime <= clock.time)),
  );
  const marks = workspace.attendanceRecords.flatMap((a) => {
    const o = completed.find(
      (o) =>
        o.recurrenceRuleId === a.lessonRef.recurrenceRuleId &&
        o.originalDate === a.lessonRef.originalDate,
    );
    return o ? [{ ...a, occurrence: o }] : [];
  });
  const current = marks.filter((a) => a.occurrence.date >= start);
  const previousChildren = new Set(
    marks
      .filter((a) => a.occurrence.date < start && a.status === "present")
      .map((a) => a.childId),
  );
  const currentChildren = new Set(
    current.filter((a) => a.status === "present").map((a) => a.childId),
  );
  const bookings = workspace.bookings.filter((b) => inWindow(b.createdAt));
  const outcomes = bookings.map((b) => {
    const o = materializeScheduleOccurrence(
      workspace,
      b.lessonRef.recurrenceRuleId,
      b.lessonRef.originalDate,
    );
    const attended =
      o &&
      o.status !== "cancelled" &&
      (o.date < today || (o.date === today && o.endTime <= clock.time)) &&
      workspace.attendanceRecords.some(
        (a) =>
          a.childId === b.childId &&
          a.lessonRef.recurrenceRuleId === b.lessonRef.recurrenceRuleId &&
          a.lessonRef.originalDate === b.lessonRef.originalDate &&
          a.status === "present",
      );
    return {
      booking: b,
      attended: Boolean(attended),
      confirmed: b.status === "confirmed" || b.source.workflow === "direct",
    };
  });
  const upcoming = materializeSchedule(workspace, {
    startsOn: today,
    endsOn: shiftAnalyticsDate(today, 6),
  }).filter(
    (o) =>
      o.status !== "cancelled" && (o.date > today || o.startTime >= clock.time),
  );
  const capacity = upcoming.map((o) => ({
    recurrenceRuleId: o.recurrenceRuleId,
    originalDate: o.originalDate,
    date: o.date,
    startTime: o.startTime,
    groupId: o.groupId,
    groupName: workspace.groups.find((g) => g.id === o.groupId)?.name ?? "—",
    branchId: o.branchId,
    branchName:
      workspace.branches.find((b) => b.id === o.branchId)?.name ?? "—",
    capacity: o.capacity ?? null,
    occupied: lessonOccupancy(workspace, {
      groupId: o.groupId,
      date: o.date,
      lessonRef: {
        recurrenceRuleId: o.recurrenceRuleId,
        originalDate: o.originalDate,
      },
    }),
  }));
  const groups = new Map<
    string,
    CenterAnalyticsReport["attendanceGroups"][number]
  >();
  for (const a of current) {
    const o = a.occurrence;
    const key = `${o.groupId}:${o.branchId}`;
    const row = groups.get(key) ?? {
      groupId: o.groupId,
      groupName: workspace.groups.find((g) => g.id === o.groupId)?.name ?? "—",
      branchId: o.branchId,
      branchName:
        workspace.branches.find((b) => b.id === o.branchId)?.name ?? "—",
      present: 0,
      absent: 0,
      children: 0,
    };
    row[a.status] += 1;
    row.children = new Set(
      current
        .filter(
          (v) =>
            v.occurrence.groupId === o.groupId &&
            v.occurrence.branchId === o.branchId &&
            v.status === "present",
        )
        .map((v) => v.childId),
    ).size;
    groups.set(key, row);
  }
  const money = new Map<string, CenterAnalyticsReport["money"][number]>();
  for (const p of workspace.paymentExpectations) {
    const row = money.get(p.currency) ?? {
      currency: p.currency,
      receiptsMinor: 0,
      refundsMinor: 0,
      outstandingMinor: 0,
      overdueMinor: 0,
    };
    const transactions =
      p.transactions ??
      (p.status === "paid" && p.paidAt
        ? [
            {
              kind: "receipt",
              amountMinor: p.amountMinor,
              occurredAt: p.paidAt,
            },
          ]
        : []);
    let received = 0;
    for (const t of transactions) {
      if (new Date(t.occurredAt) > now) continue;
      received += t.kind === "receipt" ? t.amountMinor : -t.amountMinor;
      if (inWindow(t.occurredAt))
        row[t.kind === "receipt" ? "receiptsMinor" : "refundsMinor"] +=
          t.amountMinor;
    }
    if (p.status !== "cancelled") {
      const outstanding = Math.max(0, p.amountMinor - received);
      row.outstandingMinor += outstanding;
      if (p.dueDate < today) row.overdueMinor += outstanding;
    }
    money.set(p.currency, row);
  }
  const sources = new Map<string, CenterAnalyticsReport["sources"][number]>();
  for (const o of outcomes) {
    const source = o.booking.source.channel;
    const row = sources.get(source) ?? {
      source,
      trackingLinkId: null,
      linkName: null,
      bookings: 0,
      confirmed: 0,
      attended: 0,
      enrollments: 0,
      payingEnrollments: 0,
      money: [],
    };
    row.bookings += 1;
    row.confirmed += Number(o.confirmed);
    row.attended += Number(o.attended);
    sources.set(source, row);
  }
  return {
    version: 1,
    generatedAt: now.toISOString(),
    timeZone: zone,
    today,
    periodStart: start,
    asOfDate: end,
    isPartial: until === "today",
    previousPeriodStart: previousStart,
    previousPeriodEnd: shiftAnalyticsDate(start, -1),
    coverage: {
      firstLessonDate: lessons[0]?.date ?? null,
      firstAttendanceDate:
        marks.map((a) => a.occurrence.date).sort()[0] ?? null,
      attributedBookings: 0,
      unattributedBookings: bookings.length,
      unmarkedLessons: completed.filter(
        (o) =>
          o.date >= start &&
          o.trackAttendance &&
          !current.some((a) => a.occurrence.id === o.id),
      ).length,
    },
    cohort: {
      bookings: bookings.length,
      trialBookings: bookings.filter((b) => b.visitKind === "trial").length,
      confirmed: outcomes.filter((o) => o.confirmed).length,
      pending: bookings.filter((b) => b.status === "pending_confirmation")
        .length,
      cancelled: bookings.filter((b) => b.status.startsWith("cancelled"))
        .length,
      attended: outcomes.filter((o) => o.attended).length,
      enrollments: 0,
      payingEnrollments: 0,
    },
    attendance: {
      present: current.filter((a) => a.status === "present").length,
      absent: current.filter((a) => a.status === "absent").length,
      children: currentChildren.size,
      lessons: new Set(current.map((a) => a.occurrence.id)).size,
    },
    students: {
      active: new Set(
        workspace.enrollments
          .filter(
            (e) =>
              e.status === "active" &&
              e.assignmentState === "configured" &&
              e.startDate <= today &&
              (!e.endDate || e.endDate >= today),
          )
          .map((e) => e.childId),
      ).size,
      paused: new Set(
        workspace.enrollments
          .filter((e) => e.status === "paused")
          .map((e) => e.childId),
      ).size,
      newEnrollments: workspace.enrollments.filter((e) => inWindow(e.createdAt))
        .length,
      repeatPayingEnrollments: new Set(
        workspace.paymentExpectations
          .filter((p) => {
            const received = (payment: typeof p) =>
              payment.transactions?.reduce(
                (sum, t) =>
                  sum +
                  (new Date(t.occurredAt) <= now
                    ? t.kind === "receipt"
                      ? t.amountMinor
                      : -t.amountMinor
                    : 0),
                0,
              ) ?? (payment.status === "paid" ? payment.amountMinor : 0);
            return (
              p.status !== "cancelled" &&
              received(p) > 0 &&
              (p.transactions?.some(
                (t) => t.kind === "receipt" && inWindow(t.occurredAt),
              ) ??
                (p.status === "paid" && p.paidAt && inWindow(p.paidAt))) &&
              workspace.paymentExpectations.some(
                (earlier) =>
                  earlier.enrollmentId === p.enrollmentId &&
                  (earlier.billingPeriod ?? earlier.dueDate.slice(0, 7)) <
                    (p.billingPeriod ?? p.dueDate.slice(0, 7)) &&
                  earlier.status !== "cancelled" &&
                  received(earlier) > 0,
              )
            );
          })
          .map((p) => p.enrollmentId),
      ).size,
      unlinkedEnrollments: workspace.enrollments.filter((e) =>
        inWindow(e.createdAt),
      ).length,
      previousVisitors: previousChildren.size,
      returnedVisitors: [...previousChildren].filter((id) =>
        currentChildren.has(id),
      ).length,
    },
    days: Array.from({ length: days }, (_, i) => {
      const date = shiftAnalyticsDate(start, i);
      return {
        date,
        bookings: bookings.filter((b) => localDate(b.createdAt) === date)
          .length,
        present: current.filter(
          (a) => a.status === "present" && a.occurrence.date === date,
        ).length,
      };
    }),
    attendanceGroups: [...groups.values()].slice(0, 100),
    attendanceGroupsTruncated: groups.size > 100,
    capacity: {
      throughDate: shiftAnalyticsDate(today, 6),
      lessons: capacity.length,
      occupied: capacity
        .filter((o) => o.capacity !== null)
        .reduce((s, o) => s + o.occupied, 0),
      places: capacity.reduce((s, o) => s + (o.capacity ?? 0), 0),
      unknownCapacityLessons: capacity.filter((o) => o.capacity === null)
        .length,
      overbookedLessons: capacity.filter(
        (o) => o.capacity !== null && o.occupied > o.capacity,
      ).length,
      items: capacity.slice(0, 100),
      itemsTruncated: capacity.length > 100,
    },
    money: [...money.values()],
    sources: [...sources.values()].slice(0, 100),
    sourcesTruncated: sources.size > 100,
  };
}
