const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse a real Gregorian calendar date without JavaScript date normalization. */
export function parseISODate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const match = ISO_DATE.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return raw;
}

export function utcPeriodBounds(start: string, end: string): { from: string; to: string } {
  return {
    from: `${start}T00:00:00.000Z`,
    to: `${end}T23:59:59.999Z`,
  };
}
