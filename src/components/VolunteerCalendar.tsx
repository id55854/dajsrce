"use client";

import { useMemo, useState } from "react";
import {
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import clsx from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";

type Event = {
  id: string;
  title: string;
  event_date: string;
  start_time: string;
};

export type VolunteerCalendarProps = {
  events: Event[];
  registeredEventIds: Set<string>;
  /** Called when the user clicks a day with at least one event. */
  onDayClick?: (date: string, eventIds: string[]) => void;
};

export function VolunteerCalendar({
  events,
  registeredEventIds,
  onDayClick,
}: VolunteerCalendarProps) {
  const [cursor, setCursor] = useState<Date>(() => {
    // Start on the month containing the earliest upcoming event, or today if none.
    if (events.length === 0) return startOfMonth(new Date());
    const sorted = [...events].sort((a, b) =>
      a.event_date.localeCompare(b.event_date)
    );
    return startOfMonth(parseISO(sorted[0].event_date));
  });

  const eventsByDate = useMemo(() => {
    const map = new Map<string, Event[]>();
    for (const ev of events) {
      const arr = map.get(ev.event_date) ?? [];
      arr.push(ev);
      map.set(ev.event_date, arr);
    }
    return map;
  }, [events]);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
    const out: Date[] = [];
    for (let d = start; d <= end; d = new Date(d.getTime() + 24 * 60 * 60 * 1000)) {
      out.push(d);
    }
    return out;
  }, [cursor]);

  const todayIso = format(new Date(), "yyyy-MM-dd");

  const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <section
      className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-5"
      aria-label="Volunteer events calendar"
    >
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          {format(cursor, "MMMM yyyy")}
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCursor((c) => addMonths(c, -1))}
            className="rounded-full p-1.5 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setCursor(startOfMonth(new Date()))}
            className="rounded-full px-3 py-1 text-xs font-semibold text-gray-600 transition hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setCursor((c) => addMonths(c, 1))}
            className="rounded-full p-1.5 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </header>

      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {weekdayLabels.map((label) => (
          <div key={label}>{label}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const iso = format(day, "yyyy-MM-dd");
          const inMonth = isSameMonth(day, cursor);
          const dayEvents = eventsByDate.get(iso) ?? [];
          const hasEvents = dayEvents.length > 0;
          const hasRegistered = dayEvents.some((e) =>
            registeredEventIds.has(e.id)
          );
          const isToday = iso === todayIso;
          const dayNumber = format(day, "d");

          const tooltip = hasEvents
            ? dayEvents
                .slice(0, 3)
                .map((e) => `${e.start_time?.slice(0, 5) ?? ""} ${e.title}`.trim())
                .join("\n") + (dayEvents.length > 3 ? `\n+${dayEvents.length - 3} more` : "")
            : "";

          const Tag = hasEvents ? "button" : "div";

          return (
            <Tag
              key={iso}
              {...(hasEvents
                ? {
                    type: "button" as const,
                    onClick: () => onDayClick?.(iso, dayEvents.map((e) => e.id)),
                    title: tooltip,
                    "aria-label": `${dayEvents.length} event${dayEvents.length === 1 ? "" : "s"} on ${format(day, "EEEE, MMMM d")}${hasRegistered ? " (you are registered)" : ""}`,
                  }
                : {
                    "aria-hidden": true as const,
                  })}
              className={clsx(
                "relative aspect-square min-h-[40px] rounded-lg p-1 text-[12px] transition",
                !inMonth && "opacity-40",
                hasEvents && "cursor-pointer",
                hasRegistered
                  ? "border-2 border-emerald-400 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 dark:border-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-100"
                  : hasEvents
                  ? "border border-red-200 bg-red-50/70 text-red-900 hover:bg-red-100/80 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100"
                  : "border border-transparent text-gray-400 dark:text-gray-600",
                isToday && "ring-2 ring-blue-400 ring-offset-1 dark:ring-blue-500"
              )}
            >
              <span className="block text-left font-semibold">{dayNumber}</span>
              {hasEvents ? (
                <span className="absolute bottom-1 left-1 right-1 flex items-center justify-center gap-0.5">
                  {dayEvents.slice(0, 3).map((e) => (
                    <span
                      key={e.id}
                      className={clsx(
                        "h-1.5 w-1.5 rounded-full",
                        registeredEventIds.has(e.id)
                          ? "bg-emerald-500"
                          : "bg-red-400"
                      )}
                      aria-hidden
                    />
                  ))}
                  {dayEvents.length > 3 ? (
                    <span className="ml-0.5 text-[9px] font-bold leading-none text-gray-500 dark:text-gray-400">
                      +
                    </span>
                  ) : null}
                </span>
              ) : null}
            </Tag>
          );
        })}
      </div>

      <footer className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-red-400" aria-hidden />
          Event
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
          You&rsquo;re registered
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-blue-400 ring-2 ring-blue-400/50" aria-hidden />
          Today
        </span>
      </footer>
    </section>
  );
}
