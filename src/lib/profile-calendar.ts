import { format, parseISO, isValid } from "date-fns";

/**
 * What the calendar's details dialog shows for one entry. Everything is
 * optional: a row only carries what its source query projected, and the
 * dialog leaves out whatever is missing.
 */
export type CalendarDetails = {
  /** "volunteer" counts people, "donation" counts units. */
  subject: "volunteer" | "donation";
  description?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  requirements?: string | null;
  organisation?: string | null;
  /** Where it happens: the organisation's public address and city. */
  location?: string | null;
  /** Filled places or pledged units, against `needed`. */
  filled?: number | null;
  needed?: number | null;
  /** What this visitor pledged, on their own calendar. */
  mine?: number | null;
};

export type CalendarEntry = {
  id: string;
  title: string;
  date: string;
  time?: string | null;
  kind: "volunteer" | "donation" | "publication";
  /** Where the dialog's secondary action leads (the list the entry belongs to). */
  href: string;
  details?: CalendarDetails;
};

type CalendarNeed = {
  id: string;
  title: string;
  deadline?: string | null;
  is_fulfilled?: boolean;
  description?: string | null;
  quantity_needed?: number | null;
  quantity_pledged?: number | null;
  institution?: EmbeddedName;
};
type CalendarEvent = {
  id: string;
  title: string;
  event_date: string;
  start_time?: string | null;
  end_time?: string | null;
  description?: string | null;
  requirements?: string | null;
  location?: string | null;
  volunteers_needed?: number | null;
  volunteers_signed_up?: number | null;
  institution?: EmbeddedName;
};

/** PostgREST may answer a to-one embed as an object or a one-element list. */
type EmbeddedInstitution = { name?: string | null; address?: string | null; city?: string | null };
type EmbeddedName = EmbeddedInstitution | EmbeddedInstitution[] | null;

function embedded(value: EmbeddedName | undefined): EmbeddedInstitution | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

function embeddedName(value: EmbeddedName | undefined): string | null {
  return embedded(value)?.name ?? null;
}

function embeddedLocation(value: EmbeddedName | undefined): string | null {
  const row = embedded(value);
  return [row?.address, row?.city].filter(Boolean).join(", ") || null;
}

function needDetails(need: CalendarNeed, mine?: number | null): CalendarDetails {
  return {
    subject: "donation",
    description: need.description ?? null,
    organisation: embeddedName(need.institution),
    filled: need.quantity_pledged ?? null,
    needed: need.quantity_needed ?? null,
    mine: mine ?? null,
  };
}

function eventDetails(event: CalendarEvent): CalendarDetails {
  return {
    subject: "volunteer",
    description: event.description ?? null,
    startTime: event.start_time ?? null,
    endTime: event.end_time ?? null,
    requirements: event.requirements ?? null,
    organisation: embeddedName(event.institution),
    location: event.location || embeddedLocation(event.institution),
    filled: event.volunteers_signed_up ?? null,
    needed: event.volunteers_needed ?? null,
  };
}

/** Date-only deadlines stay date-only; publication timestamps use Croatian time. */
export function calendarDate(value?: string | null): string | null {
  if (!value) return null;
  const date = parseISO(value);
  if (!isValid(date)) return null;
  return value.includes("T")
    ? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zagreb", year: "numeric", month: "2-digit", day: "2-digit" }).format(date)
    : format(date, "yyyy-MM-dd");
}

export function individualCalendarEntries(
  pledges: { id: string; status?: string; quantity?: number | null; need?: CalendarNeed | null }[],
  signups: { id: string; event: CalendarEvent | null }[],
): CalendarEntry[] {
  const entries: CalendarEntry[] = [];
  for (const pledge of pledges) {
    const need = pledge.need;
    const date = calendarDate(need?.deadline?.slice(0, 10));
    if (!need || !date || pledge.status === "cancelled" || need.is_fulfilled) continue;
    entries.push({ id: `pledge-${pledge.id}`, title: need.title, date, kind: "donation", href: `#pledge-${pledge.id}`, details: needDetails(need, pledge.quantity) });
  }
  for (const signup of signups) {
    const event = signup.event;
    const date = calendarDate(event?.event_date);
    if (!event || !date) continue;
    entries.push({ id: `signup-${signup.id}`, title: event.title, date, time: event.start_time, kind: "volunteer", href: `#signup-${signup.id}`, details: eventDetails(event) });
  }
  return entries;
}

export function institutionCalendarEntries(
  needs: (CalendarNeed & { created_at: string })[],
  events: (CalendarEvent & { created_at: string })[],
): CalendarEntry[] {
  const entries: CalendarEntry[] = [];
  for (const need of needs) {
    const published = calendarDate(need.created_at);
    const deadline = calendarDate(need.deadline?.slice(0, 10));
    const details = needDetails(need);
    if (published) entries.push({ id: `published-need-${need.id}`, title: need.title, date: published, kind: "publication", href: "/dashboard/institution?view=pledges", details });
    if (deadline && !need.is_fulfilled) entries.push({ id: `need-${need.id}`, title: need.title, date: deadline, kind: "donation", href: "/dashboard/institution?view=pledges", details });
  }
  for (const event of events) {
    const published = calendarDate(event.created_at);
    const date = calendarDate(event.event_date);
    const details = eventDetails(event);
    if (published) entries.push({ id: `published-event-${event.id}`, title: event.title, date: published, kind: "publication", href: "/dashboard/institution?view=volunteers", details });
    if (date) entries.push({ id: `event-${event.id}`, title: event.title, date, time: event.start_time, kind: "volunteer", href: "/dashboard/institution?view=volunteers", details });
  }
  return entries;
}
