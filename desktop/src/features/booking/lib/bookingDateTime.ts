export type OrganizationLocalDateTime = {
  date: string;
  time: string;
};

/** Formats an instant into sortable local calendar fields for an organization. */
export function organizationLocalDateTime(
  timeZone: string,
  instant: Date,
): OrganizationLocalDateTime {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(instant)
      .filter(({ type }) =>
        ["year", "month", "day", "hour", "minute"].includes(type),
      )
      .map(({ type, value }) => [type, value]),
  );
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
  };
}

/** Shifts an ISO calendar date without applying the host time zone. */
export function shiftBookingIsoDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
