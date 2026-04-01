"use client";

import { useEffect, useState } from "react";
import { CalendarHeart } from "lucide-react";
import {
  VolunteerEventCard,
  type VolunteerEventCardProps,
} from "@/components/VolunteerEventCard";

type EventRow = VolunteerEventCardProps["event"];

export default function VolunteerPage() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/volunteer-events");
        const json = (await res.json()) as {
          events?: EventRow[];
          error?: string;
        };
        if (!res.ok) throw new Error(json.error ?? "Failed to load");
        if (!cancelled) setEvents(json.events ?? []);
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
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-72 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800"
            />
          ))}
        </div>
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
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {events.map((event) => (
            <VolunteerEventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}
