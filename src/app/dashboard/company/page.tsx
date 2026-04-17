import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, FileDown, Plus, TrendingUp } from "lucide-react";
import { getCurrentUserProfile } from "@/lib/auth/server";
import { listMyCompanies, resolveActiveCompany } from "@/lib/companies-server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { headroomEur, remainingHeadroomEur, consumedPct, ceilingPct } from "@/lib/tax";
import { getTranslator } from "@/i18n/server";

type SearchParams = { [key: string]: string | string[] | undefined };

export default async function CompanyDashboardPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const profile = await getCurrentUserProfile();
  if (!profile) redirect("/auth/login?next=/dashboard/company");

  const memberships = await listMyCompanies();
  if (memberships.length === 0) redirect("/dashboard/company/new");

  const params = (await searchParams) ?? {};
  const cidRaw = params.cid;
  const cid = Array.isArray(cidRaw) ? cidRaw[0] : cidRaw;
  const { active } = await resolveActiveCompany(cid);
  if (!active) redirect("/dashboard/company/new");

  const supabase = await createServerSupabaseClient();

  const [pledgesRes, campaignsRes, membersRes, actionsRes] = await Promise.all([
    supabase
      .from("pledges")
      .select("id, quantity, created_at, status, need:needs(id, donation_type)")
      .eq("company_id", active.company.id)
      .gte("created_at", new Date(new Date().getFullYear(), 0, 1).toISOString()),
    supabase
      .from("campaigns")
      .select("id, name, slug, is_active, starts_at, ends_at")
      .eq("company_id", active.company.id)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("company_members")
      .select("id")
      .eq("company_id", active.company.id),
    supabase
      .from("company_actions")
      .select("id, ngo_name, support_type, status, created_at, confirmation_slug")
      .eq("company_profile_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const pledgeCount = pledgesRes.data?.length ?? 0;
  const totalMembers = membersRes.data?.length ?? 0;
  const activeCampaigns = campaignsRes.data?.length ?? 0;

  // Pledge quantity isn't amount-in-EUR; for now treat quantity as a unit
  // count and cannot compute EUR totals until Phase 1 introduces per-line
  // amount tracking. We still surface headroom from the configured prior
  // year revenue so the finance team has an early calibration signal.
  const headroom = headroomEur(active.company.prior_year_revenue_eur);
  const givenEur = 0; // Phase 1 attaches an EUR amount per pledge.
  const consumed = consumedPct(givenEur, active.company.prior_year_revenue_eur);
  const remaining = remainingHeadroomEur(givenEur, active.company.prior_year_revenue_eur);

  const recentActions = actionsRes.data ?? [];

  const t = await getTranslator();

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t("company.dashboard_title")}
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t("company.dashboard_subtitle")}
          </p>
        </div>
        <Link
          href="/dashboard/company/new-action"
          className="inline-flex items-center gap-2 rounded-full bg-red-500 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-red-600"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t("company.campaigns_new")}
        </Link>
      </header>

      <section className="grid gap-4 md:grid-cols-4">
        <Metric
          icon={<Building2 className="h-4 w-4" />}
          label={t("company.metric_members")}
          value={totalMembers.toString()}
        />
        <Metric
          icon={<TrendingUp className="h-4 w-4" />}
          label={t("company.metric_pledges_ytd")}
          value={pledgeCount.toString()}
        />
        <Metric
          icon={<TrendingUp className="h-4 w-4" />}
          label={t("company.metric_campaigns")}
          value={activeCampaigns.toString()}
        />
        <Metric
          icon={<FileDown className="h-4 w-4" />}
          label={t("company.metric_headroom")}
          value={formatEur(remaining)}
          hint={`${t("tax.ceiling_hint", { pct: ceilingPct().toFixed(1) })} · ${consumed.toFixed(1)}%`}
          accent={headroom > 0 ? "ok" : "muted"}
        />
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <Card title={t("company.campaigns_title")}>
          {campaignsRes.data && campaignsRes.data.length > 0 ? (
            <ul className="space-y-2">
              {campaignsRes.data.map((c) => (
                <li key={c.id} className="flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-800 dark:text-gray-200">{c.name}</span>
                  <Link
                    href={`/dashboard/company/campaigns?cid=${active.company.id}&campaign=${c.id}`}
                    className="text-xs font-semibold text-red-500 hover:underline"
                  >
                    {t("common.edit")}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">{t("company.campaigns_empty")}</p>
          )}
          <Link
            href={`/dashboard/company/campaigns?cid=${active.company.id}`}
            className="mt-4 inline-block text-xs font-semibold text-red-500 hover:underline"
          >
            {t("company.campaigns_title")} →
          </Link>
        </Card>

        <Card title="Recent support actions">
          {recentActions.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No logged actions yet. Use the <span className="font-medium">New action</span> button to record a corporate donation.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {recentActions.map((action) => (
                <li key={action.id} className="flex items-center justify-between gap-2">
                  <span className="truncate text-gray-800 dark:text-gray-200">{action.ngo_name}</span>
                  <Link
                    href={`/company/confirmations/${action.confirmation_slug}`}
                    className="text-xs font-semibold text-red-500 hover:underline"
                  >
                    Download
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  hint,
  accent = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  accent?: "default" | "ok" | "muted";
}) {
  return (
    <div
      className={`rounded-2xl border p-5 shadow-sm ${
        accent === "ok"
          ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20"
          : accent === "muted"
          ? "border-gray-200 bg-gray-50/80 dark:border-gray-800 dark:bg-gray-900/70"
          : "border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
      }`}
    >
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        <span className="text-red-500">{icon}</span>
        {label}
      </div>
      <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
      {hint ? <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</p> : null}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
      {children}
    </div>
  );
}

function formatEur(value: number): string {
  if (!value || value <= 0) return "—";
  return new Intl.NumberFormat("hr-HR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}
