import { redirect } from "next/navigation";
import { getCurrentUserProfile } from "@/lib/auth/server";
import { resolveActiveCompany } from "@/lib/companies-server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { TeamManager } from "./team-manager";
import type { CompanyDomain, CompanyInvite, CompanyMember } from "@/lib/types";

type SearchParams = { [key: string]: string | string[] | undefined };

export default async function CompanyTeamPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const profile = await getCurrentUserProfile();
  if (!profile) redirect("/auth/login?next=/dashboard/company/team");

  const params = (await searchParams) ?? {};
  const cidRaw = params.cid;
  const cid = Array.isArray(cidRaw) ? cidRaw[0] : cidRaw;
  const { active } = await resolveActiveCompany(cid);
  if (!active) redirect("/dashboard/company/new");

  const supabase = await createServerSupabaseClient();
  const [membersRes, invitesRes, domainsRes] = await Promise.all([
    supabase
      .from("company_members")
      .select(
        "id, role, department, joined_at, profile_id, profile:profiles(id, email, name)"
      )
      .eq("company_id", active.company.id)
      .order("joined_at", { ascending: true }),
    supabase
      .from("company_invites")
      .select("id, email, role, token, expires_at, accepted_at, created_at, invited_by, company_id")
      .eq("company_id", active.company.id)
      .is("accepted_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("company_domains")
      .select("*")
      .eq("company_id", active.company.id)
      .order("created_at", { ascending: false }),
  ]);

  return (
    <TeamManager
      companyId={active.company.id}
      myRole={active.role}
      members={(membersRes.data ?? []) as unknown as CompanyMember[]}
      invites={(invitesRes.data ?? []) as unknown as CompanyInvite[]}
      domains={(domainsRes.data ?? []) as CompanyDomain[]}
    />
  );
}
