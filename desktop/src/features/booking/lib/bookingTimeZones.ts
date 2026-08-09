import { isValidTimeZone } from "@/features/booking/model/bookingOperationalValidation";

export const AUTO_BOOKING_TIME_ZONE_VALUE = "__auto__";
export const DEFAULT_BOOKING_TIME_ZONE = "Europe/Moscow";

export function detectBookingTimeZone(
  resolve: () => unknown = () =>
    Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  try {
    const value = resolve();
    const normalized = typeof value === "string" ? value.trim() : "";
    return normalized && isValidTimeZone(normalized)
      ? normalized
      : DEFAULT_BOOKING_TIME_ZONE;
  } catch {
    return DEFAULT_BOOKING_TIME_ZONE;
  }
}

function supportedBookingTimeZones(): readonly string[] {
  try {
    return typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [];
  } catch {
    return [];
  }
}

export function bookingTimeZoneOptions(
  current: string,
  supported: Iterable<string> = supportedBookingTimeZones(),
): string[] {
  const values = [
    ...supported,
    current,
    detectBookingTimeZone(),
    DEFAULT_BOOKING_TIME_ZONE,
    "UTC",
  ];
  const valid = values.flatMap((value) => {
    const normalized = value.trim();
    return normalized !== AUTO_BOOKING_TIME_ZONE_VALUE &&
      isValidTimeZone(normalized)
      ? [normalized]
      : [];
  });

  return [...new Set(valid)].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
}
