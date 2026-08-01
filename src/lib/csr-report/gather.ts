import type { SupabaseClient } from "@supabase/supabase-js";

export type CsrReportManifest = {
  period_start: string;
  period_end: string;
  company: {
    legal_name: string;
    display_name: string | null;
    tagline: string | null;
    brand_primary_hex: string | null;
  };
  totals: {
    given_eur: number;
    volunteer_hours: number;
    institutions_supported: number;
    pledges_in_scope: number;
  };
  monthly_eur: { month: string; eur: number }[];
  top_institutions: { name: string; eur: number }[];
  campaigns: { name: string; sdg_tags: number[] }[];
};

type AcknowledgedPledge = {
  id: string;
  amount_eur: number | string;
  ack_signed_at: string;
  institution_name: string;
};

type VolunteerHour = { id: string; hours: number | string };

export async function gatherCsrReportManifest(
  admin: SupabaseClient,
  companyId: string,
  periodStart: string,
  periodEnd: string,
  company: CsrReportManifest["company"]
): Promise<CsrReportManifest> {
  const from = `${periodStart}T00:00:00.000Z`;
  const to = `${periodEnd}T23:59:59.999Z`;
  const [pledgesResult, hoursResult, campaignsResult] = await Promise.all([
    admin.rpc("get_acknowledged_pledges_json", {
      p_company_id: companyId,
      p_from: from,
      p_to: to,
    }),
    admin.rpc("get_volunteer_hours_json", {
      p_company_id: companyId,
      p_from: from,
      p_to: to,
    }),
    admin
      .from("campaigns")
      .select("name, sdg_tags")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (pledgesResult.error) throw new Error(pledgesResult.error.message);
  if (hoursResult.error) throw new Error(hoursResult.error.message);
  if (campaignsResult.error) throw new Error(campaignsResult.error.message);

  const pledges = (Array.isArray(pledgesResult.data) ? pledgesResult.data : []) as AcknowledgedPledge[];
  const hours = (Array.isArray(hoursResult.data) ? hoursResult.data : []) as VolunteerHour[];
  const byInstitution = new Map<string, number>();
  const byMonth = new Map<string, number>();
  let givenCents = 0;

  for (const pledge of pledges) {
    const amountCents = Math.round(Number(pledge.amount_eur) * 100);
    if (!Number.isFinite(amountCents) || amountCents < 0) {
      throw new Error(`Invalid amount for pledge ${pledge.id}`);
    }
    givenCents += amountCents;
    const institution = pledge.institution_name || "—";
    byInstitution.set(institution, (byInstitution.get(institution) ?? 0) + amountCents);
    const month = pledge.ack_signed_at.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + amountCents);
  }

  const volunteerHours = Math.round(
    hours.reduce((sum, row) => sum + Number(row.hours ?? 0), 0) * 100
  ) / 100;

  const top_institutions = [...byInstitution.entries()]
    .map(([name, cents]) => ({ name, eur: cents / 100 }))
    .sort((a, b) => b.eur - a.eur)
    .slice(0, 8);
  const monthly_eur = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, cents]) => ({ month, eur: cents / 100 }));

  return {
    period_start: periodStart,
    period_end: periodEnd,
    company,
    totals: {
      given_eur: givenCents / 100,
      volunteer_hours: volunteerHours,
      institutions_supported: byInstitution.size,
      pledges_in_scope: pledges.length,
    },
    monthly_eur,
    top_institutions,
    campaigns: (campaignsResult.data ?? []).map((campaign) => ({
      name: campaign.name as string,
      sdg_tags: (campaign.sdg_tags as number[]) ?? [],
    })),
  };
}
