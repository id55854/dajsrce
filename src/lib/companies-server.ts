import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Company, CompanyRole } from "@/lib/types";

export const ACTIVE_COMPANY_COOKIE = "active_company";

export type Membership = {
  company: Company;
  role: CompanyRole;
};

// Load every company the current user belongs to, with their role.
export async function listMyCompanies(): Promise<Membership[]> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("company_members")
    .select("role, company:companies(*)")
    .eq("profile_id", user.id)
    .order("joined_at", { ascending: true });

  if (!data) return [];
  return data
    .map((row) => {
      const company = row.company as unknown as Company | null;
      if (!company) return null;
      return { company, role: row.role as CompanyRole };
    })
    .filter((m): m is Membership => m !== null);
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
