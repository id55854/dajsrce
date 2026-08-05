"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileArchive } from "lucide-react";
import { useT, useLocale } from "@/i18n/client";
import { flags } from "@/lib/flags";
import type { CompanyRole, EsgExport, Framework } from "@/lib/types";
import { FRAMEWORK_LABELS, SUBSCRIPTION_TIERS } from "@/lib/constants";
import type { SubscriptionTier } from "@/lib/types";
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  SectionHeader,
  Select,
  Skeleton,
  useToast,
} from "@/components/ui";

const ALL_FRAMEWORKS = Object.keys(FRAMEWORK_LABELS) as Framework[];

type Props = {
  companyId: string;
  memberRole: CompanyRole;
  subscriptionTier: SubscriptionTier;
};

export function CompanyExportsSection({ companyId, memberRole, subscriptionTier }: Props) {
  const t = useT();
  const toast = useToast();
  const { locale } = useLocale();
  const canFinance = memberRole === "owner" || memberRole === "admin" || memberRole === "finance";
  const allowedFrameworks = SUBSCRIPTION_TIERS[subscriptionTier].exports;
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
  const [refreshing, setRefreshing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [frameworkError, setFrameworkError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (displayFrameworks.length && !displayFrameworks.includes(framework)) {
      setFramework(displayFrameworks[0]!);
    }
  }, [displayFrameworks, framework]);

  const frameworkLabel = useCallback(
    (value: Framework) => {
      const entry = FRAMEWORK_LABELS[value];
      if (!entry) return value;
      return locale === "hr" ? entry.labelHr : entry.label;
    },
    [locale]
  );

  const load = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      if (!canFinance || !fullyEnabled) {
        setLoading(false);
        return;
      }
      if (mode === "refresh") setRefreshing(true);
      try {
        const res = await fetch(`/api/companies/${companyId}/exports`, {
          credentials: "include",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setLoadError(typeof data.error === "string" ? data.error : t("common.error_generic"));
          return;
        }
        setLoadError(null);
        setExports(data.exports ?? []);
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
    setFrameworkError(null);
    if (!framework) {
      setFrameworkError(t("export.framework_required"));
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
        reportFailure(data.error);
        return;
      }
      toast({
        tone: "success",
        title: t("export.generated"),
        description: `${frameworkLabel(framework)} · ${periodStart} — ${periodEnd}`,
      });
      await load("refresh");
    } catch {
      reportFailure();
    } finally {
      setGenerating(false);
    }
  }

  async function download(exportId: string) {
    setDownloading(exportId);
    try {
      const res = await fetch(`/api/companies/${companyId}/exports/${exportId}/download`, {
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      // Was `if (res.ok && …)` with no else: a rejected download said nothing.
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
            <FileArchive className="h-4 w-4 text-brand" aria-hidden="true" />
            {t("company.exports_section_title")}
          </span>
        }
        description={t("company.exports_section_hint")}
      />

      <div className="flex flex-wrap items-end gap-3">
        <Field
          label={t("export.framework")}
          error={frameworkError}
          className="min-w-[13rem] flex-1 sm:flex-none"
        >
          {(field) => (
            <Select
              {...field}
              value={framework}
              onChange={(e) => setFramework(e.target.value as Framework)}
              disabled={!fullyEnabled}
            >
              {displayFrameworks.map((f) => (
                <option key={f} value={f}>
                  {frameworkLabel(f)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("export.period_start")} className="w-40">
          {(field) => (
            <Input
              {...field}
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              disabled={!fullyEnabled}
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
              disabled={!fullyEnabled}
            />
          )}
        </Field>
        <Button
          onClick={() => void generate()}
          disabled={!fullyEnabled}
          loading={generating}
        >
          {generating ? t("export.generating") : t("export.generate")}
        </Button>
      </div>

      <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
        {t("export.list_title")}
      </h3>

      {!fullyEnabled ? (
        <p className="text-sm text-ink-secondary">{t("export.empty")}</p>
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
      ) : exports.length === 0 ? (
        <p className="text-sm text-ink-secondary">{t("export.empty")}</p>
      ) : (
        <ul
          className={refreshing ? "space-y-2 opacity-60" : "space-y-2"}
          aria-busy={refreshing || undefined}
        >
          {exports.map((ex) => (
            <li
              key={ex.id}
              className="rounded-control border border-border-subtle bg-surface-sunken px-4 py-3"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                {/* Framework, period and version were one concatenated string,
                    so nothing could be scanned down a column. */}
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:flex sm:items-start sm:gap-8">
                  <Cell
                    label={t("export.framework")}
                    value={frameworkLabel(ex.framework)}
                    width="col-span-2 sm:w-56"
                  />
                  <Cell
                    label={t("export.period_start")}
                    value={ex.period_start}
                    width="sm:w-28"
                  />
                  <Cell label={t("export.period_end")} value={ex.period_end} width="sm:w-28" />
                  <Cell label="v" value={ex.version} width="sm:w-12" />
                </dl>
                <div className="shrink-0">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void download(ex.id)}
                    loading={downloading === ex.id}
                  >
                    {t("export.download_zip")}
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
