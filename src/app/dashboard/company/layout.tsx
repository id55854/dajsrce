import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { Building2, LayoutDashboard, Megaphone, Settings, Users } from "lucide-react";
import { getCurrentUserProfile } from "@/lib/auth/server";
import { resolveActiveCompany } from "@/lib/companies-server";
import { CompanySwitcher } from "@/components/CompanySwitcher";
import { toSwitcherItems } from "@/lib/company-switcher-items";
import { getTranslator } from "@/i18n/server";
import { TenantNavLink } from "./tenant-nav";

// NOTE: App Router layouts do not receive `searchParams`. The active
// company is resolved from the `active_company` cookie (set by the
// switcher and onboarding flow). Child pages read ?cid= for their own
// queries — the header label may trail by one click during navigation
// and only updates on next server render, which is acceptable.
export default async function CompanyLayout({ children }: { children: ReactNode }) {
  const profile = await getCurrentUserProfile();
  if (!profile) redirect("/auth/login?next=/dashboard/company");

  const { active, all: memberships } = await resolveActiveCompany(null);

  const t = await getTranslator();

  return (
    <div>
      {/* Translucent tenant chrome: content scrolls under it, matching the
          global navbar's material. */}
      <div
        data-ui-material
        className="border-b border-border-subtle bg-chrome backdrop-blur-xl"
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand-soft text-brand">
              <Building2 className="h-4 w-4" aria-hidden="true" />
            </span>
            {/* Tenant identity is chrome, not the page title. It used to be an
                <h1>, which left every page below it without one and gave the
                dashboard two competing headers. */}
            <div>
              <p className="text-xs uppercase tracking-wide text-ink-tertiary">DajSrce</p>
              <p className="text-base font-semibold text-ink">
                {active?.company.display_name || active?.company.legal_name || "Company"}
              </p>
            </div>
          </div>
          {memberships.length > 0 ? (
            <CompanySwitcher
              items={toSwitcherItems(memberships)}
              activeId={active?.company.id ?? null}
            />
          ) : null}
        </div>
        {active ? (
          <nav
            className="mx-auto flex max-w-6xl flex-wrap items-center gap-1 px-4 pb-3 text-sm sm:px-6"
            aria-label="Company dashboard"
          >
            <TenantNavLink
              href={`/dashboard/company?cid=${active.company.id}`}
              matchPath="/dashboard/company"
              exact
              icon={<LayoutDashboard className="h-4 w-4" aria-hidden="true" />}
            >
              {t("company.dashboard_title")}
            </TenantNavLink>
            <TenantNavLink
              href={`/dashboard/company/team?cid=${active.company.id}`}
              matchPath="/dashboard/company/team"
              icon={<Users className="h-4 w-4" aria-hidden="true" />}
            >
              {t("company.team_title")}
            </TenantNavLink>
            <TenantNavLink
              href={`/dashboard/company/campaigns?cid=${active.company.id}`}
              matchPath="/dashboard/company/campaigns"
              icon={<Megaphone className="h-4 w-4" aria-hidden="true" />}
            >
              {t("company.campaigns_title")}
            </TenantNavLink>
            <TenantNavLink
              href={`/dashboard/company/settings?cid=${active.company.id}`}
              matchPath="/dashboard/company/settings"
              icon={<Settings className="h-4 w-4" aria-hidden="true" />}
            >
              {t("company.settings_title")}
            </TenantNavLink>
          </nav>
        ) : null}
      </div>
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">{children}</div>
    </div>
  );
}
