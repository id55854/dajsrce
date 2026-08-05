"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { useT, useLocale } from "@/i18n/client";
import { flags } from "@/lib/flags";
import type { CompanyCsrReport, CompanyRole } from "@/lib/types";
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

export function CompanyCsrReportsSection({ companyId, memberRole, subscriptionTier }: Props) {
  const t = useT();
  const toast = useToast();
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
  const [refreshing, setRefreshing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      if (!canFinance || !flags.publicProfileEnabled || !tierAllows) {
        setLoading(false);
        return;
      }
      if (mode === "refresh") setRefreshing(true);
      try {
        const res = await fetch(`/api/companies/${companyId}/csr-reports`, {
          credentials: "include",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setLoadError(typeof data.error === "string" ? data.error : t("common.error_generic"));
          return;
        }
        setLoadError(null);
        setReports(data.reports ?? []);
      } catch {
        setLoadError(t("common.error_generic"));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [canFinance, companyId, tierAllows, t]
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
        reportFailure(data.error);
        return;
      }
      toast({
        tone: "success",
        title: t("company.csr_generated"),
        description: `${periodStart} → ${periodEnd}`,
      });
      await load("refresh");
    } catch {
      reportFailure();
    } finally {
      setGenerating(false);
    }
  }

  async function download(reportId: string, format: "pdf" | "docx") {
    const key = `${reportId}:${format}`;
    setDownloading(key);
    try {
      const res = await fetch(
        `/api/companies/${companyId}/csr-reports/${reportId}/download?format=${format}`,
        { credentials: "include" }
      );
      const data = await res.json().catch(() => ({}));
      // The old markup was an <a href> whose click handler swallowed every
      // failure: an unready or missing artifact produced no feedback at all.
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

  if (!canFinance || !tierAllows) {
    return null;
  }

  if (!flags.publicProfileEnabled) {
    return (
      <Card padding="lg" className="border-dashed shadow-none">
        <p className="text-sm text-ink-secondary">{t("company.csr_feature_off")}</p>
      </Card>
    );
  }

  return (
    <Card padding="lg">
      <SectionHeader
        title={
          <span className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-brand" aria-hidden="true" />
            {t("company.csr_section_title")}
          </span>
        }
        description={t("company.csr_section_hint")}
      />

      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("export.period_start")} className="w-40">
          {(field) => (
            <Input
              {...field}
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
            />
          )}
        </Field>
        <Field label={t("export.period_end")} className="w-40">
          {(field) => (
            <Input
              {...field}
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
            />
          )}
        </Field>
        <Button onClick={() => void generate()} loading={generating}>
          {t("company.csr_generate")}
        </Button>
      </div>

      <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
        {t("export.list_title")}
      </h3>

      {loading ? (
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
      ) : reports.length === 0 ? (
        <p className="text-sm text-ink-secondary">{t("company.csr_empty")}</p>
      ) : (
        <ul
          className={refreshing ? "space-y-2 opacity-60" : "space-y-2"}
          aria-busy={refreshing || undefined}
        >
          {reports.map((r) => (
            <li
              key={r.id}
              className="rounded-control border border-border-subtle bg-surface-sunken px-4 py-3"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:flex sm:items-start sm:gap-8">
                  <Cell
                    label={t("export.period_start")}
                    value={r.period_start}
                    width="sm:w-28"
                  />
                  <Cell label={t("export.period_end")} value={r.period_end} width="sm:w-28" />
                  {/* A timestamp needs no label to be scannable, and there is
                      no translated "generated at" string to give it one. */}
                  <div className="col-span-2 sm:w-48">
                    <time
                      dateTime={r.generated_at}
                      className="mt-4 block text-xs text-ink-tertiary sm:mt-5"
                    >
                      {new Date(r.generated_at).toLocaleString(
                        locale === "hr" ? "hr-HR" : "en-GB"
                      )}
                    </time>
                  </div>
                </dl>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void download(r.id, "pdf")}
                    loading={downloading === `${r.id}:pdf`}
                  >
                    PDF
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void download(r.id, "docx")}
                    loading={downloading === `${r.id}:docx`}
                  >
                    DOCX
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
