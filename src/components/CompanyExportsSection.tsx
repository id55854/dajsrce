"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileArchive, Loader2 } from "lucide-react";
import { useT, useLocale } from "@/i18n/client";
import { flags } from "@/lib/flags";
import type { CompanyRole, EsgExport, Framework } from "@/lib/types";
import { FRAMEWORK_LABELS, SUBSCRIPTION_TIERS } from "@/lib/constants";
import type { SubscriptionTier } from "@/lib/types";

const ALL_FRAMEWORKS = Object.keys(FRAMEWORK_LABELS) as Framework[];

type Props = {
  companyId: string;
  memberRole: CompanyRole;
  subscriptionTier: SubscriptionTier;
};

export function CompanyExportsSection({ companyId, memberRole, subscriptionTier }: Props) {
  const t = useT();
  const { locale } = useLocale();
  const canFinance = memberRole === "owner" || memberRole === "admin" || memberRole === "finance";
  const allowedFrameworks = SUBSCRIPTION_TIERS[subscriptionTier]?.exports ?? [];
  const fullyEnabled = flags.exportsEnabled && allowedFrameworks.length > 0;

  const displayFrameworks = useMemo(
    () => (fullyEnabled ? allowedFrameworks : ALL_FRAMEWORKS),
    [fullyEnabled, allowedFrameworks]
  );

  const [framework, setFramework] = useState<Framework>(() => {
    const first = allowedFrameworks[0] as Framework | undefined;
    return first ?? ALL_FRAMEWORKS[0]!;
  });
  const [periodStart, setPeriodStart] = useState(() => {
    const y = new Date().getFullYear();
    return `${y}-01-01`;
  });
  const [periodEnd, setPeriodEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [exports, setExports] = useState<EsgExport[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (displayFrameworks.length && !displayFrameworks.includes(framework)) {
      setFramework(displayFrameworks[0]!);
    }
  }, [displayFrameworks, framework]);

  const load = useCallback(async () => {
    if (!canFinance || !fullyEnabled) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/companies/${companyId}/exports`, { credentials: "include" });
      const data = await res.json();
      if (res.ok) setExports(data.exports ?? []);
    } catch {
      setMessage(t("common.error_generic"));
    } finally {
      setLoading(false);
    }
  }, [canFinance, companyId, fullyEnabled, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function generate() {
    setMessage(null);
    if (!framework) {
      setMessage(t("export.framework_required"));
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/exports`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ framework, period_start: periodStart, period_end: periodEnd }),
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

  async function download(exportId: string) {
    const res = await fetch(`/api/companies/${companyId}/exports/${exportId}/download`, {
      credentials: "include",
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && typeof data.url === "string") {
      window.open(data.url, "_blank", "noopener,noreferrer");
    }
  }

  if (!canFinance) return null;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-3 flex items-center gap-2 text-red-500">
        <FileArchive className="h-4 w-4" aria-hidden />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {t("company.exports_section_title")}
        </h3>
      </div>
      <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">{t("company.exports_section_hint")}</p>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {t("export.framework")}
          <select
            className="mt-1 block w-full min-w-[200px] rounded-xl border border-gray-200 px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            value={framework}
            onChange={(e) => setFramework(e.target.value as Framework)}
          >
            {displayFrameworks.map((f) => (
              <option key={f} value={f}>
                {locale === "hr" ? FRAMEWORK_LABELS[f].labelHr : FRAMEWORK_LABELS[f].label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {t("export.period_start")}
          <input
            type="date"
            className="mt-1 rounded-xl border border-gray-200 px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
          />
        </label>
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {t("export.period_end")}
          <input
            type="date"
            className="mt-1 rounded-xl border border-gray-200 px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
          />
        </label>
        <button
          type="button"
          onClick={() => {
            if (!fullyEnabled) return;
            void generate();
          }}
          disabled={fullyEnabled && generating}
          className="inline-flex items-center gap-2 rounded-full bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50"
        >
          {fullyEnabled && generating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {fullyEnabled && generating ? t("export.generating") : t("export.generate")}
        </button>
      </div>
      {fullyEnabled && message ? (
        <p className="mb-3 text-sm text-red-600 dark:text-red-400">{message}</p>
      ) : null}
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {t("export.list_title")}
      </h4>
      {fullyEnabled && loading ? (
        <p className="text-sm text-gray-500">{t("institution.loading")}</p>
      ) : fullyEnabled && exports.length > 0 ? (
        <ul className="space-y-2 text-sm">
          {exports.map((ex) => (
            <li
              key={ex.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-100 px-3 py-2 dark:border-gray-800"
            >
              <span className="text-gray-800 dark:text-gray-200">
                {ex.framework} · {ex.period_start} — {ex.period_end} · v{ex.version}
              </span>
              <button
                type="button"
                onClick={() => void download(ex.id)}
                className="text-xs font-semibold text-red-600 hover:underline"
              >
                {t("export.download_zip")}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400">{t("export.empty")}</p>
      )}
    </section>
  );
}
