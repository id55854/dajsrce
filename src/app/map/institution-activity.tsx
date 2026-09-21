"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { NeedCard } from "@/components/NeedCard";
import { VolunteerEventCard } from "@/components/VolunteerEventCard";
import { fetchMe } from "@/lib/me-client";
import { useT } from "@/i18n/client";
import type { Need, VolunteerEvent } from "@/lib/types";

/**
 * What this organisation is actually asking for, under its detail panel.
 *
 * The panel answered "who is this and where are they", and stopped there: a
 * visitor who had just found an organisation on the map still had to leave
 * for `/doniraj` or `/volunteer` and find it again to see whether it needed
 * anything. Both lists are public and CDN-cached, so this costs two cheap
 * requests and only for the pin that was actually opened.
 *
 * Nothing renders when an organisation has neither, which is the common case
 * for a registry row that has only just been claimed.
 */
export function InstitutionActivity({ institutionId }: { institutionId: string }) {
  const t = useT();
  const [needs, setNeeds] = useState<Need[]>([]);
  const [events, setEvents] = useState<VolunteerEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // Giving is a citizen action: an NGO account never pledges, and
  // `/api/pledges` rejects it anyway, so the button is not offered. Unknown
  // (signed out) keeps it, because PledgeButton walks a visitor through
  // signing in.
  const [canPledge, setCanPledge] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchMe().then((profile) => {
      if (!cancelled) setCanPledge(profile?.role !== "ngo");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);

    async function load() {
      const query = `institution_id=${encodeURIComponent(institutionId)}`;
      const [needsResponse, eventsResponse] = await Promise.all([
        fetch(`/api/needs?${query}&limit=20`, { signal: controller.signal }).catch(() => null),
        fetch(`/api/volunteer-events?${query}`, { signal: controller.signal }).catch(() => null),
      ]);
      if (controller.signal.aborted) return;

      // One list failing is not a reason to hide the other, so the notice is
      // only shown when neither could be read.
      const needsJson = needsResponse?.ok
        ? ((await needsResponse.json().catch(() => null)) as { needs?: Need[] } | null)
        : null;
      const eventsJson = eventsResponse?.ok
        ? ((await eventsResponse.json().catch(() => null)) as { events?: VolunteerEvent[] } | null)
        : null;
      if (controller.signal.aborted) return;

      setNeeds(needsJson?.needs ?? []);
      setEvents(eventsJson?.events ?? []);
      setFailed(!needsJson && !eventsJson);
      setLoading(false);
    }

    load();
    return () => controller.abort();
  }, [institutionId]);

  if (loading) {
    return (
      <p
        role="status"
        className="flex items-center gap-2 border-t border-border-subtle pt-5 text-sm text-ink-secondary"
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        {t("map_page.activity_loading")}
      </p>
    );
  }

  if (failed) {
    return (
      <p
        role="alert"
        className="flex items-start gap-2 border-t border-border-subtle pt-5 text-sm text-ink-secondary"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
        {t("map_page.activity_error")}
      </p>
    );
  }

  if (needs.length === 0 && events.length === 0) return null;

  return (
    <div className="space-y-6 border-t border-border-subtle pt-5">
      {needs.length > 0 ? (
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-tertiary">
            {t("map_page.activity_needs", { count: needs.length })}
          </h3>
          <ul className="space-y-3">
            {needs.map((need) => (
              <li key={need.id}>
                {/* No institution passed on purpose: the panel above already
                    names it, and the card would repeat it with a link back to
                    where the visitor already is. */}
                <NeedCard need={need} canPledge={canPledge} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {events.length > 0 ? (
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-tertiary">
            {t("map_page.activity_events", { count: events.length })}
          </h3>
          <ul className="space-y-3">
            {events.map(({ institution: _institution, ...event }) => (
              <li key={event.id}>
                {/* Same reason as the needs above: the card's own header would
                    repeat the organisation this panel is already about. */}
                <VolunteerEventCard event={event} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
