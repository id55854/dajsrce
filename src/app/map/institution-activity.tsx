"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { NeedCard } from "@/components/NeedCard";
import type { PledgeSuccessPayload } from "@/components/PledgeButton";
import { VolunteerEventCard } from "@/components/VolunteerEventCard";
import { fetchMe } from "@/lib/me-client";
import { useT } from "@/i18n/client";
import type { Need, VolunteerEvent } from "@/lib/types";

type MyPledgeRow = { id: string; need_id: string; quantity: number; status?: string | null };
type MySignupRow = { id?: string; event_id: string };

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
  // The visitor's own pledges/signups, so a need or event already acted on
  // does not read as untouched and invite a second, redundant attempt.
  const [myPledgedByNeed, setMyPledgedByNeed] = useState<Map<string, number>>(
    () => new Map()
  );
  const [myPledgeIdsByNeed, setMyPledgeIdsByNeed] = useState<Map<string, string[]>>(
    () => new Map()
  );
  /** event id -> the visitor's own signup id (null until the server says). */
  const [registeredEventIds, setRegisteredEventIds] = useState<Map<string, string | null>>(
    () => new Map()
  );
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
      // The pledges/signups requests never error (empty list when signed
      // out), so they ride along unconditionally instead of gating on a
      // separate auth check first.
      const [needsResponse, eventsResponse, pledgesResponse, signupsResponse] =
        await Promise.all([
          fetch(`/api/needs?${query}&limit=20`, { signal: controller.signal }).catch(() => null),
          fetch(`/api/volunteer-events?${query}`, { signal: controller.signal }).catch(() => null),
          fetch("/api/pledges", { credentials: "include", signal: controller.signal }).catch(
            () => null
          ),
          fetch("/api/volunteer-signups", {
            credentials: "include",
            signal: controller.signal,
          }).catch(() => null),
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
      const pledgesJson = pledgesResponse?.ok
        ? ((await pledgesResponse.json().catch(() => null)) as { pledges?: MyPledgeRow[] } | null)
        : null;
      const signupsJson = signupsResponse?.ok
        ? ((await signupsResponse.json().catch(() => null)) as {
            signups?: MySignupRow[];
          } | null)
        : null;
      if (controller.signal.aborted) return;

      setNeeds(needsJson?.needs ?? []);
      setEvents(eventsJson?.events ?? []);
      const pledgedByNeed = new Map<string, number>();
      const pledgeIdsByNeed = new Map<string, string[]>();
      for (const p of pledgesJson?.pledges ?? []) {
        if (p.status === "cancelled") continue;
        pledgedByNeed.set(p.need_id, (pledgedByNeed.get(p.need_id) ?? 0) + (p.quantity ?? 0));
        pledgeIdsByNeed.set(p.need_id, [...(pledgeIdsByNeed.get(p.need_id) ?? []), p.id]);
      }
      setMyPledgedByNeed(pledgedByNeed);
      setMyPledgeIdsByNeed(pledgeIdsByNeed);
      setRegisteredEventIds(
        new Map((signupsJson?.signups ?? []).map((s) => [s.event_id, s.id ?? null]))
      );
      setFailed(!needsJson && !eventsJson);
      setLoading(false);
    }

    load();
    return () => controller.abort();
  }, [institutionId]);

  const handlePledgeSuccess = useCallback((payload: PledgeSuccessPayload) => {
    setMyPledgedByNeed((prev) => {
      const next = new Map(prev);
      const needId = payload.pledge.need_id;
      next.set(needId, (next.get(needId) ?? 0) + (payload.pledge.quantity ?? 0));
      return next;
    });
    setMyPledgeIdsByNeed((prev) => {
      const next = new Map(prev);
      const needId = payload.pledge.need_id;
      next.set(needId, [...(next.get(needId) ?? []), payload.pledge.id]);
      return next;
    });
  }, []);

  const handlePledgesCancelled = useCallback((needId: string) => {
    setMyPledgedByNeed((prev) => {
      const next = new Map(prev);
      next.delete(needId);
      return next;
    });
    setMyPledgeIdsByNeed((prev) => {
      const next = new Map(prev);
      next.delete(needId);
      return next;
    });
  }, []);

  const handleSignupCancelled = useCallback((eventId: string) => {
    setRegisteredEventIds((prev) => {
      const next = new Map(prev);
      next.delete(eventId);
      return next;
    });
    setEvents((prev) =>
      prev.map((event) =>
        event.id === eventId
          ? { ...event, volunteers_signed_up: Math.max(0, (event.volunteers_signed_up ?? 0) - 1) }
          : event
      )
    );
  }, []);

  const handleSignUp = useCallback((eventId: string, signupId?: string) => {
    setRegisteredEventIds((prev) => {
      if (prev.has(eventId) && !signupId) return prev;
      const next = new Map(prev);
      next.set(eventId, signupId ?? prev.get(eventId) ?? null);
      return next;
    });
    setEvents((prev) =>
      prev.map((event) =>
        event.id === eventId
          ? { ...event, volunteers_signed_up: (event.volunteers_signed_up ?? 0) + 1 }
          : event
      )
    );
  }, []);

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
                <NeedCard
                  need={need}
                  canPledge={canPledge}
                  myPledgedQty={myPledgedByNeed.get(need.id) ?? null}
                  myPledgeIds={myPledgeIdsByNeed.get(need.id) ?? []}
                  onPledgesCancelled={handlePledgesCancelled}
                  onPledgeSuccess={handlePledgeSuccess}
                />
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
            {events.map((event) => (
              <li key={event.id}>
                {/* Same reason as the needs above: the card's own header would
                    repeat the organisation this panel is already about. Its
                    details dialog still names the organiser and the place. */}
                <VolunteerEventCard
                  event={event}
                  hideInstitutionHeader
                  isRegistered={registeredEventIds.has(event.id)}
                  signupId={registeredEventIds.get(event.id) ?? null}
                  onCancelled={handleSignupCancelled}
                  onSignUp={handleSignUp}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
