"use client";

import Link from "next/link";
import { ArrowRight, Heart, PackageCheck } from "lucide-react";
import { useT } from "@/i18n/client";
import { timeAgo } from "@/lib/utils";
import { Badge, Skeleton } from "@/components/ui";
import type { BadgeTone } from "@/components/ui";

/** Shape returned by GET /api/pledges (with `need:needs(*, institution:...)`). */
export type YourPledgeRow = {
  id: string;
  user_id: string;
  need_id: string;
  quantity: number;
  amount_eur?: number | null;
  status: "pledged" | "delivered" | "confirmed" | "cancelled";
  created_at: string;
  need?: {
    id: string;
    title: string;
    institution?: { id: string; name: string } | null;
  } | null;
};

/**
 * The one pledge-status vocabulary. Previously this file carried its own
 * amber/blue/emerald class strings while the individual dashboard rendered the
 * same statuses in a single generic red — the tones now come from `Badge`.
 */
const STATUS: Record<YourPledgeRow["status"], { tone: BadgeTone; key: string }> = {
  pledged: { tone: "warning", key: "your_pledges.status_pledged" },
  delivered: { tone: "info", key: "your_pledges.status_delivered" },
  confirmed: { tone: "success", key: "your_pledges.status_confirmed" },
  cancelled: { tone: "neutral", key: "your_pledges.status_cancelled" },
};

const VISIBLE_LIMIT = 6;

export function YourPledgesSection({
  loggedIn,
  loading,
  pledges,
}: {
  loggedIn: boolean;
  loading: boolean;
  pledges: YourPledgeRow[];
}) {
  const t = useT();

  if (!loggedIn) {
    return (
      <SectionWrapper title={t("your_pledges.section_title")}>
        <p className="text-sm text-ink-secondary">{t("your_pledges.signed_out")}</p>
      </SectionWrapper>
    );
  }

  if (loading && pledges.length === 0) {
    return (
      <SectionWrapper title={t("your_pledges.section_title")}>
        <div className="flex gap-3 overflow-hidden" aria-busy="true">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-64 shrink-0 rounded-card" />
          ))}
        </div>
      </SectionWrapper>
    );
  }

  if (pledges.length === 0) {
    return (
      <SectionWrapper title={t("your_pledges.section_title")}>
        <p className="text-sm text-ink-secondary">{t("your_pledges.empty")}</p>
      </SectionWrapper>
    );
  }

  const visible = pledges.slice(0, VISIBLE_LIMIT);
  const overflow = pledges.length - visible.length;

  return (
    <SectionWrapper
      title={t("your_pledges.section_title")}
      subtitle={t("your_pledges.section_subtitle")}
      action={
        <Link
          href="/dashboard/individual"
          className="inline-flex items-center gap-1 rounded text-sm font-semibold text-brand transition-colors hover:text-brand-strong hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          {t("your_pledges.view_all")}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      }
    >
      <ul className="flex snap-x gap-3 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible" role="list">
        {visible.map((p) => {
          const status = STATUS[p.status] ?? STATUS.pledged;
          return (
            <li key={p.id} className="w-72 shrink-0 snap-start md:max-w-xs">
              <article className="flex h-full flex-col rounded-card border border-border-subtle bg-surface-raised p-4 shadow-raised">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <Badge
                    tone={status.tone}
                    size="sm"
                    icon={
                      p.status === "delivered" || p.status === "confirmed" ? (
                        <PackageCheck className="h-3 w-3" aria-hidden="true" />
                      ) : (
                        <Heart className="h-3 w-3" aria-hidden="true" />
                      )
                    }
                  >
                    {t(status.key)}
                  </Badge>
                  <time className="shrink-0 text-xs text-ink-tertiary" dateTime={p.created_at}>
                    {timeAgo(p.created_at)}
                  </time>
                </div>
                <h3 className="line-clamp-2 text-sm font-semibold text-ink">
                  {p.need?.title ?? "—"}
                </h3>
                {p.need?.institution?.name ? (
                  <p className="mt-0.5 line-clamp-1 text-xs text-ink-secondary">
                    {p.need.institution.name}
                  </p>
                ) : null}
                <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <div>
                    <dt className="inline font-medium uppercase tracking-wide text-ink-tertiary">
                      {t("your_pledges.qty_label")}:{" "}
                    </dt>
                    <dd className="inline font-semibold tabular-nums text-ink">{p.quantity}</dd>
                  </div>
                  {p.amount_eur != null ? (
                    <div>
                      <dt className="inline font-medium uppercase tracking-wide text-ink-tertiary">
                        {t("your_pledges.amount_label")}:{" "}
                      </dt>
                      <dd className="inline font-semibold tabular-nums text-ink">
                        {formatEur(p.amount_eur)}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </article>
            </li>
          );
        })}
      </ul>
      {overflow > 0 ? (
        <p className="mt-2 text-xs text-ink-tertiary">+{overflow} more</p>
      ) : null}
    </SectionWrapper>
  );
}

function SectionWrapper({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      className="mb-8 rounded-card border border-border-subtle bg-surface-raised p-5 shadow-raised"
      aria-labelledby="your-pledges-heading"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="your-pledges-heading" className="text-lg font-semibold text-ink">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-1 text-sm text-ink-secondary">{subtitle}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function formatEur(value: number): string {
  return new Intl.NumberFormat("hr-HR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}
