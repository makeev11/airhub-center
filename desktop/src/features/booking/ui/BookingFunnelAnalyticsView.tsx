import * as React from "react";

import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import {
  aggregateBookingFunnelSegments,
  type BookingFunnelReport,
} from "@/features/booking/lib/bookingFunnelAnalytics";
import { createBookingFormatters } from "@/features/booking/lib/bookingLocale";
import type { BookingOrganization } from "@/features/booking/model/bookingCore";
import { Badge } from "@/shared/ui/badge";
import { Card } from "@/shared/ui/card";
import { Progress } from "@/shared/ui/progress";

function monthLabel(locale: string, periodStart: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${periodStart}T12:00:00Z`));
}

function percent(locale: string, value: number, total: number): string {
  if (total === 0) return "—";
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value / total);
}

function FunnelMetric({
  count,
  label,
  locale,
  total,
}: {
  count: number;
  label: string;
  locale: string;
  total: number;
}) {
  const messages = getBookingAdminMessages(locale);
  return (
    <Card className="min-w-0 space-y-2 p-4 sm:p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">
        {new Intl.NumberFormat(locale).format(count)}
      </p>
      <p className="text-xs text-muted-foreground">
        {percent(locale, count, total)} {messages.funnelShareOfCohort}
      </p>
    </Card>
  );
}

/** Cohort funnel with joint source-and-branch filters. */
export function BookingFunnelAnalyticsView({
  organization,
  report,
}: {
  organization: BookingOrganization;
  report: BookingFunnelReport;
}) {
  const messages = getBookingAdminMessages(organization.locale);
  const formatters = createBookingFormatters(organization.locale);
  const [periodStart, setPeriodStart] = React.useState(
    report.periods.at(-1)?.periodStart ?? "",
  );
  const [sourceChannel, setSourceChannel] = React.useState("");
  const [branchId, setBranchId] = React.useState("");
  const period =
    report.periods.find((candidate) => candidate.periodStart === periodStart) ??
    report.periods.at(-1);
  const sources = [
    ...new Set(period?.segments.map((segment) => segment.sourceChannel) ?? []),
  ].sort();
  const branches = new Map(
    period?.segments.map((segment) => [segment.branchId, segment.branchName]) ??
      [],
  );
  const filtered = aggregateBookingFunnelSegments(
    period?.segments ?? [],
    sourceChannel || undefined,
    branchId || undefined,
  );
  const stages = filtered.stages;
  const metricRows = [
    [messages.funnelTrialBookings, stages.trialBookings],
    [messages.funnelConfirmedTrials, stages.confirmedTrials],
    [messages.funnelAttendedTrials, stages.attendedTrials],
    [messages.funnelPermanentEnrollments, stages.permanentEnrollments],
    [messages.funnelFirstPaymentsPaid, stages.firstPaymentsPaid],
  ] as const;

  return (
    <div className="space-y-4" data-testid="airhop-booking-funnel-analytics">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {messages.funnelAsOf(formatters.date(report.asOfDate))}
        </p>
        <div className="flex flex-wrap gap-2">
          <label className="grid gap-1 text-xs text-muted-foreground">
            {messages.funnelCohort}
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
              onChange={(event) => {
                setPeriodStart(event.target.value);
                setSourceChannel("");
                setBranchId("");
              }}
              value={period?.periodStart ?? ""}
            >
              {[...report.periods].reverse().map((candidate) => (
                <option
                  key={candidate.periodStart}
                  value={candidate.periodStart}
                >
                  {monthLabel(organization.locale, candidate.periodStart)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            {messages.funnelSource}
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
              onChange={(event) => setSourceChannel(event.target.value)}
              value={sourceChannel}
            >
              <option value="">{messages.funnelAllSources}</option>
              {sources.map((source) => (
                <option key={source} value={source}>
                  {messages.funnelSourceLabel(source)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            {messages.funnelBranch}
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
              onChange={(event) => setBranchId(event.target.value)}
              value={branchId}
            >
              <option value="">{messages.funnelAllBranches}</option>
              {[...branches.entries()]
                .sort((left, right) => left[1].localeCompare(right[1]))
                .map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
            </select>
          </label>
        </div>
      </div>

      {stages.trialBookings === 0 ? (
        <Card className="space-y-2 p-8 text-center">
          <h2 className="text-lg font-semibold">
            {messages.funnelNoDataTitle}
          </h2>
          <p className="text-sm text-muted-foreground">
            {messages.funnelNoDataDescription}
          </p>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {metricRows.map(([label, count]) => (
              <FunnelMetric
                count={count}
                key={label}
                label={label}
                locale={organization.locale}
                total={stages.trialBookings}
              />
            ))}
          </div>
          {filtered.firstPaidCurrencies.length > 0 ? (
            <Card className="flex flex-wrap items-center gap-2 p-4 sm:p-5">
              <p className="mr-1 text-sm font-medium">
                {messages.funnelFirstPaymentAmount}
              </p>
              {filtered.firstPaidCurrencies.map((amount) => (
                <Badge key={amount.currency} variant="secondary">
                  {formatters.money(amount.paidMinor, amount.currency)} ·{" "}
                  {messages.analyticsPaymentsCount(amount.paidCount)}
                </Badge>
              ))}
            </Card>
          ) : null}
        </>
      )}

      <Card className="space-y-5 p-4 sm:p-5">
        <div>
          <h2 className="text-base font-semibold">
            {messages.funnelTrendTitle}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {messages.funnelTrendDescription}
          </p>
        </div>
        <div className="space-y-4">
          {report.periods.map((cohort) => {
            const cohortTotals = aggregateBookingFunnelSegments(
              cohort.segments,
              sourceChannel || undefined,
              branchId || undefined,
            ).stages;
            const share = percent(
              organization.locale,
              cohortTotals.firstPaymentsPaid,
              cohortTotals.trialBookings,
            );
            return (
              <div className="space-y-2" key={cohort.periodStart}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium capitalize">
                    {monthLabel(organization.locale, cohort.periodStart)}
                  </span>
                  <span className="tabular-nums">
                    {cohortTotals.trialBookings} →{" "}
                    {cohortTotals.firstPaymentsPaid} · {share}
                  </span>
                </div>
                <Progress
                  aria-label={`${monthLabel(organization.locale, cohort.periodStart)}: ${messages.funnelFirstPaymentsPaid}`}
                  value={
                    cohortTotals.trialBookings > 0
                      ? (cohortTotals.firstPaymentsPaid * 100) /
                        cohortTotals.trialBookings
                      : 0
                  }
                />
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
