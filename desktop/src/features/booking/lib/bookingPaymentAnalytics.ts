import type { StaffPaymentAnalytics } from "@/features/booking/data/staffPaymentService";
import type { PaymentExpectation } from "@/features/booking/model/bookingCore";

export type PaymentAnalyticsReport = StaffPaymentAnalytics["analytics"];
export type PaymentAnalyticsCurrency =
  PaymentAnalyticsReport["currencies"][number];
export type PaymentAnalyticsPeriod =
  PaymentAnalyticsCurrency["periods"][number];

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

function emptyPeriod(periodStart: string): PaymentAnalyticsPeriod {
  return {
    periodStart,
    scheduledCount: 0,
    scheduledMinor: 0,
    paidCount: 0,
    paidMinor: 0,
    outstandingCount: 0,
    outstandingMinor: 0,
    overdueCount: 0,
    overdueMinor: 0,
    cancelledCount: 0,
    cancelledMinor: 0,
    paidShareBps: null,
  };
}

/** Builds the preview-only equivalent of the authoritative server read model. */
export function buildPaymentAnalytics(
  payments: PaymentExpectation[],
  asOfDate: string,
): PaymentAnalyticsReport {
  const periodStarts = sixPeriodsEndingAt(asOfDate);
  const firstPeriod = periodStarts[0];
  const lastPeriod = periodStarts.at(-1) ?? firstPeriod;
  const currencies = [...new Set(payments.map((payment) => payment.currency))]
    .sort()
    .map<PaymentAnalyticsCurrency>((currency) => {
      const currencyPayments = payments.filter(
        (payment) => payment.currency === currency,
      );
      const periods = periodStarts.map(emptyPeriod);
      const byStart = new Map(
        periods.map((period) => [period.periodStart, period] as const),
      );

      for (const payment of currencyPayments) {
        const billingPeriod =
          payment.billingPeriod ?? `${payment.dueDate.slice(0, 7)}-01`;
        if (billingPeriod < firstPeriod || billingPeriod > lastPeriod) continue;
        const period = byStart.get(billingPeriod);
        if (!period) continue;
        if (payment.status === "cancelled") {
          period.cancelledCount += 1;
          period.cancelledMinor += payment.amountMinor;
          continue;
        }
        period.scheduledCount += 1;
        period.scheduledMinor += payment.amountMinor;
        if (payment.status === "paid") {
          period.paidCount += 1;
          period.paidMinor += payment.amountMinor;
        } else {
          period.outstandingCount += 1;
          period.outstandingMinor += payment.amountMinor;
          if (payment.dueDate < asOfDate) {
            period.overdueCount += 1;
            period.overdueMinor += payment.amountMinor;
          }
        }
      }
      for (const period of periods) {
        period.paidShareBps =
          period.scheduledMinor > 0
            ? Math.floor((period.paidMinor * 10_000) / period.scheduledMinor)
            : null;
      }

      const open = currencyPayments.filter(
        (payment) => payment.status === "expected",
      );
      const overdue = open.filter((payment) => payment.dueDate < asOfDate);
      return {
        currency,
        openCount: open.length,
        openMinor: open.reduce(
          (total, payment) => total + payment.amountMinor,
          0,
        ),
        overdueCount: overdue.length,
        overdueMinor: overdue.reduce(
          (total, payment) => total + payment.amountMinor,
          0,
        ),
        periods,
      };
    });
  return { asOfDate, currencies };
}
