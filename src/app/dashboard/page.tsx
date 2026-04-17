import { redirect } from "next/navigation";
import { getCurrentUserProfile } from "@/lib/auth/server";
import { roleToDashboardPath } from "@/lib/auth/roles";

export default async function DashboardEntryPage() {
  const profile = await getCurrentUserProfile();

  if (!profile) {
    redirect(`/auth/login?next=${encodeURIComponent("/dashboard")}`);
  }

  redirect(roleToDashboardPath(profile.role));
}
