"use client";

import Link from "next/link";
import clsx from "clsx";
import { ArrowRight, Heart, PackageCheck } from "lucide-react";
import { useT } from "@/i18n/client";
import { timeAgo } from "@/lib/utils";

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

const STATUS_STYLES: Record<
  YourPledgeRow["status"],
  { bg: string; text: string; key: string }
> = {
  pledged: {
    bg: "bg-amber-50 dark:bg-amber-950/40",
    text: "text-amber-800 dark:text-amber-200",
    key: "your_pledges.status_pledged",
  },
  delivered: {
    bg: "bg-blue-50 dark:bg-blue-950/40",
    text: "text-blue-800 dark:text-blue-200",
    key: "your_pledges.status_delivered",
  },
  confirmed: {
    bg: "bg-emerald-50 dark:bg-emerald-950/40",
    text: "text-emerald-800 dark:text-emerald-200",
    key: "your_pledges.status_confirmed",
  },
  cancelled: {
    bg: "bg-gray-100 dark:bg-gray-800",
    text: "text-gray-500 dark:text-gray-400",
    key: "your_pledges.status_cancelled",
  },
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
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t("your_pledges.signed_out")}
        </p>
      </SectionWrapper>
    );
  }

  if (loading && pledges.length === 0) {
    return (
      <SectionWrapper title={t("your_pledges.section_title")}>
        <div className="flex gap-3 overflow-hidden">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-28 w-64 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800"
            />
          ))}
        </div>
      </SectionWrapper>
    );
  }

  if (pledges.length === 0) {
    return (
      <SectionWrapper title={t("your_pledges.section_title")}>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t("your_pledges.empty")}
        </p>
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
          className="inline-flex items-center gap-1 text-sm font-medium text-red-600 hover:underline"
        >
          {t("your_pledges.view_all")}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      }
    >
      <ul
        className="flex snap-x gap-3 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible"
        role="list"
      >
        {visible.map((p) => {
          const style = STATUS_STYLES[p.status] ?? STATUS_STYLES.pledged;
          return (
            <li
              key={p.id}
              className="w-72 shrink-0 snap-start md:w-72 md:max-w-xs"
            >
              <article className="flex h-full flex-col rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <span
                    className={clsx(
                      "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                      style.bg,
                      style.text
                    )}
                  >
                    {p.status === "delivered" || p.status === "confirmed" ? (
                      <PackageCheck className="h-3 w-3" aria-hidden />
                    ) : (
                      <Heart className="h-3 w-3" aria-hidden />
                    )}
                    {t(style.key)}
                  </span>
                  <time
                    className="shrink-0 text-[11px] text-gray-400"
                    dateTime={p.created_at}
                  >
                    {timeAgo(p.created_at)}
                  </time>
                </div>
                <h3 className="line-clamp-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {p.need?.title ?? "—"}
                </h3>
                {p.need?.institution?.name ? (
                  <p className="mt-0.5 line-clamp-1 text-xs text-gray-500 dark:text-gray-400">
                    {p.need.institution.name}
                  </p>
                ) : null}
                <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-600 dark:text-gray-400">
                  <div>
                    <dt className="inline font-medium uppercase tracking-wide text-gray-400">
                      {t("your_pledges.qty_label")}:{" "}
                    </dt>
                    <dd className="inline font-semibold text-gray-900 dark:text-gray-100">
                      {p.quantity}
                    </dd>
                  </div>
                  {p.amount_eur != null ? (
                    <div>
                      <dt className="inline font-medium uppercase tracking-wide text-gray-400">
                        {t("your_pledges.amount_label")}:{" "}
                      </dt>
                      <dd className="inline font-semibold text-gray-900 dark:text-gray-100">
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
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          +{overflow} more
        </p>
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
      className="mb-8 rounded-2xl border border-gray-100 bg-gradient-to-br from-red-50/40 to-white p-5 shadow-sm dark:border-gray-800 dark:from-gray-900 dark:to-gray-950"
      aria-labelledby="your-pledges-heading"
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2
            id="your-pledges-heading"
            className="text-base font-semibold text-gray-900 dark:text-gray-100"
          >
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {subtitle}
            </p>
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
