import { redirect } from "next/navigation";
import { getCurrentUserProfile } from "@/lib/auth/server";
import { resolveActiveCompany } from "@/lib/companies-server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { CampaignsManager } from "./campaigns-manager";
import type { Campaign } from "@/lib/types";

type SearchParams = { [key: string]: string | string[] | undefined };

export default async function CompanyCampaignsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const profile = await getCurrentUserProfile();
  if (!profile) redirect("/auth/login?next=/dashboard/company/campaigns");

  const params = (await searchParams) ?? {};
  const cidRaw = params.cid;
  const cid = Array.isArray(cidRaw) ? cidRaw[0] : cidRaw;
  const { active } = await resolveActiveCompany(cid);
  if (!active) redirect("/dashboard/company/new");

  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from("campaigns")
    .select("*")
    .eq("company_id", active.company.id)
    .order("created_at", { ascending: false });

  return (
    <CampaignsManager
      companyId={active.company.id}
      myRole={active.role}
      campaigns={(data ?? []) as Campaign[]}
    />
  );
}
