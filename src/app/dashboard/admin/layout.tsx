import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getVerifiedClaims } from "@/lib/auth/claims";
import { MFA_SETTINGS_HREF, mfaChallengePath } from "@/lib/auth/mfa";
import { sessionListsVerifiedFactor } from "@/lib/auth/mfa-server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Two-step sign-in is mandatory for administrators. The middleware already
 * turns an administrator session below `aal2` away from these pages; this is
 * the same rule again next to the data, so a change to the middleware matcher
 * cannot quietly open the review queue to a password alone. The claim is
 * signed; the cookie's factor list only picks where to send the session.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const supabase = await createServerSupabaseClient();
  const claims = await getVerifiedClaims(supabase);
  if (!claims) redirect("/auth/login?next=/dashboard/admin");
  if (claims.aal !== "aal2") {
    redirect(
      (await sessionListsVerifiedFactor(supabase))
        ? mfaChallengePath("/dashboard/admin")
        : MFA_SETTINGS_HREF
    );
  }
  return children;
}
