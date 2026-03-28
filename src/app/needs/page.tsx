"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import type { DonationType, UrgencyLevel } from "@/lib/types";
import { DONATION_TYPES } from "@/lib/constants";
import { NeedCard, type NeedCardNeed } from "@/components/NeedCard";

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

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Institution Needs</h1>
        <p className="mt-2 text-lg text-gray-600">
          Institutions need your help — find where you can contribute
        </p>
      </header>

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
                  ? "border-red-500 bg-red-50 text-red-600"
                  : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
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
                      ? "border-red-500 bg-red-50 text-red-600"
                      : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
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
                      ? "border-red-500 bg-red-50 text-red-600"
                      : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
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
              className="h-64 animate-pulse rounded-xl bg-gray-200"
            />
          ))}
        </div>
      ) : error ? (
        <p className="text-center text-red-600">{error}</p>
      ) : needs.length === 0 ? (
        <p className="py-16 text-center text-gray-500">
          No active needs at this time
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {needs.map((need) => (
            <NeedCard key={need.id} need={need} />
          ))}
        </div>
      )}
    </div>
  );
}
