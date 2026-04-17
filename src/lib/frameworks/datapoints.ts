import type { SupabaseClient } from "@supabase/supabase-js";
import type { ComputeKey, CompilePeriod, EvidenceRef } from "./types";

function periodBounds(p: CompilePeriod): { from: string; to: string } {
  return {
    from: `${p.periodStart}T00:00:00.000Z`,
    to: `${p.periodEnd}T23:59:59.999Z`,
  };
}

export type ComputeResult = {
  value: number | string | null;
  evidence: EvidenceRef[];
};

export async function runCompute(
  admin: SupabaseClient,
  companyId: string,
  period: CompilePeriod,
  key: ComputeKey
): Promise<ComputeResult> {
  const { from, to } = periodBounds(period);

  switch (key) {
    case "volunteer_hours_sum": {
      const { data, error } = await admin
        .from("volunteer_hours")
        .select("id, hours")
        .eq("company_id", companyId)
        .gte("recorded_at", from)
        .lte("recorded_at", to);
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      const sum = rows.reduce((s, r) => s + Number(r.hours ?? 0), 0);
      return {
        value: Math.round(sum * 100) / 100,
        evidence: rows.length
          ? [{ kind: "volunteer_hours" as const, ids: rows.map((r) => r.id) }]
          : [],
      };
    }
    case "volunteer_sessions_count": {
      const { data, error } = await admin
        .from("volunteer_hours")
        .select("id")
        .eq("company_id", companyId)
        .gte("recorded_at", from)
        .lte("recorded_at", to);
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      return {
        value: rows.length,
        evidence: rows.length ? [{ kind: "volunteer_hours" as const, ids: rows.map((r) => r.id) }] : [],
      };
    }
    case "pledges_acknowledged_eur": {
      const { data, error } = await admin
        .from("pledges")
        .select("id, amount_eur, pledge_acknowledgements(signed_at)")
        .eq("company_id", companyId)
        .not("amount_eur", "is", null);
      if (error) throw new Error(error.message);
      let total = 0;
      const ids: string[] = [];
      for (const row of data ?? []) {
        const acks = row.pledge_acknowledgements as unknown;
        if (!Array.isArray(acks) || acks.length === 0) continue;
        const signedAt = (acks[0] as { signed_at?: string })?.signed_at;
        if (!signedAt) continue;
        const t = new Date(signedAt).getTime();
        if (t < new Date(from).getTime() || t > new Date(to).getTime()) continue;
        total += Number(row.amount_eur ?? 0);
        ids.push(row.id);
      }
      return {
        value: Math.round(total * 100) / 100,
        evidence: ids.length ? [{ kind: "pledge" as const, ids }] : [],
      };
    }
    case "pledges_acknowledged_count": {
      const { data, error } = await admin
        .from("pledges")
        .select("id, pledge_acknowledgements(signed_at)")
        .eq("company_id", companyId);
      if (error) throw new Error(error.message);
      let n = 0;
      const ids: string[] = [];
      for (const row of data ?? []) {
        const acks = row.pledge_acknowledgements as unknown;
        if (!Array.isArray(acks) || acks.length === 0) continue;
        const signedAt = (acks[0] as { signed_at?: string })?.signed_at;
        if (!signedAt) continue;
        const t = new Date(signedAt).getTime();
        if (t < new Date(from).getTime() || t > new Date(to).getTime()) continue;
        n += 1;
        ids.push(row.id);
      }
      return {
        value: n,
        evidence: ids.length ? [{ kind: "pledge" as const, ids }] : [],
      };
    }
    case "company_member_count": {
      const { data, error } = await admin
        .from("company_members")
        .select("id")
        .eq("company_id", companyId);
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      return {
        value: rows.length,
        evidence: rows.length ? [{ kind: "member" as const, ids: rows.map((r) => r.id) }] : [],
      };
    }
    case "campaigns_active_count": {
      const { data, error } = await admin
        .from("campaigns")
        .select("id")
        .eq("company_id", companyId)
        .eq("is_active", true);
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      return {
        value: rows.length,
        evidence: rows.length ? [{ kind: "campaign" as const, ids: rows.map((r) => r.id) }] : [],
      };
    }
    default:
      return { value: null, evidence: [] };
  }
}
