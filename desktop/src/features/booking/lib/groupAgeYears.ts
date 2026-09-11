/** Completed years for staff input; Core continues to store precise month bounds. */
export function groupAgeYears(months: number | undefined): string {
  return months === undefined ? "" : String(Math.floor(months / 12));
}

/** Preserve unchanged legacy precision; an edited maximum includes the whole year. */
export function groupAgeMonths(
  value: string,
  maximum: boolean,
  original?: number,
): number | undefined {
  if (!value.trim()) return undefined;
  if (!/^\d+$/.test(value.trim())) return Number.NaN;
  const years = Number(value);
  const months = years * 12 + (maximum ? 11 : 0);
  if (!Number.isSafeInteger(months)) return Number.NaN;
  if (original !== undefined && years === Math.floor(original / 12))
    return original;
  return months;
}

export function hasPreciseLegacyAge(
  months: number | undefined,
  maximum: boolean,
): boolean {
  return months !== undefined && months % 12 !== (maximum ? 11 : 0);
}
