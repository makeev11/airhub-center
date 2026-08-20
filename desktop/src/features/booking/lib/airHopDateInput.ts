export type AirHopCalendarDate = {
  day: number;
  month: number;
  year: number;
};

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function parseAirHopIsoDate(value: string): AirHopCalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month)
  ) {
    return null;
  }
  return { day, month, year };
}

export function airHopDateToIso({
  day,
  month,
  year,
}: AirHopCalendarDate): string | null {
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month)
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function formatAirHopDateInput(value: string): string {
  const parsed = parseAirHopIsoDate(value);
  if (!parsed) return "";
  return `${String(parsed.day).padStart(2, "0")}.${String(parsed.month).padStart(2, "0")}.${String(parsed.year).padStart(4, "0")}`;
}

export function airHopTodayIsoDate(now = new Date()): string {
  return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function maskAirHopDateInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  const parts = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)];
  return parts.filter(Boolean).join(".");
}

export function parseAirHopDateInput(value: string): string | null {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  if (!match) return null;
  return airHopDateToIso({
    day: Number(match[1]),
    month: Number(match[2]),
    year: Number(match[3]),
  });
}

export function isAirHopDateInRange(
  value: string,
  min?: string,
  max?: string,
): boolean {
  if (!parseAirHopIsoDate(value)) return false;
  if (min && value < min) return false;
  if (max && value > max) return false;
  return true;
}
