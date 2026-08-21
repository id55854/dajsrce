import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { LayoutDashboard, MapPin, PackageSearch, Users } from "lucide-react";
import { getCurrentUserProfile } from "@/lib/auth/server";
import { roleToDashboardPath } from "@/lib/auth/roles";
import type { AppRole } from "@/lib/auth/roles";
import { getTranslator } from "@/i18n/server";
import { Card, PageHeader, PageShell } from "@/components/ui";

// Role names live in the dictionaries; the helper in lib/auth/roles is
// English-only and used for logs and dashboard routing.
const ROLE_LABEL_KEY: Record<AppRole, string> = {
  individual: "dashboard_individual.role_individual",
  ngo: "dashboard_individual.role_ngo",
  company: "dashboard_individual.role_company",
  superadmin: "dashboard_individual.role_superadmin",
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return {
    title: `${t("hub.title")} | DajSrce`,
    description: t("hub.subtitle"),
  };
}

export default async function Hub() {
  const t = await getTranslator();
  const profile = await getCurrentUserProfile();
  const dashboardHref = profile
    ? roleToDashboardPath(profile.role)
    : "/auth/login?next=/dashboard";

  return (
    <PageShell>
      <PageHeader title={t("hub.title")} subtitle={t("hub.subtitle")} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <HomeCard
          href="/"
          title={t("nav.map")}
          desc={t("hub.map_desc")}
          icon={<MapPin className="h-5 w-5" aria-hidden />}
        />
        <HomeCard
          href="/doniraj"
          title={t("nav.donate")}
          desc={t("hub.needs_desc")}
          icon={<PackageSearch className="h-5 w-5" aria-hidden />}
        />
        <HomeCard
          href="/volunteer"
          title={t("nav.volunteer")}
          desc={t("hub.volunteer_desc")}
          icon={<Users className="h-5 w-5" aria-hidden />}
        />
        <HomeCard
          href={dashboardHref}
          title={
            profile
              ? t("hub.dashboard_title_role", {
                  role: t(ROLE_LABEL_KEY[profile.role]),
                })
              : t("hub.dashboard_title")
          }
          desc={
            profile ? t("hub.dashboard_desc") : t("hub.dashboard_desc_signed_out")
          }
          icon={<LayoutDashboard className="h-5 w-5" aria-hidden />}
        />
      </div>
    </PageShell>
  );
}

function HomeCard({
  href,
  title,
  desc,
  icon,
}: {
  href: string;
  title: string;
  desc: string;
  icon: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="block rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
    >
      <Card interactive className="h-full">
        <div className="mb-3 text-brand">{icon}</div>
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        <p className="mt-1 text-sm text-ink-secondary">{desc}</p>
      </Card>
    </Link>
  );
}
