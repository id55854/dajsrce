"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import type { DonationType, UrgencyLevel } from "@/lib/types";
import { DONATION_TYPES } from "@/lib/constants";
import { NeedCard, type NeedCardNeed } from "@/components/NeedCard";
import type { PledgeSuccessPayload } from "@/components/PledgeButton";
import {
  YourPledgesSection,
  type YourPledgeRow,
} from "@/components/YourPledgesSection";
import { createClient } from "@/lib/supabase/client";

const DONATION_KEYS = Object.keys(DONATION_TYPES) as DonationType[];

const URGENCY_OPTIONS: { value: UrgencyLevel | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "urgent", label: "Urgent" },
  { value: "needed_soon", label: "Soon" },
  { value: "routine", label: "Routine" },
];

export default function NeedsPage() {
  const [needs, setNeeds] = useState<NeedCardNeed[]>([]);
  const [donationType, setDonationType] = useState<DonationType | "all">("all");
  const [urgency, setUrgency] = useState<UrgencyLevel | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // "Your pledges" state — separate fetch, only when authenticated.
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [userPledges, setUserPledges] = useState<YourPledgeRow[]>([]);
  const [pledgesLoading, setPledgesLoading] = useState(true);

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
        if (!res.ok) throw new Error(json.error ?? "Failed to load");
        if (!cancelled) setNeeds(json.needs ?? []);
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
  }, [donationType, urgency]);

  // Map of need_id → my total pledged qty across all pledges (sum across rows).
  const myPledgedByNeed = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of userPledges) {
      if (p.status === "cancelled") continue;
      map.set(p.need_id, (map.get(p.need_id) ?? 0) + (p.quantity ?? 0));
    }
    return map;
  }, [userPledges]);

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

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
          Institution Needs
        </h1>
        <p className="mt-2 text-lg text-gray-600 dark:text-gray-400">
          Institutions need your help — find where you can contribute
        </p>
      </header>

      <YourPledgesSection
        loggedIn={loggedIn === true}
        loading={pledgesLoading}
        pledges={userPledges}
      />

      <div className="mb-8 space-y-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Donation type
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setDonationType("all")}
              className={clsx(
                "rounded-full border-2 px-3 py-1.5 text-xs font-medium transition-colors",
                donationType === "all"
                  ? "border-red-500 bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400"
                  : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:border-gray-600"
              )}
            >
              All
            </button>
            {DONATION_KEYS.map((key) => {
              const on = donationType === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setDonationType(on ? "all" : key)}
                  className={clsx(
                    "rounded-full border-2 px-3 py-1.5 text-xs font-medium transition-colors",
                    on
                      ? "border-red-500 bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400"
                      : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:border-gray-600"
                  )}
                >
                  {DONATION_TYPES[key].label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Urgency
          </p>
          <div className="flex flex-wrap gap-2">
            {URGENCY_OPTIONS.map((opt) => {
              const on = urgency === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setUrgency(opt.value)}
                  className={clsx(
                    "rounded-full border-2 px-3 py-1.5 text-xs font-semibold transition-colors",
                    on
                      ? "border-red-500 bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400"
                      : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:border-gray-600"
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="h-64 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800"
            />
          ))}
        </div>
      ) : error ? (
        <p className="text-center text-red-600">{error}</p>
      ) : needs.length === 0 ? (
        <p className="py-16 text-center text-gray-500 dark:text-gray-400">
          No active needs at this time
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {needs.map((need) => (
            <NeedCard
              key={need.id}
              need={need}
              myPledgedQty={myPledgedByNeed.get(need.id) ?? null}
              onPledgeSuccess={onPledgeSuccess}
            />
          ))}
        </div>
      )}
    </div>
  );
}
