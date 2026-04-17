"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Clock, Heart, MapPin, PackageCheck } from "lucide-react";
import type { Pledge, Shipment } from "@/lib/types";
import { DONATION_TYPES } from "@/lib/constants";

type PledgeRow = Pledge & {
  need?: {
    id: string;
    title: string;
    donation_type: string;
    institution?: { id: string; name: string; category: string };
  };
  shipment?: Shipment | null;
};

const statusLabel: Record<string, string> = {
  pledged: "Pledged",
  delivered: "Delivered",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
};

export default function IndividualDashboardPage() {
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
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const recent = pledges.slice(0, 8);
  const withShipment = pledges.filter((item) => item.shipment).length;

  return (
    <div className="min-h-screen bg-gradient-to-b from-red-50/60 to-white px-4 py-10 dark:from-gray-950 dark:to-gray-950">
      <div className="mx-auto max-w-4xl space-y-10">
        <header>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Individual Dashboard
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Donation history, volunteer actions, and shipment tracking in one place.
          </p>
        </header>

        <section className="grid gap-4 sm:grid-cols-3">
          <StatCard icon={<Heart className="h-5 w-5" />} label="Donations" value={pledges.length} />
          <StatCard icon={<PackageCheck className="h-5 w-5" />} label="With shipping" value={withShipment} />
          <StatCard icon={<Clock className="h-5 w-5" />} label="Volunteer hours" value={0} />
        </section>

        <section>
          <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
            Donation history
          </h2>
          {loading ? (
            <p className="text-sm text-gray-500">Loading...</p>
          ) : recent.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-gray-200 bg-white/80 px-6 py-10 text-center text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900/80 dark:text-gray-400">
              No actions yet. Browse needs and start helping.
            </p>
          ) : (
            <ul className="space-y-3">
              {recent.map((pl) => {
                const need = pl.need;
                const typeLabel = need
                  ? DONATION_TYPES[need.donation_type as keyof typeof DONATION_TYPES]
                      ?.label ?? need.donation_type
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
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          {need?.institution?.name ?? "Community support"}
                        </p>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {typeLabel}
                        </p>
                        {pl.shipment ? (
                          <p className="mt-1 text-xs text-blue-600 dark:text-blue-400">
                            Shipment: {pl.shipment.status}
                          </p>
                        ) : null}
                      </div>
                      <div className="text-right">
                        <span className="inline-flex rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-400">
                          {statusLabel[pl.status] ?? pl.status}
                        </span>
                        <p className="mt-1 text-xs text-gray-500">{when}</p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <Link
          href="/map"
          className="inline-flex items-center gap-2 rounded-xl bg-red-500 px-5 py-3 text-sm font-semibold text-white hover:bg-red-600"
        >
          <MapPin className="h-4 w-4" />
          Find places to help
        </Link>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-100 dark:bg-gray-900 dark:ring-gray-800">
      <div className="mb-3 flex items-center gap-2 text-red-500">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {label}
        </span>
      </div>
      <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
    </div>
  );
}
