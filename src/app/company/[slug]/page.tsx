import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { flags } from "@/lib/flags";
import type { PublicCompanyBundle } from "@/lib/types";
import { getLocale, getTranslator } from "@/i18n/server";
import { SDG_GOALS } from "@/lib/constants";
import {
  Badge,
  Card,
  PageHeader,
  PageShell,
  SectionHeader,
  Stat,
  buttonClasses,
} from "@/components/ui";

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
    // No `min-h-dvh` here: the layout already owns one, and a second nested
    // inside it is what pushed the footer below the fold on every visit.
    <PageShell width="content">
      <Link
        href="/map"
        className={buttonClasses({
          variant: "ghost",
          size: "sm",
          className: "mb-4 -ml-4",
        })}
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("company.public_company_back")}
      </Link>

      <div className="mb-8 flex flex-col gap-6 sm:flex-row sm:items-center">
        {c.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={c.logo_url}
            alt=""
            className="h-20 w-20 shrink-0 rounded-card object-contain ring-1 ring-border-subtle"
          />
        ) : (
          // The brand hue rides on `--cat`, the same channel the category
          // classes use, so the tint and ink are mixed against the theme's
          // surface/ink tokens rather than painted on as a light-mode literal
          // (white-on-accent could not be guaranteed readable either).
          <div
            style={{ "--cat": accent } as CSSProperties}
            className="category-tint category-accent flex h-20 w-20 shrink-0 items-center justify-center rounded-card text-2xl font-bold"
            aria-hidden
          >
            {(c.display_name ?? c.legal_name).slice(0, 1).toUpperCase()}
          </div>
        )}
        <PageHeader
          className="mb-0 flex-1"
          title={c.display_name?.trim() || c.legal_name}
          subtitle={c.tagline ?? undefined}
        />
      </div>

      <div className="space-y-10">
        <section className="grid gap-4 sm:grid-cols-3">
          <Stat label={t("company.public_company_metrics_given")} value={fmtEur(given)} />
          <Stat
            label={t("company.public_company_hours")}
            value={`${hours.toLocaleString(loc === "hr" ? "hr-HR" : "en-GB")} h`}
          />
          <Stat
            label={t("company.public_company_institutions")}
            value={inst.toLocaleString(loc === "hr" ? "hr-HR" : "en-GB")}
          />
        </section>

        {bundle.latest_report ? (
          <Card padding="lg">
            <SectionHeader
              className="mb-3"
              title={t("company.public_company_report")}
              description={`${bundle.latest_report.period_start} — ${bundle.latest_report.period_end}`}
            />
            <a
              href={`/api/public/company/${c.slug}/latest-report?redirect=1`}
              className={buttonClasses()}
            >
              {t("company.public_company_download")}
            </a>
          </Card>
        ) : null}

        {sdgList.length > 0 ? (
          <section>
            <SectionHeader title={t("company.public_company_sdg")} />
            <div className="flex flex-wrap gap-2">
              {sdgList.map((id) => (
                <Badge key={id}>{sdgLabel(id, loc)}</Badge>
              ))}
            </div>
          </section>
        ) : null}

        {bundle.campaigns.length > 0 ? (
          <section>
            <SectionHeader title={t("company.public_company_campaigns")} />
            <ul className="space-y-2">
              {bundle.campaigns.map((camp) => (
                <li key={camp.slug}>
                  <Card padding="sm">
                    <span className="text-base font-medium text-ink">{camp.name}</span>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {bundle.stories.length > 0 ? (
          <section>
            <SectionHeader title={t("company.public_company_stories")} />
            <div className="space-y-4">
              {bundle.stories.map((s, i) => (
                <Card key={`${s.institution_name}-${i}`} as="article">
                  <h3 className="text-base font-semibold text-ink">{s.institution_name}</h3>
                  <p className="mt-2 text-base leading-6 text-ink-secondary">{s.description}</p>
                </Card>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </PageShell>
  );
}
