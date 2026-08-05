"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { useT } from "@/i18n/client";
import { flags } from "@/lib/flags";
import type { CompanyRole, DonationReceipt } from "@/lib/types";
import { SUBSCRIPTION_TIERS } from "@/lib/constants";
import type { SubscriptionTier } from "@/lib/types";
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  SectionHeader,
  Skeleton,
  useToast,
} from "@/components/ui";

type Props = {
  companyId: string;
  memberRole: CompanyRole;
  subscriptionTier: SubscriptionTier;
};

export function CompanyReceiptsSection({ companyId, memberRole, subscriptionTier }: Props) {
  const t = useT();
  const toast = useToast();
  const canFinance = memberRole === "owner" || memberRole === "admin" || memberRole === "finance";
  const tierAllows = SUBSCRIPTION_TIERS[subscriptionTier]?.taxReceipts === true;
  const fullyEnabled = flags.receiptsEnabled && tierAllows;

  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [receipts, setReceipts] = useState<DonationReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  // Field-level validation stays inline next to the control; every *outcome*
  // (generated, download failed) goes through the toast channel instead.
  const [yearError, setYearError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      if (!canFinance || !fullyEnabled) {
        setLoading(false);
        return;
      }
      if (mode === "refresh") setRefreshing(true);
      try {
        const res = await fetch(`/api/companies/${companyId}/receipts`, {
          credentials: "include",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setLoadError(typeof data.error === "string" ? data.error : t("common.error_generic"));
          return;
        }
        setLoadError(null);
        setReceipts(data.receipts ?? []);
      } catch {
        setLoadError(t("common.error_generic"));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [canFinance, companyId, fullyEnabled, t]
  );

  useEffect(() => {
    void load("initial");
  }, [load]);

  function reportFailure(detail?: unknown) {
    toast({
      tone: "error",
      title: t("errors.generic_title"),
      description: typeof detail === "string" ? detail : t("common.error_generic"),
    });
  }

  async function generate() {
    setYearError(null);
    const y = Number.parseInt(year, 10);
    if (!Number.isFinite(y) || y < 2000 || y > 2100) {
      setYearError(t("receipt.year_invalid"));
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
        reportFailure(data.error);
        return;
      }
      toast({
        tone: "success",
        title: t("receipt.generated"),
        description: `${t("receipt.fiscal_year")} ${y}`,
      });
      await load("refresh");
    } catch {
      reportFailure();
    } finally {
      setGenerating(false);
    }
  }

  async function download(receiptId: string, format: "pdf" | "xml") {
    const key = `${receiptId}:${format}`;
    setDownloading(key);
    try {
      const res = await fetch(
        `/api/companies/${companyId}/receipts/${receiptId}/download?format=${format}`,
        { credentials: "include" }
      );
      const data = await res.json().catch(() => ({}));
      // A download that produced no URL used to fail completely silently.
      if (!res.ok || typeof data.url !== "string") {
        reportFailure(data.error);
        return;
      }
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch {
      reportFailure();
    } finally {
      setDownloading(null);
    }
  }

  if (!canFinance) return null;

  return (
    <Card padding="lg">
      <SectionHeader
        title={
          <span className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-brand" aria-hidden="true" />
            {t("company.receipts_section_title")}
          </span>
        }
        description={t("company.receipts_section_hint")}
      />

      <div className="flex flex-wrap items-end gap-3">
        <Field
          label={t("receipt.fiscal_year")}
          error={yearError}
          className="w-32"
        >
          {(field) => (
            <Input
              {...field}
              type="number"
              inputMode="numeric"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              disabled={!fullyEnabled}
            />
          )}
        </Field>
        <Button
          onClick={() => void generate()}
          // Previously enabled-looking with a handler that returned early.
          disabled={!fullyEnabled}
          loading={generating}
        >
          {generating ? t("receipt.generating") : t("receipt.generate")}
        </Button>
      </div>

      <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
        {t("receipt.list_title")}
      </h3>

      {!fullyEnabled ? (
        <p className="text-sm text-ink-secondary">{t("receipt.empty")}</p>
      ) : loading ? (
        <ul className="space-y-2" aria-busy="true">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-16 rounded-control" />
          ))}
        </ul>
      ) : loadError ? (
        <EmptyState
          title={t("errors.generic_title")}
          description={loadError}
          action={
            <Button variant="secondary" size="sm" onClick={() => void load("refresh")}>
              {t("errors.retry")}
            </Button>
          }
        />
      ) : receipts.length === 0 ? (
        <p className="text-sm text-ink-secondary">{t("receipt.empty")}</p>
      ) : (
        <ul
          className={refreshing ? "space-y-2 opacity-60" : "space-y-2"}
          aria-busy={refreshing || undefined}
        >
          {receipts.map((r) => (
            <li
              key={r.id}
              className="rounded-control border border-border-subtle bg-surface-sunken px-4 py-3"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:flex sm:items-start sm:gap-8">
                  <Cell label={t("receipt.fiscal_year")} value={r.fiscal_year} width="sm:w-24" />
                  <Cell label="v" value={r.version} width="sm:w-12" />
                  <Cell
                    label={t("institution.pledges_amount")}
                    value={
                      r.total_amount_eur != null
                        ? formatEur(Number(r.total_amount_eur))
                        : "—"
                    }
                    width="sm:w-32"
                  />
                </dl>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void download(r.id, "pdf")}
                    loading={downloading === `${r.id}:pdf`}
                  >
                    {t("receipt.download_pdf")}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void download(r.id, "xml")}
                    loading={downloading === `${r.id}:xml`}
                  >
                    {t("receipt.download_xml")}
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * One row cell: label above value, so every field stays independently
 * scannable instead of being concatenated into one string that wraps
 * mid-metadata on small screens.
 */
function Cell({
  label,
  value,
  width,
}: {
  label: string;
  value: React.ReactNode;
  width?: string;
}) {
  return (
    <div className={width}>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-tertiary">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink">{value}</dd>
    </div>
  );
}

function formatEur(value: number): string {
  return new Intl.NumberFormat("hr-HR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(value);
}
