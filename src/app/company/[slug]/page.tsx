import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { flags } from "@/lib/flags";
import type { PublicCompanyBundle } from "@/lib/types";
import { getLocale, getTranslator } from "@/i18n/server";
import { SDG_GOALS } from "@/lib/constants";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  if (!flags.publicProfileEnabled) {
    return { title: "DajSrce" };
  }
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.rpc("get_public_company_bundle", { p_slug: slug });
  if (!data) {
    return { title: "DajSrce" };
  }
  const bundle = data as unknown as PublicCompanyBundle;
  const title = bundle.company.display_name?.trim() || bundle.company.legal_name;
  return {
    title: `${title} · DajSrce`,
    description: bundle.company.tagline ?? undefined,
    openGraph: {
      title,
      description: bundle.company.tagline ?? undefined,
      images: base ? [`${base}/api/og/company/${slug}`] : [],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: bundle.company.tagline ?? undefined,
      images: base ? [`${base}/api/og/company/${slug}`] : [],
    },
  };
}

function sdgLabel(n: number, locale: "hr" | "en"): string {
  const row = SDG_GOALS.find((g) => g.id === n);
  if (!row) return String(n);
  return locale === "hr" ? row.labelHr : row.label;
}

export default async function PublicCompanyPage({ params }: Props) {
  const { slug } = await params;
  if (!flags.publicProfileEnabled) {
    notFound();
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_public_company_bundle", { p_slug: slug });

  if (error || !data) {
    notFound();
  }

  const bundle = data as unknown as PublicCompanyBundle;
  const t = await getTranslator();
  const locale = await getLocale();
  const loc = locale === "en" ? "en" : "hr";

  const c = bundle.company;
  const m = bundle.metrics;
  const given = Number(m.total_given_eur);
  const hours = Number(m.volunteer_hours);
  const inst = Number(m.institutions_supported);

  const sdgSet = new Set<number>();
  for (const camp of bundle.campaigns) {
    for (const tag of camp.sdg_tags ?? []) {
      sdgSet.add(tag);
    }
  }
  const sdgList = [...sdgSet].sort((a, b) => a - b);

  const accent = c.brand_primary_hex && /^#[0-9A-Fa-f]{6}$/.test(c.brand_primary_hex) ? c.brand_primary_hex : "#EF4444";

  const fmtEur = (n: number) =>
    new Intl.NumberFormat(loc === "hr" ? "hr-HR" : "en-GB", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(n);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header
        className="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
        style={{ borderBottomColor: `${accent}33` }}
      >
        <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center">
          {c.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={c.logo_url}
              alt=""
              className="h-20 w-20 shrink-0 rounded-2xl object-contain ring-1 ring-gray-200 dark:ring-gray-700"
            />
          ) : (
            <div
              className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl text-2xl font-bold text-white"
              style={{ backgroundColor: accent }}
              aria-hidden
            >
              {(c.display_name ?? c.legal_name).slice(0, 1).toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              {c.display_name?.trim() || c.legal_name}
            </h1>
            {c.tagline ? (
              <p className="mt-2 text-lg text-gray-600 dark:text-gray-400">{c.tagline}</p>
            ) : null}
            <Link
              href="/map"
              className="mt-4 inline-block text-sm font-semibold text-red-600 hover:underline dark:text-red-400"
            >
              DajSrce
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-10 px-4 py-10">
        <section className="grid gap-4 sm:grid-cols-3">
          <MetricCard label={t("company.public_company_metrics_given")} value={fmtEur(given)} accent={accent} />
          <MetricCard
            label={t("company.public_company_hours")}
            value={`${hours.toLocaleString(loc === "hr" ? "hr-HR" : "en-GB")} h`}
            accent={accent}
          />
          <MetricCard
            label={t("company.public_company_institutions")}
            value={inst.toLocaleString(loc === "hr" ? "hr-HR" : "en-GB")}
            accent={accent}
          />
        </section>

        {bundle.latest_report ? (
          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t("company.public_company_report")}
            </h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {bundle.latest_report.period_start} — {bundle.latest_report.period_end}
            </p>
            <a
              href={`/api/public/company/${c.slug}/latest-report?redirect=1`}
              className="mt-4 inline-flex rounded-full px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90"
              style={{ backgroundColor: accent }}
            >
              {t("company.public_company_download")}
            </a>
          </section>
        ) : null}

        {sdgList.length > 0 ? (
          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t("company.public_company_sdg")}
            </h2>
            <div className="flex flex-wrap gap-2">
              {sdgList.map((id) => (
                <span
                  key={id}
                  className="rounded-full bg-gray-200 px-3 py-1 text-xs font-medium text-gray-800 dark:bg-gray-800 dark:text-gray-200"
                >
                  {sdgLabel(id, loc)}
                </span>
              ))}
            </div>
          </section>
        ) : null}

        {bundle.campaigns.length > 0 ? (
          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t("company.public_company_campaigns")}
            </h2>
            <ul className="space-y-2">
              {bundle.campaigns.map((camp) => (
                <li
                  key={camp.slug}
                  className="rounded-xl border border-gray-100 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900"
                >
                  <span className="font-medium text-gray-900 dark:text-gray-100">{camp.name}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {bundle.stories.length > 0 ? (
          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t("company.public_company_stories")}
            </h2>
            <div className="space-y-4">
              {bundle.stories.map((s, i) => (
                <article
                  key={`${s.institution_name}-${i}`}
                  className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900"
                >
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100">{s.institution_name}</h3>
                  <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{s.description}</p>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}

function MetricCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div
      className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900"
      style={{ borderTopWidth: 3, borderTopColor: accent }}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-2 text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
    </div>
  );
}
