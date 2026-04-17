"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { useT, useLocale } from "@/i18n/client";
import { flags } from "@/lib/flags";
import type { CompanyCsrReport, CompanyRole } from "@/lib/types";
import { SUBSCRIPTION_TIERS } from "@/lib/constants";
import type { SubscriptionTier } from "@/lib/types";

type Props = {
  companyId: string;
  memberRole: CompanyRole;
  subscriptionTier: SubscriptionTier;
};

export function CompanyCsrReportsSection({ companyId, memberRole, subscriptionTier }: Props) {
  const t = useT();
  const { locale } = useLocale();
  const canFinance = memberRole === "owner" || memberRole === "admin" || memberRole === "finance";
  const tierAllows = SUBSCRIPTION_TIERS[subscriptionTier]?.csrReport ?? false;

  const [periodStart, setPeriodStart] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 12);
    return d.toISOString().slice(0, 10);
  });
  const [periodEnd, setPeriodEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [reports, setReports] = useState<CompanyCsrReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canFinance || !flags.publicProfileEnabled || !tierAllows) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/companies/${companyId}/csr-reports`, { credentials: "include" });
      const data = await res.json();
      if (res.ok) setReports(data.reports ?? []);
    } catch {
      setMessage(t("common.error_generic"));
    } finally {
      setLoading(false);
    }
  }, [canFinance, companyId, tierAllows, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function generate() {
    setMessage(null);
    setGenerating(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/csr-reports`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period_start: periodStart, period_end: periodEnd }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(typeof data.error === "string" ? data.error : t("common.error_generic"));
        return;
      }
      await load();
    } finally {
      setGenerating(false);
    }
  }

  if (!canFinance || !tierAllows) {
    return null;
  }

  if (!flags.publicProfileEnabled) {
    return (
      <section className="rounded-2xl border border-dashed border-gray-200 bg-white/60 p-6 dark:border-gray-800 dark:bg-gray-900/60">
        <p className="text-sm text-gray-600 dark:text-gray-400">{t("company.csr_feature_off")}</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-4 flex items-center gap-2">
        <FileText className="h-5 w-5 text-red-500" aria-hidden />
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t("company.csr_section_title")}
        </h3>
      </div>
      <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">{t("company.csr_section_hint")}</p>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
          {t("export.period_start")}
          <input
            type="date"
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
            className="mt-1 block rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
          />
        </label>
        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
          {t("export.period_end")}
          <input
            type="date"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
            className="mt-1 block rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
          />
        </label>
        <button
          type="button"
          onClick={() => void generate()}
          disabled={generating}
          className="inline-flex items-center gap-2 rounded-full bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50"
        >
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {t("company.csr_generate")}
        </button>
      </div>

      {message ? (
        <p className="mb-3 text-sm text-amber-700 dark:text-amber-400" role="status">
          {message}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-gray-500">{t("common.loading")}</p>
      ) : reports.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">{t("company.csr_empty")}</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {reports.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-100 bg-gray-50/80 px-3 py-2 dark:border-gray-800 dark:bg-gray-800/50"
            >
              <span className="text-gray-800 dark:text-gray-200">
                {r.period_start} → {r.period_end}
                <span className="ml-2 text-xs text-gray-500">
                  {new Date(r.generated_at).toLocaleString(locale === "hr" ? "hr-HR" : "en-GB")}
                </span>
              </span>
              <span className="flex gap-2">
                <a
                  className="font-semibold text-red-600 hover:underline dark:text-red-400"
                  href={`/api/companies/${companyId}/csr-reports/${r.id}/download?format=pdf`}
                  onClick={async (e) => {
                    e.preventDefault();
                    const res = await fetch(
                      `/api/companies/${companyId}/csr-reports/${r.id}/download?format=pdf`,
                      { credentials: "include" }
                    );
                    const j = await res.json();
                    if (j.url) window.open(j.url, "_blank", "noopener,noreferrer");
                  }}
                >
                  PDF
                </a>
                <a
                  className="font-semibold text-red-600 hover:underline dark:text-red-400"
                  href={`/api/companies/${companyId}/csr-reports/${r.id}/download?format=docx`}
                  onClick={async (e) => {
                    e.preventDefault();
                    const res = await fetch(
                      `/api/companies/${companyId}/csr-reports/${r.id}/download?format=docx`,
                      { credentials: "include" }
                    );
                    const j = await res.json();
                    if (j.url) window.open(j.url, "_blank", "noopener,noreferrer");
                  }}
                >
                  DOCX
                </a>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
