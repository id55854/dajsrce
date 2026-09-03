"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { AlertTriangle, PackageSearch } from "lucide-react";
import type { DonationType, UrgencyLevel } from "@/lib/types";
import { DONATION_TYPES } from "@/lib/constants";
import { NeedCard, type NeedCardNeed } from "@/components/NeedCard";
import { FilterChip } from "@/components/FilterBar";
import type { PledgeSuccessPayload } from "@/components/PledgeButton";
import {
  YourPledgesSection,
  type YourPledgeRow,
} from "@/components/YourPledgesSection";
import { createClient } from "@/lib/supabase/client";
import { useLocale, useT } from "@/i18n/client";
import {
  Button,
  Card,
  EmptyState,
  Skeleton,
  SkeletonText,
  buttonClasses,
} from "@/components/ui";

const DONATION_KEYS = Object.keys(DONATION_TYPES) as DonationType[];

const URGENCY_OPTIONS: Array<{
  value: UrgencyLevel | "all";
  key: string;
}> = [
  { value: "all", key: "needs_page.all" },
  { value: "urgent", key: "needs_page.urgent" },
  { value: "needed_soon", key: "needs_page.soon" },
  { value: "routine", key: "needs_page.routine" },
];

/**
 * Mirrors NeedCard's real anatomy — badge row, clamped title, three lines of
 * body, progress bar, action row — so a cold load reserves the height the
 * cards will actually take instead of a flat `h-64` block that then jumps.
 */
function NeedCardSkeleton() {
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-6 w-24 rounded-full" />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Skeleton className="h-6 w-20 rounded-full" />
        <Skeleton className="h-6 w-28 rounded-full" />
      </div>
      <Skeleton className="mt-4 h-6 w-3/4" />
      <SkeletonText className="mt-3" lines={3} />
      <div className="mt-5">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="mt-2 h-2 w-full rounded-full" />
      </div>
      <div className="mt-6 flex items-center justify-between gap-3">
        <Skeleton className="h-11 w-32 rounded-full" />
        <Skeleton className="h-4 w-24" />
      </div>
    </Card>
  );
}

export function NeedsClient({ refreshKey = 0 }: { refreshKey?: number } = {}) {
  const t = useT();
  const { locale } = useLocale();
  const [needs, setNeeds] = useState<NeedCardNeed[]>([]);
  const [donationType, setDonationType] = useState<DonationType | "all">("all");
  const [urgency, setUrgency] = useState<UrgencyLevel | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Skeletons are for the cold load only. A filter change dims the results
  // that are already on screen instead of destroying and rebuilding the grid.
  const [settled, setSettled] = useState(false);
  const [retry, setRetry] = useState(0);

  // "Your pledges" state — separate fetch, only when authenticated.
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [userPledges, setUserPledges] = useState<YourPledgeRow[]>([]);
  const [pledgesLoading, setPledgesLoading] = useState(true);
  // Resolved once here rather than per card. An NGO account publishes needs
  // and receives; it does not pledge against one, so its cards carry no CTA.
  const [isNgo, setIsNgo] = useState(false);

  // 1. Resolve auth + fetch the user's pledges once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        setLoggedIn(false);
        setPledgesLoading(false);
        return;
      }
      setLoggedIn(true);
      try {
        const me = await fetch("/api/me", { credentials: "include" });
        if (me.ok) {
          const json = (await me.json()) as { profile?: { role?: string } } | null;
          if (!cancelled && json?.profile?.role === "ngo") setIsNgo(true);
        }
      } catch {
        // A failed role lookup leaves the CTA in place; the API still refuses.
      }
      try {
        const res = await fetch("/api/pledges", { credentials: "include" });
        if (res.ok) {
          const json = (await res.json()) as { pledges?: YourPledgeRow[] };
          if (!cancelled) setUserPledges(json.pledges ?? []);
        }
      } finally {
        if (!cancelled) setPledgesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 2. Fetch the public needs list. Re-runs on filter change.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (donationType !== "all") params.set("donation_type", donationType);
        if (urgency !== "all") params.set("urgency", urgency);
        const res = await fetch(`/api/needs?${params.toString()}`);
        const json = (await res.json()) as {
          needs?: NeedCardNeed[];
          error?: string;
        };
        if (!res.ok) throw new Error();
        if (!cancelled) setNeeds(json.needs ?? []);
      } catch {
        if (!cancelled) {
          setError("needs_page.error_loading");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setSettled(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [donationType, urgency, retry, refreshKey]);

  // Map of need_id → my total pledged qty across all pledges (sum across rows).
  const myPledgedByNeed = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of userPledges) {
      if (p.status === "cancelled") continue;
      map.set(p.need_id, (map.get(p.need_id) ?? 0) + (p.quantity ?? 0));
    }
    return map;
  }, [userPledges]);

  const filtersActive = donationType !== "all" || urgency !== "all";

  const clearFilters = useCallback(() => {
    setDonationType("all");
    setUrgency("all");
  }, []);

  const onPledgeSuccess = useCallback(
    (payload: PledgeSuccessPayload) => {
      // Patch the needs[] row in place from the API's authoritative count.
      // Filters stay intact — we only mutate one row, never re-fetch the list.
      if (payload.need) {
        setNeeds((prev) =>
          prev.map((n) =>
            n.id === payload.need!.id
              ? { ...n, quantity_pledged: payload.need!.quantity_pledged }
              : n
          )
        );
      }
      // Append the user-facing pledge row to "Your pledges" using the
      // need we already have in local state for the joined fields.
      const matchingNeed = needs.find((n) => n.id === payload.pledge.need_id);
      const pledgeRow: YourPledgeRow = {
        id: payload.pledge.id,
        user_id: payload.pledge.user_id,
        need_id: payload.pledge.need_id,
        quantity: payload.pledge.quantity,
        amount_eur: payload.pledge.amount_eur,
        status: payload.pledge.status,
        created_at: payload.pledge.created_at,
        need: matchingNeed
          ? {
              id: matchingNeed.id,
              title: matchingNeed.title,
              institution: matchingNeed.institution
                ? {
                    id: matchingNeed.institution.id,
                    name: matchingNeed.institution.name,
                  }
                : null,
            }
          : null,
      };
      setUserPledges((prev) => [pledgeRow, ...prev]);
    },
    [needs]
  );

  const coldLoad = loading && !settled;

  return (
    // The page shell and title belong to the merged Associations page; this
    // is one view inside it.
    <>
      <YourPledgesSection
        loggedIn={loggedIn === true}
        loading={pledgesLoading}
        pledges={userPledges}
      />

      <div className="mb-8 space-y-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
            {t("needs_page.donation_type")}
          </p>
          <div className="flex flex-wrap gap-2">
            <FilterChip
              aria-pressed={donationType === "all"}
              onClick={() => setDonationType("all")}
            >
              {t("needs_page.all")}
            </FilterChip>
            {DONATION_KEYS.map((key) => {
              const on = donationType === key;
              return (
                <FilterChip
                  key={key}
                  aria-pressed={on}
                  onClick={() => setDonationType(on ? "all" : key)}
                >
                  {locale === "hr"
                    ? DONATION_TYPES[key].labelHr
                    : DONATION_TYPES[key].label}
                </FilterChip>
              );
            })}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
            {t("needs_page.urgency")}
          </p>
          <div className="flex flex-wrap gap-2">
            {URGENCY_OPTIONS.map((opt) => {
              const on = urgency === opt.value;
              return (
                <FilterChip
                  key={opt.value}
                  aria-pressed={on}
                  onClick={() => setUrgency(opt.value)}
                >
                  {t(opt.key)}
                </FilterChip>
              );
            })}
          </div>
        </div>
      </div>

      {coldLoad ? (
        <div
          className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3"
          role="status"
          aria-label={t("needs_page.loading")}
        >
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <NeedCardSkeleton key={i} />
          ))}
        </div>
      ) : error ? (
        <div role="alert">
          <EmptyState
            icon={<AlertTriangle className="h-10 w-10" aria-hidden="true" />}
            title={t(error)}
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  // A retry is a cold load again, so it gets skeletons rather
                  // than briefly claiming there is nothing to show.
                  setSettled(false);
                  setRetry((value) => value + 1);
                }}
              >
                {t("errors.retry")}
              </Button>
            }
          />
        </div>
      ) : needs.length === 0 ? (
        <EmptyState
          icon={<PackageSearch className="h-10 w-10" aria-hidden="true" />}
          title={t("needs_page.empty")}
          description={filtersActive ? t("needs_page.empty_hint") : undefined}
          action={
            <div className="flex flex-wrap items-center justify-center gap-3">
              {filtersActive ? (
                <Button onClick={clearFilters}>
                  {t("needs_page.clear_filters")}
                </Button>
              ) : null}
              <Link href="/" className={buttonClasses({ variant: "secondary" })}>
                {t("needs_page.empty_open_map")}
              </Link>
            </div>
          }
        />
      ) : (
        <div
          className={clsx(
            "grid grid-cols-1 gap-6 transition-opacity duration-150 ease-out md:grid-cols-2 lg:grid-cols-3",
            loading && "opacity-60"
          )}
          aria-busy={loading}
        >
          {needs.map((need) => (
            <NeedCard
              key={need.id}
              need={need}
              myPledgedQty={myPledgedByNeed.get(need.id) ?? null}
              onPledgeSuccess={onPledgeSuccess}
              canPledge={!isNgo}
            />
          ))}
        </div>
      )}
    </>
  );
}
