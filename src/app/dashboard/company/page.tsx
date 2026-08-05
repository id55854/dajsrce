import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, FileDown, Megaphone, Plus, TrendingUp } from "lucide-react";
import { getCurrentUserProfile } from "@/lib/auth/server";
import { listMyCompanies, resolveActiveCompany } from "@/lib/companies-server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { headroomEur, remainingHeadroomEur, consumedPct, ceilingPct } from "@/lib/tax";
import { getTranslator } from "@/i18n/server";
import { CompanyReceiptsSection } from "@/components/CompanyReceiptsSection";
import { CompanyExportsSection } from "@/components/CompanyExportsSection";
import { CompanyCsrReportsSection } from "@/components/CompanyCsrReportsSection";
import { Card, PageHeader, SectionHeader, Stat, buttonClasses } from "@/components/ui";

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

  const ackRes = await supabase
    .from("pledges")
    .select("amount_eur, pledge_acknowledgements(id)")
    .eq("company_id", active.company.id)
    .not("amount_eur", "is", null);
  const ackValueRows = ackRes.error ? [] : (ackRes.data ?? []);

  let givenEur = 0;
  for (const row of ackValueRows) {
    const acks = row.pledge_acknowledgements as unknown;
    if (row.amount_eur != null && Array.isArray(acks) && acks.length > 0) {
      givenEur += Number(row.amount_eur);
    }
  }
  givenEur = Math.round(givenEur * 100) / 100;

  const headroom = headroomEur(active.company.prior_year_revenue_eur);
  const consumed = consumedPct(givenEur, active.company.prior_year_revenue_eur);
  const remaining = remainingHeadroomEur(givenEur, active.company.prior_year_revenue_eur);

  const recentActions = actionsRes.data ?? [];

  const t = await getTranslator();

  return (
    <div>
      <PageHeader
        title={t("company.dashboard_title")}
        subtitle={t("company.dashboard_subtitle")}
        actions={
          /* Was `/dashboard/company/new-action`, which now renders only a
             retirement notice. The label is already "New campaign", so this
             points at the live campaigns surface instead of a dead route. */
          <Link
            href={`/dashboard/company/campaigns?cid=${active.company.id}`}
            className={buttonClasses()}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t("company.campaigns_new")}
          </Link>
        }
      />

      <div className="space-y-8">
        {/* One `Stat` for all four figures: the four previous stat cards each had
            their own radius, border, shadow and label typography. */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            icon={<Building2 className="h-4 w-4" aria-hidden="true" />}
            label={t("company.metric_members")}
            value={totalMembers}
          />
          <Stat
            icon={<TrendingUp className="h-4 w-4" aria-hidden="true" />}
            label={t("company.metric_pledges_ytd")}
            value={pledgeCount}
          />
          <Stat
            icon={<Megaphone className="h-4 w-4" aria-hidden="true" />}
            label={t("company.metric_campaigns")}
            value={activeCampaigns}
          />
          <Stat
            icon={<FileDown className="h-4 w-4" aria-hidden="true" />}
            label={t("company.metric_headroom")}
            value={formatEur(remaining)}
            tone={headroom > 0 ? "success" : "muted"}
            hint={`${t("tax.ceiling_hint", { pct: ceilingPct().toFixed(1) })} · ${consumed.toFixed(1)}% · ${formatEur(givenEur)}`}
          />
        </section>

        <CompanyReceiptsSection
          companyId={active.company.id}
          memberRole={active.role}
          subscriptionTier={active.company.subscription_tier}
        />

        <CompanyExportsSection
          companyId={active.company.id}
          memberRole={active.role}
          subscriptionTier={active.company.subscription_tier}
        />

        <CompanyCsrReportsSection
          companyId={active.company.id}
          memberRole={active.role}
          subscriptionTier={active.company.subscription_tier}
        />

        <section className={`grid gap-4 ${recentActions.length > 0 ? "lg:grid-cols-2" : ""}`}>
          <Card padding="lg">
            <SectionHeader
              title={t("company.campaigns_title")}
              actions={
                <Link
                  href={`/dashboard/company/campaigns?cid=${active.company.id}`}
                  className={buttonClasses({ variant: "ghost", size: "sm" })}
                >
                  {t("company.campaigns_title")} →
                </Link>
              }
            />
            {campaignsRes.data && campaignsRes.data.length > 0 ? (
              <ul className="space-y-2">
                {campaignsRes.data.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-3 rounded-control border border-border-subtle bg-surface-sunken px-4 py-3"
                  >
                    <span className="min-w-0 truncate text-sm font-medium text-ink">
                      {c.name}
                    </span>
                    <Link
                      href={`/dashboard/company/campaigns?cid=${active.company.id}&campaign=${c.id}`}
                      className={buttonClasses({ variant: "ghost", size: "sm" })}
                    >
                      {t("common.edit")}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-secondary">{t("company.campaigns_empty")}</p>
            )}
          </Card>

          {/* Legacy self-reported `company_actions`. The flow that created them
              is retired (`/dashboard/company/new-action` is a notice page), so
              this card is now read-only history and renders only when such rows
              exist — the old empty state told users to press a button that no
              longer works. */}
          {recentActions.length > 0 ? (
            <Card padding="lg">
              <SectionHeader title={t("company.actions_recent_title")} />
              <ul className="space-y-2">
                {recentActions.map((action) => (
                  <li
                    key={action.id}
                    className="flex items-center justify-between gap-3 rounded-control border border-border-subtle bg-surface-sunken px-4 py-3"
                  >
                    <span className="min-w-0 truncate text-sm text-ink">{action.ngo_name}</span>
                    <Link
                      href={`/company/confirmations/${action.confirmation_slug}`}
                      className={buttonClasses({ variant: "ghost", size: "sm" })}
                    >
                      {t("company.actions_open_confirmation")}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </section>
      </div>
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
