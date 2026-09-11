import { resolveAirHopLocale } from "@/shared/locale/airhopLocale";
import { messageText } from "@/shared/locale/messengerCopy";

/**
 * Shared date/time formatters for the message timeline.
 *
 * - `formatTime` — short clock time ("2:34 PM"), used in message rows.
 * - `formatFullDateTime` — verbose string for tooltips
 *   ("Wednesday, April 2, 2026 at 2:34 PM").
 * - `formatDayHeading` — label for day dividers / sticky headers.
 *   Returns "Today", "Yesterday", or a date like "Monday, March 31st".
 * - `isSameDay` — compare two unix-second timestamps.
 */

const TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

const DAY_PERIOD_SUFFIX_RE = /[\s\u00a0\u202f]*(?:AM|PM)$/i;

const FULL_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
});

const LONG_MONTH_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "long",
});

const SHORT_MONTH_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
});

// Formatting objects contain no community data and are cached by locale/options.
const localizedDateFormats = new Map<string, Intl.DateTimeFormat>();
const relativeFormats = new Map<string, Intl.RelativeTimeFormat>();
function dateFormatter(options: Intl.DateTimeFormatOptions) {
  const locale = resolveAirHopLocale();
  const key = locale + JSON.stringify(options);
  let formatter = localizedDateFormats.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    localizedDateFormats.set(key, formatter);
  }
  return formatter;
}
function relativeFormatter() {
  const locale = resolveAirHopLocale();
  let formatter = relativeFormats.get(locale);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(locale, { numeric: "always" });
    relativeFormats.set(locale, formatter);
  }
  return formatter;
}

/** Short clock time, e.g. "2:34 PM". */
export function formatTime(unixSeconds: number): string {
  return resolveAirHopLocale() === "en-US"
    ? TIME_FORMATTER.format(new Date(unixSeconds * 1_000))
    : dateFormatter({
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(unixSeconds * 1_000));
}

/** Short clock time with the AM/PM marker removed, e.g. "2:34". */
export function formatTimeWithoutDayPeriod(time: string): string {
  return time.replace(DAY_PERIOD_SUFFIX_RE, "").trim();
}

/** Full date + time for tooltips, e.g. "Wednesday, April 2, 2026 at 2:34 PM". */
export function formatFullDateTime(unixSeconds: number): string {
  return resolveAirHopLocale() === "en-US"
    ? FULL_DATE_TIME_FORMATTER.format(new Date(unixSeconds * 1_000))
    : dateFormatter({
        dateStyle: "full",
        timeStyle: "short",
      }).format(new Date(unixSeconds * 1_000));
}

/**
 * Human-friendly day label for dividers and sticky headers.
 * Returns "Today", "Yesterday", a current-year date like "Monday, March 31st",
 * or a prior-year date like "Monday, March 31st, 2025".
 */
export function formatDayHeading(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1_000);
  const now = new Date();

  if (isSameDayDate(date, now)) {
    return messageText("Today");
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDayDate(date, yesterday)) {
    return messageText("Yesterday");
  }

  if (resolveAirHopLocale() !== "en-US")
    return dateFormatter({
      weekday: "long",
      day: "numeric",
      month: "long",
      ...(date.getFullYear() !== now.getFullYear()
        ? { year: "numeric" as const }
        : {}),
    }).format(date);
  const dateLabel = `${WEEKDAY_FORMATTER.format(date)}, ${formatMonthDayOrdinal(
    date,
    LONG_MONTH_FORMATTER,
  )}`;
  return date.getFullYear() === now.getFullYear()
    ? dateLabel
    : `${dateLabel}, ${date.getFullYear()}`;
}

/** True when two unix-second timestamps fall on the same calendar day (local time). */
export function isSameDay(a: number, b: number): boolean {
  return isSameDayDate(new Date(a * 1_000), new Date(b * 1_000));
}

/**
 * Unix-seconds timestamp of local midnight for the calendar day containing
 * `unixSeconds`. Two timestamps on the same calendar day map to the same value,
 * so it is a stable identifier for a day group that does not shift when an
 * older message is prepended into that day.
 */
export function startOfLocalDaySeconds(unixSeconds: number): number {
  const date = new Date(unixSeconds * 1_000);
  date.setHours(0, 0, 0, 0);
  return Math.floor(date.getTime() / 1_000);
}

/** Short month + ordinal day, e.g. "May 19th". */
export function formatShortMonthDayOrdinal(unixSeconds: number): string {
  if (resolveAirHopLocale() !== "en-US")
    return dateFormatter({
      month: "short",
      day: "numeric",
    }).format(new Date(unixSeconds * 1000));
  return formatMonthDayOrdinal(
    new Date(unixSeconds * 1_000),
    SHORT_MONTH_FORMATTER,
  );
}

/**
 * Relative thread-summary timestamp with expanded units, e.g. "3 hours ago",
 * falling back to "on May 19th" for older replies.
 */
export function formatThreadSummaryLastReplyTime(
  unixSeconds: number,
  nowSeconds = Date.now() / 1_000,
): string {
  const diff = Math.max(0, nowSeconds - unixSeconds);

  if (diff < 60) return messageText("just now");
  if (resolveAirHopLocale() !== "en-US") {
    if (diff >= 604_800) return formatShortMonthDayOrdinal(unixSeconds);
    const unit = diff < 3600 ? "minute" : diff < 86400 ? "hour" : "day";
    return relativeFormatter().format(
      -Math.floor(
        diff / (unit === "minute" ? 60 : unit === "hour" ? 3600 : 86400),
      ),
      unit,
    );
  }
  if (diff < 3_600) return formatAgo(Math.floor(diff / 60), "minute");
  if (diff < 86_400) return formatAgo(Math.floor(diff / 3_600), "hour");
  if (diff < 604_800) return formatAgo(Math.floor(diff / 86_400), "day");

  return `on ${formatShortMonthDayOrdinal(unixSeconds)}`;
}

function isSameDayDate(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatMonthDayOrdinal(
  date: Date,
  monthFormatter: Intl.DateTimeFormat,
): string {
  return `${monthFormatter.format(date)} ${date.getDate()}${ordinalSuffix(
    date.getDate(),
  )}`;
}

function formatAgo(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? "" : "s"} ago`;
}

function ordinalSuffix(day: number): string {
  const lastTwoDigits = day % 100;
  if (lastTwoDigits >= 11 && lastTwoDigits <= 13) {
    return "th";
  }

  switch (day % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}
