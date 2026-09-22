import { format, parseISO, isValid } from "date-fns";

export type CalendarEntry = {
  id: string;
  title: string;
  date: string;
  time?: string | null;
  kind: "volunteer" | "donation" | "publication";
  href: string;
};

type CalendarNeed = { id: string; title: string; deadline?: string | null; is_fulfilled?: boolean };
type CalendarEvent = { id: string; title: string; event_date: string; start_time?: string | null };

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
  pledges: { id: string; status?: string; need?: CalendarNeed | null }[],
  signups: { id: string; event: CalendarEvent | null }[],
): CalendarEntry[] {
  const entries: CalendarEntry[] = [];
  for (const pledge of pledges) {
    const need = pledge.need;
    const date = calendarDate(need?.deadline?.slice(0, 10));
    if (!need || !date || pledge.status === "cancelled" || need.is_fulfilled) continue;
    entries.push({ id: `pledge-${pledge.id}`, title: need.title, date, kind: "donation", href: `#pledge-${pledge.id}` });
  }
  for (const signup of signups) {
    const event = signup.event;
    const date = calendarDate(event?.event_date);
    if (!event || !date) continue;
    entries.push({ id: `signup-${signup.id}`, title: event.title, date, time: event.start_time, kind: "volunteer", href: `#signup-${signup.id}` });
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
    if (published) entries.push({ id: `published-need-${need.id}`, title: need.title, date: published, kind: "publication", href: "/dashboard/institution?view=pledges" });
    if (deadline && !need.is_fulfilled) entries.push({ id: `need-${need.id}`, title: need.title, date: deadline, kind: "donation", href: "/dashboard/institution?view=pledges" });
  }
  for (const event of events) {
    const published = calendarDate(event.created_at);
    const date = calendarDate(event.event_date);
    if (published) entries.push({ id: `published-event-${event.id}`, title: event.title, date: published, kind: "publication", href: "/dashboard/institution?view=volunteers" });
    if (date) entries.push({ id: `event-${event.id}`, title: event.title, date, time: event.start_time, kind: "volunteer", href: "/dashboard/institution?view=volunteers" });
  }
  return entries;
}
