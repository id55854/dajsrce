"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarHeart } from "lucide-react";
import {
  VolunteerEventCard,
  type VolunteerEventCardProps,
} from "@/components/VolunteerEventCard";
import { VolunteerCalendar } from "@/components/VolunteerCalendar";

type EventRow = VolunteerEventCardProps["event"];

function eventCardId(eventId: string): string {
  return `volunteer-event-${eventId}`;
}

export default function VolunteerPage() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState<Set<string>>(() => new Set());

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
        if (!eventsRes.ok) throw new Error(eventsJson.error ?? "Failed to load");

        // Signups endpoint never errors (returns empty list when not logged in).
        const signupsJson = (await signupsRes.json().catch(() => ({}))) as {
          signups?: { event_id: string }[];
        };

        if (cancelled) return;
        setEvents(eventsJson.events ?? []);
        setRegistered(
          new Set((signupsJson.signups ?? []).map((s) => s.event_id))
        );
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Error loading data");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
      node.scrollIntoView({ behavior: "smooth", block: "center" });
      // Brief flash so the user sees what was scrolled to.
      node.classList.add("ring-2", "ring-red-400", "ring-offset-2");
      window.setTimeout(() => {
        node.classList.remove("ring-2", "ring-red-400", "ring-offset-2");
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
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
          Volunteer Events
        </h1>
        <p className="mt-2 text-lg text-gray-600 dark:text-gray-400">
          Join an event and make a difference
        </p>
      </header>

      {loading ? (
        <>
          <div className="mb-8 h-72 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-72 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800"
              />
            ))}
          </div>
        </>
      ) : error ? (
        <p className="text-center text-red-600">{error}</p>
      ) : events.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 py-16 text-center text-gray-500 dark:text-gray-400">
          <CalendarHeart
            className="h-16 w-16 text-red-300"
            strokeWidth={1.25}
            aria-hidden
          />
          <p className="max-w-md text-base">
            No upcoming volunteer events. Check back soon!
          </p>
        </div>
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
    </div>
  );
}
