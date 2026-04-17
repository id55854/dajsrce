import { createServerSupabaseClient } from "@/lib/supabase/server";
import { normalizeRole, type AppRole } from "@/lib/auth/roles";

export type AuthProfile = {
  id: string;
  email: string;
  name: string;
  role: AppRole;
  institution_id: string | null;
};

export async function getCurrentUserProfile(): Promise<AuthProfile | null> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
        (user.user_metadata?.name as string | undefined) ??
        user.email?.split("@")[0] ??
        "User",
      role: normalizeRole((user.user_metadata?.role as string | undefined) ?? null),
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
