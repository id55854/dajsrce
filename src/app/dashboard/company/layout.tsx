import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Building2, LayoutDashboard, Megaphone, Settings, Users } from "lucide-react";
import { getCurrentUserProfile } from "@/lib/auth/server";
import { resolveActiveCompany } from "@/lib/companies-server";
import { CompanySwitcher } from "@/components/CompanySwitcher";
import { toSwitcherItems } from "@/lib/company-switcher-items";
import { getTranslator } from "@/i18n/server";

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
    <div className="min-h-screen bg-gradient-to-b from-red-50/40 to-white dark:from-gray-950 dark:to-gray-950">
      <div className="border-b border-gray-200 bg-white/90 backdrop-blur dark:border-gray-800 dark:bg-gray-950/90">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-red-50 text-red-500 dark:bg-red-950/40">
              <Building2 className="h-4 w-4" />
            </span>
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">DajSrce</p>
              <h1 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {active?.company.display_name || active?.company.legal_name || "Company"}
              </h1>
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
            <TenantNavLink href={`/dashboard/company?cid=${active.company.id}`} icon={<LayoutDashboard className="h-4 w-4" />}>
              {t("company.dashboard_title")}
            </TenantNavLink>
            <TenantNavLink href={`/dashboard/company/team?cid=${active.company.id}`} icon={<Users className="h-4 w-4" />}>
              {t("company.team_title")}
            </TenantNavLink>
            <TenantNavLink href={`/dashboard/company/campaigns?cid=${active.company.id}`} icon={<Megaphone className="h-4 w-4" />}>
              {t("company.campaigns_title")}
            </TenantNavLink>
            <TenantNavLink href={`/dashboard/company/settings?cid=${active.company.id}`} icon={<Settings className="h-4 w-4" />}>
              {t("company.settings_title")}
            </TenantNavLink>
          </nav>
        ) : null}
      </div>
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</div>
    </div>
  );
}

function TenantNavLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-gray-300 dark:hover:bg-red-950/30"
    >
      {icon}
      {children}
    </Link>
  );
}
