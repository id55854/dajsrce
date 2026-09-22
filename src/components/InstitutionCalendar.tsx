"use client";

import { useEffect, useState } from "react";
import type { CalendarEntry } from "@/lib/profile-calendar";
import { ProfileCalendar } from "./ProfileCalendar";

export function InstitutionCalendar({ refreshKey = 0 }: { refreshKey?: number }) {
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    fetch("/api/institution/calendar", { credentials: "include", signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("calendar");
        const data = await response.json();
        if (!controller.signal.aborted) { setEntries(data.entries ?? []); setTruncated(data.truncated === true); }
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refreshKey, retry]);
  return <ProfileCalendar institution entries={entries} loading={loading} error={error} truncated={truncated} onRetry={() => setRetry((value) => value + 1)} />;
}
