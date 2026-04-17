import { redirect } from "next/navigation";
import { getCurrentUserProfile } from "@/lib/auth/server";
import { IndividualDashboardClient } from "./individual-dashboard-client";

export default async function IndividualDashboardPage() {
  const profile = await getCurrentUserProfile();
  if (!profile) {
    redirect(`/auth/login?next=${encodeURIComponent("/dashboard/individual")}`);
  }
  return <IndividualDashboardClient profile={profile} />;
}
