"use client";

import { useCallback, useId, useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { hr, enUS } from "date-fns/locale";
import { useLocale, useT } from "@/i18n/client";
import { CalendarDays, Building2, MapPin } from "lucide-react";
import type { CalendarEntry } from "@/lib/profile-calendar";
import { VolunteerCalendar } from "./VolunteerCalendar";
import { Button, Card, Dialog, SectionHeader, Skeleton, buttonClasses } from "./ui";

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
  // The entry whose details are open. Entries open in place instead of
  // navigating away, which used to land an organisation back on its own
  // profile tab without ever showing what the event said.
  const [openEntry, setOpenEntry] = useState<CalendarEntry | null>(null);
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
                      <button
                        type="button"
                        onClick={() => setOpenEntry(entry)}
                        aria-haspopup="dialog"
                        className="block w-full rounded-control border border-border-subtle p-3 text-left transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                      >
                        <span className="text-xs font-medium text-ink-secondary">{t(`profile_calendar.${entry.kind}`)} · <time dateTime={entry.date}>{format(parseISO(entry.date), "d. MMM", { locale: dateLocale })}</time>{entry.time ? ` · ${entry.time.slice(0, 5)}` : ""}</span>
                        <span className="mt-1 block text-sm font-semibold text-ink">{entry.title}</span>
                        {entry.details?.description ? (
                          <span className="mt-1 line-clamp-2 block text-xs text-ink-secondary">{entry.details.description}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : <p className="rounded-control bg-surface-sunken p-4 text-sm text-ink-secondary">{t("profile_calendar.empty")}</p>}
            </div>
            {truncated ? <p className="mt-3 text-xs text-ink-secondary">{t("profile_calendar.truncated")}</p> : null}
          </div>
        </div>
      )}
      <EntryDialog entry={openEntry} institution={institution} onClose={() => setOpenEntry(null)} />
    </Card>
  );
}

function EntryDialog({ entry, institution, onClose }: {
  entry: CalendarEntry | null;
  institution: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  if (!entry) return null;
  const details = entry.details;
  const subject = details?.subject ?? (entry.kind === "donation" ? "donation" : "volunteer");
  const dateLabel = format(parseISO(entry.date), "EEEE, d. MMMM yyyy.", { locale: locale === "hr" ? hr : enUS });
  const time = details?.startTime
    ? `${details.startTime.slice(0, 5)}${details.endTime ? ` – ${details.endTime.slice(0, 5)}` : ""}`
    : entry.time?.slice(0, 5) ?? null;
  const filled = details?.filled ?? null;
  const needed = details?.needed ?? null;
  const pct = filled != null && needed ? Math.min(100, Math.round((filled / needed) * 100)) : null;
  // On an organisation's calendar the entry belongs to one of its own lists;
  // on a volunteer's it points at a row further down the same page.
  const listLabel = institution
    ? t(subject === "volunteer" ? "profile_calendar.open_volunteers" : "profile_calendar.open_pledges")
    : null;

  return (
    <Dialog
      open
      onClose={onClose}
      title={entry.title}
      description={t(`profile_calendar.${entry.kind}`)}
      closeLabel={t("common.close")}
      variant="sheet-on-mobile"
      footer={listLabel ? (
        <Link href={entry.href} onClick={onClose} className={buttonClasses({ variant: "secondary", fullWidth: true })}>
          {listLabel}
        </Link>
      ) : null}
    >
      <div className="space-y-5">
        <dl className="space-y-2.5 text-sm">
          <div className="flex gap-2.5">
            <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-ink-tertiary" aria-hidden />
            <div>
              <dt className="text-xs text-ink-tertiary">{t("volunteer_card.when")}</dt>
              <dd className="text-ink">{dateLabel}</dd>
              {time ? <dd className="text-ink-secondary">{time}</dd> : null}
            </div>
          </div>
          {details?.organisation ? (
            <div className="flex gap-2.5">
              <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-ink-tertiary" aria-hidden />
              <div>
                <dt className="text-xs text-ink-tertiary">{t("volunteer_card.organiser")}</dt>
                <dd className="text-ink">{details.organisation}</dd>
              </div>
            </div>
          ) : null}
          {details?.location ? (
            <div className="flex gap-2.5">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-tertiary" aria-hidden />
              <div>
                <dt className="text-xs text-ink-tertiary">{t("volunteer_card.where")}</dt>
                <dd className="text-ink">{details.location}</dd>
              </div>
            </div>
          ) : null}
        </dl>

        {details?.description ? (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
              {t(subject === "volunteer" ? "volunteer_card.about" : "profile_calendar.about_need")}
            </h3>
            <p className="mt-1.5 whitespace-pre-line text-base leading-7 text-ink">{details.description}</p>
          </section>
        ) : null}

        {details?.requirements ? (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
              {t("volunteer_card.requirements")}
            </h3>
            <p className="mt-1.5 whitespace-pre-line text-sm leading-6 text-ink-secondary">{details.requirements}</p>
          </section>
        ) : null}

        {filled != null ? (
          <div>
            <div className="flex justify-between text-sm text-ink-tertiary">
              <span>{t(subject === "volunteer" ? "volunteer_card.volunteers" : "profile_calendar.pledged")}</span>
              <span className="tabular-nums">{needed ? `${filled} / ${needed}` : filled}</span>
            </div>
            {pct != null ? (
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-sunken" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
              </div>
            ) : null}
          </div>
        ) : null}

        {details?.mine ? (
          <p className="rounded-control bg-success-soft px-3 py-2 text-sm font-medium text-success-on-soft">
            {t("your_pledges.you_pledged").replace("{qty}", String(details.mine))}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
