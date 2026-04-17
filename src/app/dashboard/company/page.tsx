"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { Building2, FileDown, Plus, Truck } from "lucide-react";

type CompanyAction = {
  id: string;
  ngo_name: string;
  support_type: string;
  status: string;
  created_at: string;
  confirmation_slug: string;
};

export default function CompanyDashboardPage() {
  const [actions, setActions] = useState<CompanyAction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch("/api/company-actions", { credentials: "include" });
        if (response.ok) {
          const data = await response.json();
          setActions(data.actions ?? []);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const completed = useMemo(
    () => actions.filter((action) => action.status === "confirmed").length,
    [actions]
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-red-50/60 to-white px-4 py-10 dark:from-gray-950 dark:to-gray-950">
      <div className="mx-auto max-w-5xl space-y-8">
        <header>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Company Dashboard
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Track support actions and download thank-you confirmations.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          <InfoCard icon={<Building2 className="h-5 w-5" />} title="Total actions" value={actions.length.toString()} />
          <InfoCard icon={<FileDown className="h-5 w-5" />} title="Confirmed" value={completed.toString()} />
          <InfoCard icon={<Truck className="h-5 w-5" />} title="Shipping-ready" value="Yes" />
        </section>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Corporate donation history
            </h2>
            <Link
              href="/dashboard/company/new-action"
              className="inline-flex items-center gap-2 rounded-xl bg-red-500 px-3 py-2 text-sm font-semibold text-white hover:bg-red-600"
            >
              <Plus className="h-4 w-4" />
              New action
            </Link>
          </div>
          {loading ? (
            <p className="text-sm text-gray-500">Loading...</p>
          ) : actions.length === 0 ? (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              No actions yet. Create one to generate your first confirmation page.
            </p>
          ) : (
            <ul className="space-y-3">
              {actions.map((action) => (
                <li
                  key={action.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-100 p-3 dark:border-gray-800"
                >
                  <div>
                    <p className="font-medium text-gray-900 dark:text-gray-100">
                      {action.ngo_name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {action.support_type} • {new Date(action.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 dark:bg-red-950 dark:text-red-400">
                      {action.status}
                    </span>
                    <Link
                      href={`/company/confirmations/${action.confirmation_slug}`}
                      className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      Download page
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoCard({
  icon,
  title,
  value,
}: {
  icon: ReactNode;
  title: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-100 dark:bg-gray-900 dark:ring-gray-800">
      <div className="mb-2 text-red-500">{icon}</div>
      <p className="text-xs uppercase tracking-wide text-gray-500">{title}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
    </div>
  );
}
