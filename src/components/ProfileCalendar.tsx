"use client";

import { useCallback, useId, useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { hr, enUS } from "date-fns/locale";
import { useLocale, useT } from "@/i18n/client";
import type { CalendarEntry } from "@/lib/profile-calendar";
import { VolunteerCalendar } from "./VolunteerCalendar";
import { Button, Card, SectionHeader, Skeleton } from "./ui";

export function ProfileCalendar({ entries, loading = false, error = false, onRetry, institution = false, truncated = false }: {
  entries: CalendarEntry[];
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  institution?: boolean;
  truncated?: boolean;
}) {
  const t = useT();
  const { locale } = useLocale();
  const headingId = useId();
  const [month, setMonth] = useState(() => format(new Date(), "yyyy-MM"));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const onMonthChange = useCallback((value: string) => { setMonth(value); setSelectedDate(null); }, []);
  const visible = entries.filter((entry) => selectedDate ? entry.date === selectedDate : entry.date.startsWith(month))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "") || a.title.localeCompare(b.title));
  const dateLocale = locale === "hr" ? hr : enUS;

  return (
    <Card aria-labelledby={headingId}>
      <SectionHeader id={headingId} title={t(institution ? "profile_calendar.institution_title" : "profile_calendar.title")} description={t(institution ? "profile_calendar.institution_hint" : "profile_calendar.individual_hint")} />
      {loading ? <Skeleton className="h-80 rounded-card" /> : error ? (
        <div role="alert" className="space-y-3">
          <p className="text-sm text-ink-secondary">{t("profile_calendar.error")}</p>
          {onRetry ? <Button variant="secondary" onClick={onRetry}>{t("errors.retry")}</Button> : null}
        </div>
      ) : (
        <div className="grid items-start gap-6 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <VolunteerCalendar
            framed={false}
            activityMode
            initialMonth={month}
            events={entries.map((entry) => ({ id: entry.id, title: `${t(`profile_calendar.${entry.kind}`)}: ${entry.title}`, event_date: entry.date, start_time: entry.time ?? "" }))}
            registeredEventIds={new Set(entries.filter((entry) => entry.kind === "donation").map((entry) => entry.id))}
            selectedDate={selectedDate}
            onMonthChange={onMonthChange}
            onDayClick={(date) => setSelectedDate((current) => current === date ? null : date)}
          />
          <div className="min-w-0">
            <div className="mb-3 flex min-h-11 items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink">{selectedDate ? format(parseISO(selectedDate), "d. MMMM", { locale: dateLocale }) : t("profile_calendar.month_summary")}</h3>
              {selectedDate ? <Button size="sm" variant="ghost" onClick={() => setSelectedDate(null)}>{t("profile_calendar.whole_month")}</Button> : null}
            </div>
            <div aria-live="polite">
              {visible.length ? (
                <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
                  {visible.map((entry) => (
                    <li key={entry.id}>
                      <Link href={entry.href} className="block rounded-control border border-border-subtle p-3 transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                        <span className="text-xs font-medium text-ink-secondary">{t(`profile_calendar.${entry.kind}`)} · <time dateTime={entry.date}>{format(parseISO(entry.date), "d. MMM", { locale: dateLocale })}</time>{entry.time ? ` · ${entry.time.slice(0, 5)}` : ""}</span>
                        <span className="mt-1 block text-sm font-semibold text-ink">{entry.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : <p className="rounded-control bg-surface-sunken p-4 text-sm text-ink-secondary">{t("profile_calendar.empty")}</p>}
            </div>
            {truncated ? <p className="mt-3 text-xs text-ink-secondary">{t("profile_calendar.truncated")}</p> : null}
          </div>
        </div>
      )}
    </Card>
  );
}
