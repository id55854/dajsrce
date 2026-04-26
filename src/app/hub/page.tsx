import Link from "next/link";
import type { ReactNode } from "react";
import { LayoutDashboard, MapPin, PackageSearch, Users } from "lucide-react";
import { getCurrentUserProfile } from "@/lib/auth/server";
import { roleToDashboardPath, roleLabel } from "@/lib/auth/roles";

export default async function Hub() {
  const profile = await getCurrentUserProfile();
  const dashboardHref = profile
    ? roleToDashboardPath(profile.role)
    : "/auth/login?next=/dashboard";

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">DajSrce</h1>
      <p className="mt-2 text-gray-600 dark:text-gray-400">
        Browse public opportunities and log in only when you want to act.
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <HomeCard
          href="/map"
          title="Map"
          desc="Explore nearby NGOs and associations."
          icon={<MapPin className="h-5 w-5" />}
        />
        <HomeCard
          href="/needs"
          title="Needs"
          desc="See active needs for food, clothes, hygiene and more."
          icon={<PackageSearch className="h-5 w-5" />}
        />
        <HomeCard
          href="/volunteer"
          title="Volunteer"
          desc="Discover volunteer opportunities."
          icon={<Users className="h-5 w-5" />}
        />
        <HomeCard
          href={dashboardHref}
          title={profile ? `${roleLabel(profile.role)} Dashboard` : "Your Dashboard"}
          desc={
            profile
              ? "Open your role-specific dashboard."
              : "Sign in when you want to take action."
          }
          icon={<LayoutDashboard className="h-5 w-5" />}
        />
      </div>
    </div>
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
      className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-gray-800 dark:bg-gray-900"
    >
      <div className="mb-3 text-red-500">{icon}</div>
      <h2 className="font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{desc}</p>
    </Link>
  );
}
