"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addMonths,
  addDays,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import clsx from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { enUS, hr } from "date-fns/locale";
import { useLocale, useT } from "@/i18n/client";
import { Button } from "@/components/ui";

type Event = {
  id: string;
  title: string;
  event_date: string;
  start_time: string;
};

/**
 * The primitives have no icon-only size (Button's `md` is 44px tall but 40px
 * of horizontal padding wide), so this mirrors the ghost variant as a square
 * 44px target, up from the 28px these arrows used to be.
 */
const NAV_BUTTON =
  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-secondary transition-[background-color,color,transform] duration-150 ease-out hover:bg-surface-sunken hover:text-ink motion-safe:active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

export type VolunteerCalendarProps = {
  events: Event[];
  registeredEventIds: Set<string>;
  /** Called when the user clicks a day with at least one event. */
  selectedDate?: string | null;
  framed?: boolean;
  activityMode?: boolean;
  initialMonth?: string;
  onMonthChange?: (month: string) => void;
  onDayClick?: (date: string, eventIds: string[]) => void;
};

export function VolunteerCalendar({
  events,
  registeredEventIds,
  onDayClick,
  selectedDate,
  framed = true,
  activityMode = false,
  initialMonth,
  onMonthChange,
}: VolunteerCalendarProps) {
  const t = useT();
  const { locale } = useLocale();
  const dateLocale = locale === "hr" ? hr : enUS;
  const [cursor, setCursor] = useState<Date>(() => {
    if (initialMonth) return startOfMonth(parseISO(`${initialMonth}-01`));
    if (selectedDate) return startOfMonth(parseISO(selectedDate));
    return startOfMonth(new Date());
  });

  // Month navigation used to replace the whole grid in one frame, with nothing
  // to say which way time moved. The new grid now arrives from the side the
  // user travelled towards.
  const [direction, setDirection] = useState<1 | -1>(1);
  const [entering, setEntering] = useState(false);

  const goToMonth = useCallback((next: Date, dir: 1 | -1) => {
    setDirection(dir);
    setCursor(next);
    onMonthChange?.(format(next, "yyyy-MM"));
    setEntering(true);
  }, [onMonthChange]);

  useEffect(() => {
    if (!entering) return;
    // Two frames on purpose: a single requestAnimationFrame can be coalesced
    // into the same paint as the state change, which leaves the "from" state
    // never rendered and the transition never running.
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setEntering(false));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [entering]);

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
    for (let d = start; d <= end; d = addDays(d, 1)) {
      out.push(d);
    }
    return out;
  }, [cursor]);

  const todayIso = format(new Date(), "yyyy-MM-dd");

  const weekdayLabels = useMemo(() => {
    return Array.from({ length: 7 }, (_, index) =>
      format(new Date(2024, 0, 1 + index), "EEE", { locale: dateLocale })
    );
  }, [dateLocale]);

  return (
    <div
      role="region"
      aria-label={t(activityMode ? "profile_calendar.title" : "volunteer_calendar.aria_label")}
      className={clsx("w-full max-w-sm", framed && "rounded-card border border-border-subtle bg-surface-raised p-4 shadow-raised")}
    >
      <header className="mb-3 flex flex-wrap items-center justify-between gap-1">
        <h2 className="text-sm font-semibold text-ink">
          {format(cursor, "LLLL yyyy", { locale: dateLocale })}
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={NAV_BUTTON}
            onClick={() => goToMonth(addMonths(cursor, -1), -1)}
            aria-label={t("volunteer_calendar.previous_month")}
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const next = startOfMonth(new Date());
              goToMonth(next, next < cursor ? -1 : 1);
            }}
          >
            {t("volunteer_calendar.today")}
          </Button>
          <button
            type="button"
            className={NAV_BUTTON}
            onClick={() => goToMonth(addMonths(cursor, 1), 1)}
            aria-label={t("volunteer_calendar.next_month")}
          >
            <ChevronRight className="h-5 w-5" aria-hidden />
          </button>
        </div>
      </header>

      <div
        className={clsx(
          "transition-[opacity,transform] duration-250 ease-out",
          entering
            ? clsx(
                "opacity-0",
                direction === 1
                  ? "motion-safe:translate-x-4"
                  : "motion-safe:-translate-x-4"
              )
            : "translate-x-0 opacity-100"
        )}
      >
        <div className="mb-1 grid grid-cols-7 gap-1 text-center text-xs font-medium uppercase tracking-wide text-ink-tertiary">
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
                  .join("\n") +
                  (dayEvents.length > 3
                    ? `\n+${dayEvents.length - 3} ${t("volunteer_calendar.more")}`
                    : "")
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
                      "aria-pressed": iso === selectedDate,
                      "aria-label": `${t(
                        dayEvents.length === 1
                          ? (activityMode ? "profile_calendar.activities_one" : "volunteer_calendar.events_one")
                          : (activityMode ? "profile_calendar.activities_many" : "volunteer_calendar.events_many"),
                        {
                          count: dayEvents.length,
                          date: format(day, "PPPP", { locale: dateLocale }),
                        }
                      )}${hasRegistered && !activityMode ? t("volunteer_calendar.registered_suffix") : ""}`,
                    }
                  : {
                      "aria-hidden": true as const,
                    })}
                className={clsx(
                  // 44px floor: these were 40px, and they are the primary
                  // touch target of the whole calendar.
                  "relative h-11 min-w-0 rounded-control p-1 text-sm",
                  "transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out",
                  !inMonth && "opacity-40",
                  hasEvents &&
                    "cursor-pointer motion-safe:active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
                  hasRegistered
                    ? "border-2 border-success bg-success-soft text-success-on-soft hover:brightness-[0.97]"
                    : hasEvents
                      ? "border border-brand/40 bg-brand-soft text-brand-on-soft hover:brightness-[0.97]"
                      : "border border-transparent text-ink-tertiary",
                  iso === selectedDate && "ring-2 ring-brand ring-offset-1",
                  isToday && "ring-2 ring-info ring-offset-1 ring-offset-surface"
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
                            ? "bg-success"
                            : "bg-brand"
                        )}
                        aria-hidden
                      />
                    ))}
                    {dayEvents.length > 3 ? (
                      <span className="ml-0.5 text-[0.625rem] font-bold leading-none text-ink-tertiary">
                        +
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </Tag>
            );
          })}
        </div>
      </div>

      <footer className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-tertiary">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-brand" aria-hidden />
          {t(activityMode ? "profile_calendar.activity" : "volunteer_calendar.event")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-success" aria-hidden />
          {t(activityMode ? "profile_calendar.donation" : "volunteer_calendar.registered")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full bg-info ring-2 ring-info/50"
            aria-hidden
          />
          {t("volunteer_calendar.today")}
        </span>
      </footer>
    </div>
  );
}
