import type { SupabaseClient } from "@supabase/supabase-js";
import type { Framework } from "@/lib/types";
import { FRAMEWORK_MANIFESTS } from "./manifests";
import { runCompute } from "./datapoints";
import type { CompilePeriod, DatapointResult } from "./types";

export async function compileFramework(
  admin: SupabaseClient,
  companyId: string,
  framework: Framework,
  period: CompilePeriod
): Promise<DatapointResult[]> {
  const manifest = FRAMEWORK_MANIFESTS[framework];
  if (!manifest?.length) {
    throw new Error(`Unknown framework: ${framework}`);
  }

  const out: DatapointResult[] = [];

  for (const dp of manifest) {
    try {
      const { value, evidence } = await runCompute(admin, companyId, period, dp.compute);
      const noData =
        dp.required &&
        evidence.length === 0 &&
        (value === null || value === undefined || value === "" || Number(value) === 0);
      out.push({
        id: dp.id,
        label_en: dp.label_en,
        label_hr: dp.label_hr,
        unit: dp.unit,
        value,
        evidence,
        skipReason: noData ? "No data in period for this metric." : undefined,
      });
    } catch {
      out.push({
        id: dp.id,
        label_en: dp.label_en,
        label_hr: dp.label_hr,
        unit: dp.unit,
        value: null,
        evidence: [],
        skipReason: "Query failed — ensure Phase 2 migrations are applied.",
      });
    }
  }

  return out;
}
