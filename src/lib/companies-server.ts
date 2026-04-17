import { cookies } from "next/headers";
import type { PostgrestError } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Company, CompanyRole } from "@/lib/types";

export const ACTIVE_COMPANY_COOKIE = "active_company";

export type Membership = {
  company: Company;
  role: CompanyRole;
};

type ServerSupabase = Awaited<ReturnType<typeof createServerSupabaseClient>>;

/** Two-step load avoids PostgREST embed failures (missing FK in schema cache). */
export async function loadCompanyMembershipsForUser(
  supabase: ServerSupabase,
  userId: string
): Promise<{ memberships: Membership[]; error: PostgrestError | null }> {
  const { data: rows, error: e1 } = await supabase
    .from("company_members")
    .select("role, company_id, joined_at")
    .eq("profile_id", userId)
    .order("joined_at", { ascending: true });

  if (e1) return { memberships: [], error: e1 };
  if (!rows?.length) return { memberships: [], error: null };

  const ids = Array.from(new Set(rows.map((r) => r.company_id)));

  const { data: companies, error: e2 } = await supabase.from("companies").select("*").in("id", ids);

  if (e2) return { memberships: [], error: e2 };

  const byId = new Map((companies ?? []).map((c) => [c.id, c as Company]));
  const memberships: Membership[] = [];
  for (const row of rows) {
    const company = byId.get(row.company_id);
    if (!company) continue;
    memberships.push({ company, role: row.role as CompanyRole });
  }
  return { memberships, error: null };
}

// Load every company the current user belongs to, with their role.
export async function listMyCompanies(): Promise<Membership[]> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { memberships, error } = await loadCompanyMembershipsForUser(supabase, user.id);
  if (error) {
    console.error("[listMyCompanies]", error.message, error.code, error.details);
    return [];
  }
  return memberships;
}

// Resolve the active company for the current request: prefer ?cid, then
// the cookie, then the first membership.
export async function resolveActiveCompany(
  requestedId?: string | null
): Promise<{ active: Membership | null; all: Membership[] }> {
  const all = await listMyCompanies();
  if (all.length === 0) return { active: null, all };

  let active: Membership | undefined;
  if (requestedId) {
    active = all.find((m) => m.company.id === requestedId);
  }

  if (!active) {
    const jar = await cookies();
    const stored = jar.get(ACTIVE_COMPANY_COOKIE)?.value;
    if (stored) active = all.find((m) => m.company.id === stored);
  }

  if (!active) active = all[0];
  return { active: active ?? null, all };
}
