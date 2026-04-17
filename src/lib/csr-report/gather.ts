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

function inPeriod(isoDate: string | null, start: string, end: string): boolean {
  if (!isoDate) return false;
  const d = isoDate.slice(0, 10);
  return d >= start && d <= end;
}

function pledgeEffectiveDate(deliveredAt: string | null, createdAt: string): string {
  return (deliveredAt ?? createdAt).slice(0, 10);
}

export async function gatherCsrReportManifest(
  admin: SupabaseClient,
  companyId: string,
  periodStart: string,
  periodEnd: string,
  company: CsrReportManifest["company"]
): Promise<CsrReportManifest> {
  const { data: pledgeRows, error: pledgesErr } = await admin
    .from("pledges")
    .select(
      "amount_eur, status, created_at, delivered_at, need:needs(institution:institutions(name))"
    )
    .eq("company_id", companyId)
    .in("status", ["delivered", "confirmed"]);

  if (pledgesErr) {
    throw new Error(pledgesErr.message);
  }

  const rows = pledgeRows ?? [];
  const scoped = rows.filter((r) => {
    if (r.amount_eur == null) return false;
    const d = pledgeEffectiveDate(r.delivered_at as string | null, r.created_at as string);
    return inPeriod(d, periodStart, periodEnd);
  });

  let givenEur = 0;
  const byInstitution = new Map<string, number>();
  const byMonth = new Map<string, number>();

  for (const r of scoped) {
    const amt = Number(r.amount_eur);
    givenEur += amt;
    const need = r.need as { institution?: { name: string } | null } | null;
    const instName = need?.institution?.name ?? "—";
    byInstitution.set(instName, (byInstitution.get(instName) ?? 0) + amt);

    const d = pledgeEffectiveDate(r.delivered_at as string | null, r.created_at as string);
    const monthKey = d.slice(0, 7);
    byMonth.set(monthKey, (byMonth.get(monthKey) ?? 0) + amt);
  }

  const { data: hoursRows, error: hoursErr } = await admin
    .from("volunteer_hours")
    .select("hours, recorded_at")
    .eq("company_id", companyId)
    .gte("recorded_at", `${periodStart}T00:00:00.000Z`)
    .lte("recorded_at", `${periodEnd}T23:59:59.999Z`);

  if (hoursErr) {
    throw new Error(hoursErr.message);
  }

  let volunteerHours = 0;
  for (const h of hoursRows ?? []) {
    volunteerHours += Number(h.hours);
  }

  const { data: campRows } = await admin
    .from("campaigns")
    .select("name, sdg_tags")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(20);

  const top_institutions = [...byInstitution.entries()]
    .map(([name, eur]) => ({ name, eur }))
    .sort((a, b) => b.eur - a.eur)
    .slice(0, 8);

  const monthly_eur = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, eur]) => ({ month, eur: Math.round(eur * 100) / 100 }));

  givenEur = Math.round(givenEur * 100) / 100;
  volunteerHours = Math.round(volunteerHours * 100) / 100;

  return {
    period_start: periodStart,
    period_end: periodEnd,
    company,
    totals: {
      given_eur: givenEur,
      volunteer_hours: volunteerHours,
      institutions_supported: byInstitution.size,
      pledges_in_scope: scoped.length,
    },
    monthly_eur,
    top_institutions,
    campaigns: (campRows ?? []).map((c) => ({
      name: c.name as string,
      sdg_tags: (c.sdg_tags as number[]) ?? [],
    })),
  };
}
