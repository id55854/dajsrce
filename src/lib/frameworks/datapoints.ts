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
      const { data, error } = await admin.rpc("get_volunteer_hours_json", {
        p_company_id: companyId,
        p_from: from,
        p_to: to,
      });
      if (error) throw new Error(error.message);
      const rows = (Array.isArray(data) ? data : []) as Array<{ id: string; hours: number | string }>;
      const sum = rows.reduce((s, r) => s + Number(r.hours ?? 0), 0);
      return {
        value: Math.round(sum * 100) / 100,
        evidence: rows.length
          ? [{ kind: "volunteer_hours" as const, ids: rows.map((r) => r.id) }]
          : [],
      };
    }
    case "volunteer_sessions_count": {
      const { data, error } = await admin.rpc("get_volunteer_hours_json", {
        p_company_id: companyId,
        p_from: from,
        p_to: to,
      });
      if (error) throw new Error(error.message);
      const rows = (Array.isArray(data) ? data : []) as Array<{ id: string }>;
      return {
        value: rows.length,
        evidence: rows.length ? [{ kind: "volunteer_hours" as const, ids: rows.map((r) => r.id) }] : [],
      };
    }
    case "pledges_acknowledged_eur": {
      const { data, error } = await admin.rpc("get_acknowledged_pledges_json", {
        p_company_id: companyId,
        p_from: from,
        p_to: to,
      });
      if (error) throw new Error(error.message);
      let total = 0;
      const ids: string[] = [];
      const rows = (Array.isArray(data) ? data : []) as Array<{
        id: string;
        amount_eur: number | string;
      }>;
      for (const row of rows) {
        total += Number(row.amount_eur ?? 0);
        ids.push(row.id);
      }
      return {
        value: Math.round(total * 100) / 100,
        evidence: ids.length ? [{ kind: "pledge" as const, ids }] : [],
      };
    }
    case "pledges_acknowledged_count": {
      const { data, error } = await admin.rpc("get_acknowledged_pledges_json", {
        p_company_id: companyId,
        p_from: from,
        p_to: to,
      });
      if (error) throw new Error(error.message);
      const rows = (Array.isArray(data) ? data : []) as Array<{ id: string }>;
      const ids = rows.map((row) => row.id);
      return {
        value: rows.length,
        evidence: ids.length ? [{ kind: "pledge" as const, ids }] : [],
      };
    }
    case "company_member_count": {
      const { count, error } = await admin
        .from("company_members")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId);
      if (error) throw new Error(error.message);
      return {
        value: count ?? 0,
        evidence: [],
      };
    }
    case "campaigns_active_count": {
      const { count, error } = await admin
        .from("campaigns")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("is_active", true);
      if (error) throw new Error(error.message);
      return {
        value: count ?? 0,
        evidence: [],
      };
    }
    default:
      return { value: null, evidence: [] };
  }
}
