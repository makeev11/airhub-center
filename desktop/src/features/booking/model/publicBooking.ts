import type {
  BookingGroup,
  BookingStatus,
  PublicLessonBooking,
  StableLessonReference,
} from "@/features/booking/model/bookingCore";

export const PUBLIC_BOOKING_CONSENT_VERSION = "public-booking-v1";

const BOOKING_STATUS_TRANSITIONS: Readonly<
  Record<BookingStatus, readonly BookingStatus[]>
> = {
  pending_confirmation: [
    "confirmed",
    "rejected",
    "cancelled_by_parent",
    "cancelled_by_center",
  ],
  confirmed: ["cancelled_by_parent", "cancelled_by_center"],
  rejected: [],
  cancelled_by_parent: [],
  cancelled_by_center: [],
};

export type PublicApplicantDraft = {
  parentName: string;
  phone: string;
  childName: string;
  childBirthDate: string;
  consentAccepted: boolean;
};

export type PublicApplicantValidationIssue =
  | "parent_name_required"
  | "phone_invalid"
  | "child_name_required"
  | "birth_date_invalid"
  | "birth_date_in_future"
  | "consent_required";

/** Returns the stable identity of a recurrence occurrence. */
export function stableLessonReferenceKey(
  reference: StableLessonReference,
): string {
  return `${reference.recurrenceRuleId}:${reference.originalDate}`;
}

/** Returns whether an active booking holds capacity for a stable occurrence. */
export function bookingHoldsLessonSeat(
  booking: Pick<PublicLessonBooking, "lessonRef" | "status">,
  lessonRef: StableLessonReference,
): boolean {
  return (
    (booking.status === "pending_confirmation" ||
      booking.status === "confirmed") &&
    stableLessonReferenceKey(booking.lessonRef) ===
      stableLessonReferenceKey(lessonRef)
  );
}

/** Returns whether a persisted booking can move to the requested status. */
export function canTransitionBookingStatus(
  from: BookingStatus,
  to: BookingStatus,
): boolean {
  return from === to || BOOKING_STATUS_TRANSITIONS[from].includes(to);
}

/** Applies a validated booking status transition, preserving idempotent calls. */
export function transitionBookingStatus(
  booking: PublicLessonBooking,
  status: BookingStatus,
  updatedAt: string,
): PublicLessonBooking {
  if (!canTransitionBookingStatus(booking.status, status)) {
    throw new Error(
      `Invalid booking transition ${booking.status} -> ${status}`,
    );
  }
  const clearsTransfer =
    status === "rejected" ||
    status === "cancelled_by_parent" ||
    status === "cancelled_by_center";
  if (
    booking.status === status &&
    (!clearsTransfer || booking.transferRequest === null)
  ) {
    return booking;
  }
  return {
    ...booking,
    status,
    ...(clearsTransfer ? { transferRequest: null } : {}),
    updatedAt,
  };
}

/** Normalizes the Russian MVP phone input into an E.164-like value. */
export function normalizePublicBookingPhone(value: string): string | null {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  let normalizedDigits = digits;
  if (digits.length === 10) normalizedDigits = `7${digits}`;
  if (digits.length === 11 && digits.startsWith("8")) {
    normalizedDigits = `7${digits.slice(1)}`;
  }
  if (
    normalizedDigits.length < 10 ||
    normalizedDigits.length > 15 ||
    normalizedDigits.startsWith("0")
  ) {
    return null;
  }
  return `+${normalizedDigits}`;
}

/** Masks a normalized phone while retaining only its routing prefix and tail. */
export function maskPublicBookingPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 5) return "••••";
  const prefix = digits.slice(0, Math.min(2, digits.length - 4));
  const tail = digits.slice(-4);
  return `+${prefix} ••• ••• ${tail.slice(0, 2)} ${tail.slice(2)}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

/** Calculates completed calendar months at the lesson date. */
export function ageInMonthsOnDate(
  birthDate: string,
  lessonDate: string,
): number {
  if (!validIsoDate(birthDate) || !validIsoDate(lessonDate)) return -1;
  const [birthYear, birthMonth, birthDay] = birthDate.split("-").map(Number);
  const [lessonYear, lessonMonth, lessonDay] = lessonDate
    .split("-")
    .map(Number);
  let months = (lessonYear - birthYear) * 12 + (lessonMonth - birthMonth);
  if (lessonDay < birthDay) months -= 1;
  return months;
}

/** Checks exact-date age limits for a group on the selected lesson date. */
export function isExactBirthDateEligible(
  group: Pick<BookingGroup, "minAgeMonths" | "maxAgeMonths">,
  birthDate: string,
  lessonDate: string,
): boolean {
  const ageMonths = ageInMonthsOnDate(birthDate, lessonDate);
  if (ageMonths < 0) return false;
  if (group.minAgeMonths !== undefined && ageMonths < group.minAgeMonths) {
    return false;
  }
  return !(group.maxAgeMonths !== undefined && ageMonths > group.maxAgeMonths);
}

/**
 * Checks whether at least one exact birthday in the supplied month could fit
 * the group. The exact date is always revalidated before booking creation.
 */
export function isBirthMonthPotentiallyEligible(
  group: Pick<BookingGroup, "minAgeMonths" | "maxAgeMonths">,
  birthYear: number,
  birthMonth: number,
  lessonDate: string,
): boolean {
  if (
    !Number.isInteger(birthYear) ||
    birthYear < 1900 ||
    !Number.isInteger(birthMonth) ||
    birthMonth < 1 ||
    birthMonth > 12
  ) {
    return false;
  }
  const month = String(birthMonth).padStart(2, "0");
  const oldestAge = ageInMonthsOnDate(`${birthYear}-${month}-01`, lessonDate);
  const youngestAge = ageInMonthsOnDate(
    `${birthYear}-${month}-${daysInMonth(birthYear, birthMonth)}`,
    lessonDate,
  );
  if (oldestAge < 0 || youngestAge < 0) return false;
  const minimum = group.minAgeMonths ?? 0;
  const maximum = group.maxAgeMonths ?? Number.POSITIVE_INFINITY;
  return oldestAge >= minimum && youngestAge <= maximum;
}

function shiftIsoDateYears(value: string, years: number): string | null {
  if (!validIsoDate(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const shiftedYear = year + years;
  const shiftedDay = Math.min(day, daysInMonth(shiftedYear, month));
  return `${shiftedYear}-${String(month).padStart(2, "0")}-${String(
    shiftedDay,
  ).padStart(2, "0")}`;
}

function shiftIsoDateDays(value: string, days: number): string | null {
  if (!validIsoDate(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Checks whether a child whose completed age is selected today could fit the
 * lesson. The exact birthday is deliberately deferred to the contact step and
 * remains authoritative when the booking is created.
 */
export function isCompletedAgePotentiallyEligible(
  group: Pick<BookingGroup, "minAgeMonths" | "maxAgeMonths">,
  ageYears: number,
  referenceDate: string,
  lessonDate: string,
): boolean {
  if (
    !Number.isInteger(ageYears) ||
    ageYears < 0 ||
    ageYears > 120 ||
    !validIsoDate(referenceDate) ||
    !validIsoDate(lessonDate)
  ) {
    return false;
  }
  const youngestBirthDate = shiftIsoDateYears(referenceDate, -ageYears);
  const nextAgeBoundary = shiftIsoDateYears(referenceDate, -(ageYears + 1));
  const oldestBirthDate = nextAgeBoundary
    ? shiftIsoDateDays(nextAgeBoundary, 1)
    : null;
  if (!youngestBirthDate || !oldestBirthDate) return false;

  const oldestAge = ageInMonthsOnDate(oldestBirthDate, lessonDate);
  const youngestAge = ageInMonthsOnDate(youngestBirthDate, lessonDate);
  if (oldestAge < 0 || youngestAge < 0) return false;
  const minimum = group.minAgeMonths ?? 0;
  const maximum = group.maxAgeMonths ?? Number.POSITIVE_INFINITY;
  return oldestAge >= minimum && youngestAge <= maximum;
}

/** Validates public contact fields without returning display-ready copy. */
export function validatePublicApplicantDraft(
  draft: PublicApplicantDraft,
  maximumBirthDate?: string,
): PublicApplicantValidationIssue[] {
  const issues: PublicApplicantValidationIssue[] = [];
  if (!draft.parentName.trim()) issues.push("parent_name_required");
  if (!normalizePublicBookingPhone(draft.phone)) issues.push("phone_invalid");
  if (!draft.childName.trim()) issues.push("child_name_required");
  const birthDateValid = validIsoDate(draft.childBirthDate);
  if (!birthDateValid) issues.push("birth_date_invalid");
  else if (
    maximumBirthDate &&
    validIsoDate(maximumBirthDate) &&
    draft.childBirthDate > maximumBirthDate
  ) {
    issues.push("birth_date_in_future");
  }
  if (!draft.consentAccepted) issues.push("consent_required");
  return issues;
}
