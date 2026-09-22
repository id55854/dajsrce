"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarHeart } from "lucide-react";
import {
  VolunteerEventCard,
  type VolunteerEventCardProps,
} from "@/components/VolunteerEventCard";
import { endOfMonth, endOfWeek, format } from "date-fns";
import { useT } from "@/i18n/client";
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  PageShell,
  Skeleton,
  buttonClasses,
} from "@/components/ui";

type EventRow = VolunteerEventCardProps["event"];

function eventCardId(eventId: string): string {
  return `volunteer-event-${eventId}`;
}

/** Mirrors VolunteerEventCard: chip row, title, three meta lines, progress, CTA. */
function EventCardSkeleton() {
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-6 w-24 rounded-full" />
      </div>
      <Skeleton className="mt-4 h-6 w-3/4" />
      <Skeleton className="mt-3 h-4 w-2/3" />
      <Skeleton className="mt-2 h-4 w-32" />
      <Skeleton className="mt-3 h-4 w-full" />
      <div className="mt-6">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="mt-2 h-2 w-full rounded-full" />
      </div>
      <Skeleton className="mt-6 h-11 w-full rounded-full" />
    </Card>
  );
}

export function VolunteerClient() {
  const t = useT();
  const [period, setPeriod] = useState<"all" | "week" | "month">("all");
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState<Set<string>>(() => new Set());
  const [retry, setRetry] = useState(0);

  // Load events + the user's existing signups in parallel so the page
  // shows the correct state immediately on first render.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [eventsRes, signupsRes] = await Promise.all([
          fetch("/api/volunteer-events"),
          fetch("/api/volunteer-signups", { credentials: "include" }),
        ]);
        const eventsJson = (await eventsRes.json()) as {
          events?: EventRow[];
          error?: string;
        };
        if (!eventsRes.ok) throw new Error();

        // Signups endpoint never errors (returns empty list when not logged in).
        const signupsJson = (await signupsRes.json().catch(() => ({}))) as {
          signups?: { event_id: string }[];
        };

        if (cancelled) return;
        setEvents(eventsJson.events ?? []);
        setRegistered(
          new Set((signupsJson.signups ?? []).map((s) => s.event_id))
        );
      } catch {
        if (!cancelled) {
          setError("volunteer_page.error_loading");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [retry]);

  const handleSignUp = useCallback((eventId: string) => {
    // Source-of-truth update for both the registered set and the event's
    // counter, counter only bumps when this is a fresh registration to
    // avoid double-counting the 409 (already-registered) path.
    setRegistered((prev) => {
      if (prev.has(eventId)) return prev;
      const next = new Set(prev);
      next.add(eventId);
      return next;
    });
    setEvents((prev) =>
      prev.map((ev) =>
        ev.id === eventId
          ? {
              ...ev,
              volunteers_signed_up: (ev.volunteers_signed_up ?? 0) + 1,
            }
          : ev
      )
    );
  }, []);

  const sortedEvents = useMemo(
    () =>
      [...events].filter((event) => {
        if (period === "all") return true;
        const today = new Date();
        const end = period === "week" ? endOfWeek(today, { weekStartsOn: 1 }) : endOfMonth(today);
        return event.event_date >= format(today, "yyyy-MM-dd") && event.event_date <= format(end, "yyyy-MM-dd");
      }).sort((a, b) =>
        a.event_date === b.event_date
          ? (a.start_time ?? "").localeCompare(b.start_time ?? "")
          : a.event_date.localeCompare(b.event_date)
      ),
    [events, period]
  );

  return (
    <PageShell>
      <PageHeader
        title={t("volunteer_page.title")}
        subtitle={t("volunteer_page.subtitle")}
      />

      {loading ? (
        <div role="status" aria-label={t("volunteer_page.loading")}>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <EventCardSkeleton key={i} />
            ))}
          </div>
        </div>
      ) : error ? (
        <div role="alert">
          <EmptyState
            icon={<AlertTriangle className="h-10 w-10" aria-hidden="true" />}
            title={t(error)}
            action={
              <Button
                variant="secondary"
                onClick={() => setRetry((value) => value + 1)}
              >
                {t("errors.retry")}
              </Button>
            }
          />
        </div>
      ) : events.length === 0 ? (
        <EmptyState
          icon={
            <CalendarHeart
              className="h-12 w-12"
              strokeWidth={1.25}
              aria-hidden="true"
            />
          }
          title={t("volunteer_page.empty")}
          description={t("volunteer_page.empty_hint")}
          action={
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link href="/doniraj" className={buttonClasses()}>
                {t("volunteer_page.empty_browse_needs")}
              </Link>
              <Link
                href="/"
                className={buttonClasses({ variant: "secondary" })}
              >
                {t("volunteer_page.empty_open_map")}
              </Link>
            </div>
          }
        />
      ) : (
        <div>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-border-subtle pb-5">
            <div role="group" aria-label={t("volunteer_page.period_label")} className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto">
              {(["all", "week", "month"] as const).map((value) => (
                <Button key={value} className="px-2 text-xs sm:px-5 sm:text-sm" variant={period === value ? "primary" : "secondary"} aria-pressed={period === value} onClick={() => setPeriod(value)}>
                  {t(`volunteer_page.period_${value}`)}
                </Button>
              ))}
            </div>
            <p role="status" className="text-sm text-ink-secondary">
              {t("volunteer_calendar.upcoming_count", { count: sortedEvents.length })}
            </p>
          </div>
          {sortedEvents.length === 0 ? (
            <EmptyState
              icon={<CalendarHeart className="h-10 w-10" aria-hidden="true" />}
              title={t("volunteer_page.period_empty")}
              description={t("volunteer_page.period_empty_hint")}
              action={<Button variant="secondary" onClick={() => setPeriod("all")}>{t("volunteer_page.period_all")}</Button>}
            />
          ) : (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {sortedEvents.map((event) => (
                <VolunteerEventCard
                  key={event.id}
                  event={event}
                  isRegistered={registered.has(event.id)}
                  onSignUp={handleSignUp}
                  htmlId={eventCardId(event.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </PageShell>
  );
}
