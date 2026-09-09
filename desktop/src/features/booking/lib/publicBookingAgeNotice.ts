import { formatBookingAgeRange } from "./bookingLocale";
import type { PublicBookingOccurrence } from "./publicBookingAvailability";
import {
  isCompletedAgePotentiallyEligible,
  isExactBirthDateEligible,
} from "../model/publicBooking";

/** Describes the recommended age without preventing a booking. */
export function publicBookingAgeNotice(
  occurrence: PublicBookingOccurrence,
  birthDate: string,
  ageYears: number,
  currentDate: string,
  locale = "ru-RU",
): string | null {
  if (
    occurrence.minAgeMonths === undefined &&
    occurrence.maxAgeMonths === undefined
  )
    return null;
  const matches = /^\d{4}-\d{2}-\d{2}$/.test(birthDate)
    ? isExactBirthDateEligible(occurrence, birthDate, occurrence.date)
    : isCompletedAgePotentiallyEligible(
        occurrence,
        ageYears,
        currentDate,
        occurrence.date,
      );
  if (matches) return null;
  const range = formatBookingAgeRange({ ...occurrence, locale });
  return `Обратите внимание: занятие «${occurrence.groupName}» больше подходит детям другого возраста (${range}).`;
}
