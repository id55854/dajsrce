import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getVerifiedClaims } from "@/lib/auth/claims";
import { normalizeRole } from "@/lib/auth/roles";
import type { AuthProfile } from "@/lib/auth/profile";

export type { AuthProfile };

/**
 * Who is signed in, for display and navigation. Identity comes from a locally
 * verified JWT (see `getVerifiedClaims`), the role from the profiles row. This
 * is a read path: nothing that mutates state may rely on it for authorization.
 */
export async function getCurrentUserProfile(): Promise<AuthProfile | null> {
  const supabase = await createServerSupabaseClient();
  const user = await getVerifiedClaims(supabase);

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, name, role, institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    return {
      id: user.id,
      email: user.email ?? "",
      name:
        (user.userMetadata.name as string | undefined) ??
        user.email?.split("@")[0] ??
        "User",
      // Auth metadata is user-controlled; a missing database profile is always
      // treated as least privileged.
      role: "individual",
      institution_id: null,
    };
  }

  return {
    id: profile.id,
    email: profile.email,
    name: profile.name,
    role: normalizeRole(profile.role),
    institution_id: profile.institution_id,
  };
}
