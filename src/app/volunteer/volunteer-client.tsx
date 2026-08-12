"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarHeart } from "lucide-react";
import {
  VolunteerEventCard,
  type VolunteerEventCardProps,
} from "@/components/VolunteerEventCard";
import { VolunteerCalendar } from "@/components/VolunteerCalendar";
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

/**
 * The highlight the calendar flashes on a card. Kept in one place because it is
 * added imperatively — VolunteerEventCard transitions box-shadow so these fade
 * in and back out instead of blinking.
 */
const HIGHLIGHT_CLASSES = [
  "ring-2",
  "ring-brand",
  "ring-offset-2",
  "ring-offset-surface",
];

/** Same 7-column shape and 44px cells as the real calendar. */
function CalendarSkeleton() {
  return (
    <Card padding="sm" className="sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <Skeleton className="h-6 w-40" />
        <div className="flex gap-1">
          <Skeleton className="h-11 w-11 rounded-full" />
          <Skeleton className="h-10 w-20 rounded-full" />
          <Skeleton className="h-11 w-11 rounded-full" />
        </div>
      </div>
      <div className="mb-1 grid grid-cols-7 gap-1">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-4" />
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: 35 }, (_, i) => (
          <Skeleton key={i} className="aspect-square min-h-11" />
        ))}
      </div>
      <div className="mt-4 flex gap-4">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-4 w-24" />
        ))}
      </div>
    </Card>
  );
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
    // counter — counter only bumps when this is a fresh registration to
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

  const onCalendarDayClick = useCallback(
    (_date: string, eventIds: string[]) => {
      const targetId = eventIds[0];
      if (!targetId) return;
      const node = document.getElementById(eventCardId(targetId));
      if (!node) return;
      const reducedMotion = window.matchMedia?.(
        "(prefers-reduced-motion: reduce)"
      ).matches;
      node.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "center",
      });
      node.focus({ preventScroll: true });
      // Fades in and back out: the card carries a box-shadow transition.
      node.classList.add(...HIGHLIGHT_CLASSES);
      window.setTimeout(() => {
        node.classList.remove(...HIGHLIGHT_CLASSES);
      }, 1500);
    },
    []
  );

  const sortedEvents = useMemo(
    () =>
      [...events].sort((a, b) =>
        a.event_date === b.event_date
          ? (a.start_time ?? "").localeCompare(b.start_time ?? "")
          : a.event_date.localeCompare(b.event_date)
      ),
    [events]
  );

  return (
    <PageShell>
      <PageHeader
        title={t("volunteer_page.title")}
        subtitle={t("volunteer_page.subtitle")}
      />

      {loading ? (
        <div role="status" aria-label={t("volunteer_page.loading")}>
          <div className="mb-8">
            <CalendarSkeleton />
          </div>
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
              <Link href="/organisations?view=needs" className={buttonClasses()}>
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
        <>
          <div className="mb-8">
            <VolunteerCalendar
              events={events.map((e) => ({
                id: e.id,
                title: e.title,
                event_date: e.event_date,
                start_time: e.start_time,
              }))}
              registeredEventIds={registered}
              onDayClick={onCalendarDayClick}
            />
          </div>

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
        </>
      )}
    </PageShell>
  );
}
