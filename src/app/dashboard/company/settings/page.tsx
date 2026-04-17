import { redirect } from "next/navigation";
import { getCurrentUserProfile } from "@/lib/auth/server";
import { resolveActiveCompany } from "@/lib/companies-server";
import { SettingsEditor } from "./settings-editor";

type SearchParams = { [key: string]: string | string[] | undefined };

export default async function CompanySettingsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const profile = await getCurrentUserProfile();
  if (!profile) redirect("/auth/login?next=/dashboard/company/settings");

  const params = (await searchParams) ?? {};
  const cidRaw = params.cid;
  const cid = Array.isArray(cidRaw) ? cidRaw[0] : cidRaw;
  const { active } = await resolveActiveCompany(cid);
  if (!active) redirect("/dashboard/company/new");

  const allowDemoBilling = process.env.ALLOW_DEMO_BILLING === "true";

  return (
    <SettingsEditor
      company={active.company}
      myRole={active.role}
      allowDemoBilling={allowDemoBilling}
    />
  );
}
