"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { useT } from "@/i18n/client";
import { flags } from "@/lib/flags";
import type { CompanyRole, DonationReceipt } from "@/lib/types";
import { SUBSCRIPTION_TIERS } from "@/lib/constants";
import type { SubscriptionTier } from "@/lib/types";

type Props = {
  companyId: string;
  memberRole: CompanyRole;
  subscriptionTier: SubscriptionTier;
};

export function CompanyReceiptsSection({ companyId, memberRole, subscriptionTier }: Props) {
  const t = useT();
  const canFinance = memberRole === "owner" || memberRole === "admin" || memberRole === "finance";
  const tierAllows = SUBSCRIPTION_TIERS[subscriptionTier]?.taxReceipts === true;
  const fullyEnabled = flags.receiptsEnabled && tierAllows;

  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [receipts, setReceipts] = useState<DonationReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canFinance || !fullyEnabled) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/companies/${companyId}/receipts`, { credentials: "include" });
      const data = await res.json();
      if (res.ok) setReceipts(data.receipts ?? []);
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
    const y = Number.parseInt(year, 10);
    if (!Number.isFinite(y) || y < 2000 || y > 2100) {
      setMessage(t("receipt.year_invalid"));
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/receipts`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fiscal_year: y }),
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

  async function download(receiptId: string, format: "pdf" | "xml") {
    const res = await fetch(
      `/api/companies/${companyId}/receipts/${receiptId}/download?format=${format}`,
      { credentials: "include" }
    );
    const data = await res.json().catch(() => ({}));
    if (res.ok && typeof data.url === "string") {
      window.open(data.url, "_blank", "noopener,noreferrer");
    }
  }

  if (!canFinance) return null;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-3 flex items-center gap-2 text-red-500">
        <FileText className="h-4 w-4" aria-hidden />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {t("company.receipts_section_title")}
        </h3>
      </div>
      <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">{t("company.receipts_section_hint")}</p>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {t("receipt.fiscal_year")}
          <input
            type="number"
            className="mt-1 w-28 rounded-xl border border-gray-200 px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            value={year}
            onChange={(e) => setYear(e.target.value)}
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
          {fullyEnabled && generating ? t("receipt.generating") : t("receipt.generate")}
        </button>
      </div>
      {fullyEnabled && message ? (
        <p className="mb-3 text-sm text-red-600 dark:text-red-400">{message}</p>
      ) : null}
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {t("receipt.list_title")}
      </h4>
      {fullyEnabled && loading ? (
        <p className="text-sm text-gray-500">{t("institution.loading")}</p>
      ) : fullyEnabled && receipts.length > 0 ? (
        <ul className="space-y-2 text-sm">
          {receipts.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-100 px-3 py-2 dark:border-gray-800"
            >
              <span className="text-gray-800 dark:text-gray-200">
                {r.fiscal_year} · v{r.version} ·{" "}
                {r.total_amount_eur != null ? `€${Number(r.total_amount_eur).toFixed(2)}` : "—"}
              </span>
              <span className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void download(r.id, "pdf")}
                  className="text-xs font-semibold text-red-600 hover:underline"
                >
                  {t("receipt.download_pdf")}
                </button>
                <button
                  type="button"
                  onClick={() => void download(r.id, "xml")}
                  className="text-xs font-semibold text-red-600 hover:underline"
                >
                  {t("receipt.download_xml")}
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400">{t("receipt.empty")}</p>
      )}
    </section>
  );
}
