import { shiftBookingIsoDate } from "@/features/booking/lib/bookingDateTime";

function isoDate(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

/** Returns the next payment-day occurrence strictly after the current date. */
export function nextEnrollmentBillingDate(
  currentDate: string,
  paymentDayOfMonth: number,
): string {
  const year = Number(currentDate.slice(0, 4));
  const month = Number(currentDate.slice(5, 7));
  const day = Number(currentDate.slice(8, 10));
  const paymentDay = Math.min(28, Math.max(1, paymentDayOfMonth));
  if (day < paymentDay) return isoDate(year, month, paymentDay);
  const next = new Date(Date.UTC(year, month, 1, 12));
  return isoDate(next.getUTCFullYear(), next.getUTCMonth() + 1, paymentDay);
}

/** Prevents a tariff segment from starting before the existing one has a day. */
export function minimumTariffTransitionDate(
  enrollmentStartDate: string,
  currentDate: string,
): string {
  const afterStart = shiftBookingIsoDate(enrollmentStartDate, 1);
  return afterStart > currentDate ? afterStart : currentDate;
}
