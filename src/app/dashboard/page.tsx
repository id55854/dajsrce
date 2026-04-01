"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  Clock,
  Heart,
  MapPin,
  PackageCheck,
  Sparkles,
} from "lucide-react";
import { BadgeDisplay } from "@/components/BadgeDisplay";
import type { Pledge } from "@/lib/types";
import { DONATION_TYPES } from "@/lib/constants";

type PledgeRow = Pledge & {
  need?: {
    id: string;
    title: string;
    donation_type: string;
    institution?: { id: string; name: string; category: string };
  };
};

const statusLabel: Record<string, string> = {
  pledged: "Pledged",
  delivered: "Delivered",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
};

export default function CitizenDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [pledges, setPledges] = useState<PledgeRow[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/pledges", { credentials: "include" });
        if (res.ok) {
          const json = await res.json();
          setPledges(json.pledges ?? []);
        }
      } catch {
        // Silently handle — demo mode or no auth
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const recent = pledges.slice(0, 6);

  return (
    <div className="min-h-screen bg-gradient-to-b from-red-50/60 to-white px-4 py-10 dark:from-gray-950 dark:to-gray-950">
      <div className="mx-auto max-w-3xl space-y-10">
        <header>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Welcome!
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Your community contribution overview.
          </p>
        </header>

        <section className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-100 dark:bg-gray-900 dark:ring-gray-800">
            <div className="mb-3 flex items-center gap-2 text-red-500">
              <Heart className="h-5 w-5" strokeWidth={2} />
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Total Pledges
              </span>
            </div>
            <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              {pledges.length}
            </p>
          </div>
          <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-100 dark:bg-gray-900 dark:ring-gray-800">
            <div className="mb-3 flex items-center gap-2 text-emerald-600">
              <PackageCheck className="h-5 w-5" strokeWidth={2} />
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Confirmed Deliveries
              </span>
            </div>
            <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              0
            </p>
          </div>
          <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-100 dark:bg-gray-900 dark:ring-gray-800">
            <div className="mb-3 flex items-center gap-2 text-amber-600">
              <Clock className="h-5 w-5" strokeWidth={2} />
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Volunteer Hours
              </span>
            </div>
            <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              0
            </p>
          </div>
        </section>

        <section>
          <div className="mb-4 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-red-500" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Badges
            </h2>
          </div>
          <BadgeDisplay badges={[]} />
        </section>

        <section>
          <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
            Recent Pledges
          </h2>
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-24 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800"
                />
              ))}
            </div>
          ) : recent.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-gray-200 bg-white/80 px-6 py-10 text-center text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900/80 dark:text-gray-400">
              No pledges yet. Find needs on the map!
            </p>
          ) : (
            <ul className="space-y-3">
              {recent.map((pl) => {
                const need = pl.need;
                const inst = need?.institution;
                const typeLabel = need
                  ? DONATION_TYPES[
                      need.donation_type as keyof typeof DONATION_TYPES
                    ]?.label ?? need.donation_type
                  : "";
                const when = formatDistanceToNow(new Date(pl.created_at), {
                  addSuffix: true,
                });
                return (
                  <li
                    key={pl.id}
                    className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-gray-900 dark:text-gray-100">
                          {need?.title ?? "Need"}
                        </p>
                        {inst ? (
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            {inst.name}
                          </p>
                        ) : null}
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {typeLabel}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="inline-flex rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-400">
                          {statusLabel[pl.status] ?? pl.status}
                        </span>
                        <p className="mt-1 text-xs text-gray-500">{when}</p>
                        <p className="text-xs text-gray-500">
                          Quantity: {pl.quantity}
                        </p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="pb-8">
          <Link
            href="/map"
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-red-500 py-4 text-sm font-semibold text-white shadow-md shadow-red-500/25 transition-colors hover:bg-red-600 sm:w-auto sm:px-10"
          >
            <MapPin className="h-5 w-5" />
            Find where to help
          </Link>
        </div>
      </div>
    </div>
  );
}
