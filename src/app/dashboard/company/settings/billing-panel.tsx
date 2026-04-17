"use client";

import { useState } from "react";
import { CreditCard, ExternalLink, Loader2 } from "lucide-react";
import { useT, useLocale } from "@/i18n/client";
import { SUBSCRIPTION_TIERS } from "@/lib/constants";
import type { CompanyRole, SubscriptionTier } from "@/lib/types";

type Props = {
  companyId: string;
  myRole: CompanyRole;
  subscriptionTier: SubscriptionTier;
  /** When true (ALLOW_DEMO_BILLING on server), show tier buttons without Stripe. */
  allowDemoBilling?: boolean;
};

export function BillingPanel({
  companyId,
  myRole,
  subscriptionTier,
  allowDemoBilling = false,
}: Props) {
  const t = useT();
  const { locale } = useLocale();
  const canManage = myRole === "owner" || myRole === "admin";
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (!canManage) return null;

  async function applyDemoTier(tier: SubscriptionTier) {
    setMessage(null);
    setLoading(`demo-${tier}`);
    try {
      const res = await fetch("/api/demo/apply-tier", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: companyId, tier }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(typeof data.error === "string" ? data.error : t("common.error_generic"));
        return;
      }
      setMessage(t("billing.demo_applied"));
      window.location.reload();
    } finally {
      setLoading(null);
    }
  }

  async function checkout(tier: "sme_tax" | "sme_plus" | "enterprise") {
    setMessage(null);
    setLoading(tier);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: companyId, tier }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(typeof data.error === "string" ? data.error : t("billing.error_generic"));
        return;
      }
      if (typeof data.url === "string") {
        window.location.href = data.url;
      }
    } finally {
      setLoading(null);
    }
  }

  async function portal() {
    setMessage(null);
    setLoading("portal");
    try {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: companyId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(typeof data.error === "string" ? data.error : t("billing.error_generic"));
        return;
      }
      if (typeof data.url === "string") {
        window.location.href = data.url;
      }
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
        <CreditCard className="h-4 w-4 text-red-500" aria-hidden />
        {t("company.settings_billing_section")}
      </h3>
      <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
        {t("billing.portal_hint")} · {t("company.settings_finance_section")}
      </p>
      {message ? <p className="mb-3 text-sm text-red-600 dark:text-red-400">{message}</p> : null}
      <p className="mb-3 text-xs text-gray-600 dark:text-gray-400">
        {locale === "hr"
          ? SUBSCRIPTION_TIERS[subscriptionTier].labelHr
          : SUBSCRIPTION_TIERS[subscriptionTier].label}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={loading !== null}
          onClick={() => void checkout("sme_tax")}
          className="rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          {loading === "sme_tax" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}{" "}
          {t("billing.checkout_sme_tax")}
        </button>
        <button
          type="button"
          disabled={loading !== null}
          onClick={() => void checkout("sme_plus")}
          className="rounded-full border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          {loading === "sme_plus" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}{" "}
          {t("billing.checkout_sme_plus")}
        </button>
        <button
          type="button"
          disabled={loading !== null}
          onClick={() => void checkout("enterprise")}
          className="rounded-full border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          {loading === "enterprise" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}{" "}
          {t("billing.checkout_enterprise")}
        </button>
        <button
          type="button"
          disabled={loading !== null}
          onClick={() => void portal()}
          className="inline-flex items-center gap-1 rounded-full border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          {loading === "portal" ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
          {t("billing.open_portal")}
        </button>
      </div>

      {allowDemoBilling ? (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50/80 p-4 dark:border-amber-900/60 dark:bg-amber-950/30">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-900 dark:text-amber-200">
            {t("billing.demo_title")}
          </p>
          <p className="mt-1 text-xs text-amber-900/90 dark:text-amber-100/80">{t("billing.demo_hint")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(["sme_tax", "sme_plus", "enterprise", "free"] as const).map((tier) => (
              <button
                key={tier}
                type="button"
                disabled={loading !== null}
                onClick={() => void applyDemoTier(tier)}
                className="rounded-full border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-950 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100 dark:hover:bg-amber-900/40"
              >
                {loading === `demo-${tier}` ? <Loader2 className="h-3 w-3 animate-spin inline" /> : null}{" "}
                {tier === "free"
                  ? t("billing.demo_tier_free")
                  : tier === "sme_tax"
                    ? t("billing.checkout_sme_tax")
                    : tier === "sme_plus"
                      ? t("billing.checkout_sme_plus")
                      : t("billing.checkout_enterprise")}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
