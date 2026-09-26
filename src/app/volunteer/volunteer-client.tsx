"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { readPublicList, rememberPublicList } from "@/lib/public-list-cache";
import { AlertTriangle, CalendarHeart } from "lucide-react";
import {
  VolunteerEventCard,
  type VolunteerEventCardProps,
} from "@/components/VolunteerEventCard";
import { endOfMonth, endOfWeek, format } from "date-fns";
import { useT } from "@/i18n/client";
import { hasVolunteerEventEnded } from "@/lib/volunteer-events";
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
type EventList = { events: EventRow[]; truncated: boolean };

const LIST_KEY = "/api/volunteer-events";
const CARD_ANCHOR = /^#volunteer-event-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function eventCardId(eventId: string): string {
  return `volunteer-event-${eventId}`;
}

function cachedList(): EventList | undefined {
  const cached = readPublicList<EventList | EventRow[]>(LIST_KEY);
  if (cached === undefined) return undefined;
  return Array.isArray(cached) ? { events: cached, truncated: false } : cached;
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

export function VolunteerClient({ focusEventId = null }: {
  /** An event to bring forward and open, e.g. the one a visitor tried to join before signing in. */
  focusEventId?: string | null;
}) {
  const t = useT();
  const [period, setPeriod] = useState<"all" | "week" | "month">("all");
  const [events, setEvents] = useState<EventRow[]>(() => cachedList()?.events ?? []);
  const [truncated, setTruncated] = useState(() => cachedList()?.truncated ?? false);
  const [loading, setLoading] = useState(() => cachedList() === undefined);
  const [signupsLoading, setSignupsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** event id -> the visitor's own signup id (null until the server says). */
  const [registered, setRegistered] = useState<Map<string, string | null>>(() => new Map());
  const [retry, setRetry] = useState(0);
  /** The event still to bring forward; cleared once it is open or known to be gone. */
  const [focusId, setFocusId] = useState<string | null>(focusEventId);
  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const [focusMissing, setFocusMissing] = useState(false);

  // Public events can render before the independent private signup lookup.
  useEffect(() => {
    const controller = new AbortController();
    const cached = cachedList();
    setLoading(!cached);
    if (cached) {
      setEvents(cached.events);
      setTruncated(cached.truncated);
    }
    setError(null);
    void (async () => {
      try {
        const response = await fetch(LIST_KEY, { signal: controller.signal });
        if (!response.ok) throw new Error();
        const json = (await response.json()) as { events?: EventRow[]; truncated?: boolean };
        if (controller.signal.aborted) return;
        const list = { events: json.events ?? [], truncated: json.truncated === true };
        rememberPublicList(LIST_KEY, list);
        setEvents(list.events);
        setTruncated(list.truncated);
      } catch {
        if (!controller.signal.aborted) setError("volunteer_page.error_loading");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [retry]);

  useEffect(() => {
    const controller = new AbortController();
    setSignupsLoading(true);
    void (async () => {
      try {
        if (!isSupabaseConfigured) return;
        const { data: { session } } = await createClient().auth.getSession();
        if (controller.signal.aborted || !session?.user) return;
        const response = await fetch("/api/volunteer-signups", {
          credentials: "include", signal: controller.signal,
        });
        if (!response.ok) throw new Error();
        const json = (await response.json()) as { signups?: { id?: string; event_id: string }[] };
        if (!controller.signal.aborted) {
          setRegistered(new Map((json.signups ?? []).map((signup) => [signup.event_id, signup.id ?? null])));
        }
      } catch {
        // Public browsing remains available; the signup API verifies duplicates.
      } finally {
        if (!controller.signal.aborted) setSignupsLoading(false);
      }
    })();
    return () => controller.abort();
  }, [retry]);

  // A new ?event= on the same page, or the card anchor
  // (#volunteer-event-<id>), which names an event the same way and which only
  // the browser can read.
  useEffect(() => {
    if (focusEventId) {
      setFocusId(focusEventId);
      return;
    }
    const match = CARD_ANCHOR.exec(window.location.hash);
    if (match) setFocusId(match[1].toLowerCase());
  }, [focusEventId]);

  // Once the list is in, scroll the focused event into view and open it. An
  // event past the first page is fetched on its own; one that is over or
  // gone says so instead of leaving the visitor looking for it.
  useEffect(() => {
    if (!focusId || loading || error) return;
    if (events.some((event) => event.id === focusId)) {
      setOpenEventId(focusId);
      setFocusId(null);
      requestAnimationFrame(() =>
        document.getElementById(eventCardId(focusId))?.scrollIntoView({ block: "center" })
      );
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`${LIST_KEY}?event_id=${encodeURIComponent(focusId)}`, {
          signal: controller.signal,
        });
        const json = response.ok ? ((await response.json()) as { events?: EventRow[] }) : null;
        if (controller.signal.aborted) return;
        const found = json?.events?.find((event) => event.id === focusId);
        if (found) {
          // The next pass of this effect finds it in the list and opens it.
          setEvents((current) => (current.some((event) => event.id === found.id) ? current : [...current, found]));
        } else {
          setFocusMissing(true);
          setFocusId(null);
        }
      } catch {
        if (!controller.signal.aborted) {
          setFocusMissing(true);
          setFocusId(null);
        }
      }
    })();
    return () => controller.abort();
  }, [focusId, loading, error, events]);

  const handleSignUp = useCallback((eventId: string, signupId?: string) => {
    // Source-of-truth update for both the registered set and the event's
    // counter, counter only bumps when this is a fresh registration to
    // avoid double-counting the 409 (already-registered) path.
    setRegistered((prev) => {
      if (prev.has(eventId) && !signupId) return prev;
      const next = new Map(prev);
      next.set(eventId, signupId ?? prev.get(eventId) ?? null);
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

  const handleCancelled = useCallback((eventId: string) => {
    setRegistered((prev) => {
      const next = new Map(prev);
      next.delete(eventId);
      return next;
    });
    setEvents((prev) =>
      prev.map((ev) =>
        ev.id === eventId
          ? { ...ev, volunteers_signed_up: Math.max(0, (ev.volunteers_signed_up ?? 0) - 1) }
          : ev
      )
    );
  }, []);

  // The API already leaves out events that are over, but a cached list or a
  // page left open can outlive an event's end time.
  const upcoming = useMemo(() => events.filter((event) => !hasVolunteerEventEnded(event)), [events]);

  const sortedEvents = useMemo(
    () =>
      upcoming.filter((event) => {
        if (period === "all") return true;
        const today = new Date();
        const end = period === "week" ? endOfWeek(today, { weekStartsOn: 1 }) : endOfMonth(today);
        return event.event_date >= format(today, "yyyy-MM-dd") && event.event_date <= format(end, "yyyy-MM-dd");
      }).sort((a, b) =>
        a.event_date === b.event_date
          ? (a.start_time ?? "").localeCompare(b.start_time ?? "")
          : a.event_date.localeCompare(b.event_date)
      ),
    [upcoming, period]
  );

  return (
    <PageShell>
      <PageHeader
        title={t("volunteer_page.title")}
        subtitle={t("volunteer_page.subtitle")}
      />

      {focusMissing ? (
        <p role="status" className="mb-6 rounded-control border border-border-subtle bg-surface-sunken px-4 py-3 text-sm text-ink-secondary">
          {t("volunteer_page.event_unavailable")}
        </p>
      ) : null}

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
      ) : upcoming.length === 0 ? (
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
                <Button key={value} className="whitespace-nowrap px-1.5 text-xs sm:px-5 sm:text-sm" variant={period === value ? "primary" : "secondary"} aria-pressed={period === value} onClick={() => setPeriod(value)}>
                  {t(`volunteer_page.period_${value}`)}
                </Button>
              ))}
            </div>
            <div className="text-sm text-ink-secondary sm:text-right">
              <p role="status">
                {t("volunteer_calendar.upcoming_count", { count: sortedEvents.length })}
              </p>
              {/* The list is one page of the soonest events; say so rather
                  than let later ones look as if they did not exist. */}
              {truncated ? (
                <p className="text-xs text-ink-tertiary">
                  {t("volunteer_page.truncated", { count: upcoming.length })}
                </p>
              ) : null}
            </div>
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
                  registrationPending={signupsLoading}
                  onSignUp={handleSignUp}
                  signupId={registered.get(event.id) ?? null}
                  onCancelled={handleCancelled}
                  htmlId={eventCardId(event.id)}
                  autoOpen={event.id === openEventId}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </PageShell>
  );
}
