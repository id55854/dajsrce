"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CreditCard, ExternalLink } from "lucide-react";
import { useT, useLocale } from "@/i18n/client";
import { SUBSCRIPTION_TIERS } from "@/lib/constants";
import type { CompanyRole, SubscriptionTier } from "@/lib/types";
import { Button, Card, SectionHeader, useToast } from "@/components/ui";

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
  const router = useRouter();
  const toast = useToast();
  const canManage = myRole === "owner" || myRole === "admin";
  const [loading, setLoading] = useState<string | null>(null);

  if (!canManage) return null;

  function reportFailure(detail?: unknown, fallback?: string) {
    toast({
      tone: "error",
      title: t("errors.generic_title"),
      description:
        typeof detail === "string" ? detail : fallback ?? t("billing.error_generic"),
    });
  }

  async function applyDemoTier(tier: SubscriptionTier) {
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
        reportFailure(data.error, t("common.error_generic"));
        return;
      }
      toast({ tone: "success", title: t("billing.demo_applied") });
      // Was `window.location.reload()`, which threw away client state and
      // re-downloaded the document for what is a server-data change.
      router.refresh();
    } catch {
      reportFailure(undefined, t("common.error_generic"));
    } finally {
      setLoading(null);
    }
  }

  async function checkout(tier: "sme_tax" | "sme_plus" | "enterprise") {
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
        reportFailure(data.error);
        return;
      }
      if (typeof data.url === "string") {
        window.location.href = data.url;
        return;
      }
      // A 200 with no redirect URL used to leave the button silently idle.
      reportFailure();
    } catch {
      reportFailure();
    } finally {
      setLoading(null);
    }
  }

  async function portal() {
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
        reportFailure(data.error);
        return;
      }
      if (typeof data.url === "string") {
        window.location.href = data.url;
        return;
      }
      reportFailure();
    } catch {
      reportFailure();
    } finally {
      setLoading(null);
    }
  }

  const tierLabel =
    locale === "hr"
      ? SUBSCRIPTION_TIERS[subscriptionTier].labelHr
      : SUBSCRIPTION_TIERS[subscriptionTier].label;

  return (
    <Card padding="lg">
      <SectionHeader
        title={
          <span className="flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-brand" aria-hidden="true" />
            {t("company.settings_billing_section")}
          </span>
        }
        description={t("billing.portal_hint")}
      />

      <p className="mb-4 text-sm font-medium text-ink">{tierLabel}</p>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={loading !== null}
          loading={loading === "sme_tax"}
          onClick={() => void checkout("sme_tax")}
        >
          {t("billing.checkout_sme_tax")}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={loading !== null}
          loading={loading === "sme_plus"}
          onClick={() => void checkout("sme_plus")}
        >
          {t("billing.checkout_sme_plus")}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={loading !== null}
          loading={loading === "enterprise"}
          onClick={() => void checkout("enterprise")}
        >
          {t("billing.checkout_enterprise")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={loading !== null}
          loading={loading === "portal"}
          onClick={() => void portal()}
          icon={<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />}
        >
          {t("billing.open_portal")}
        </Button>
      </div>

      {allowDemoBilling ? (
        <div className="mt-6 rounded-control border border-warning/30 bg-warning-soft p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-warning-on-soft">
            {t("billing.demo_title")}
          </p>
          <p className="mt-1 text-sm text-warning-on-soft/90">{t("billing.demo_hint")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(["sme_tax", "sme_plus", "enterprise", "free"] as const).map((tier) => (
              <Button
                key={tier}
                size="sm"
                variant="secondary"
                disabled={loading !== null}
                loading={loading === `demo-${tier}`}
                onClick={() => void applyDemoTier(tier)}
              >
                {tier === "free"
                  ? t("billing.demo_tier_free")
                  : tier === "sme_tax"
                    ? t("billing.checkout_sme_tax")
                    : tier === "sme_plus"
                      ? t("billing.checkout_sme_plus")
                      : t("billing.checkout_enterprise")}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
