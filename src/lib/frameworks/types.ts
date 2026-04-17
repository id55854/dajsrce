import type { Framework } from "@/lib/types";

/** Built-in metric calculators (no arbitrary SQL from JSON). */
export type ComputeKey =
  | "volunteer_hours_sum"
  | "volunteer_sessions_count"
  | "pledges_acknowledged_eur"
  | "pledges_acknowledged_count"
  | "company_member_count"
  | "campaigns_active_count";

export type ManifestDatapoint = {
  id: string;
  framework: Framework;
  label_en: string;
  label_hr: string;
  unit: string;
  compute: ComputeKey;
  required: boolean;
};

export type EvidenceRef = {
  kind: "volunteer_hours" | "pledge" | "campaign" | "member";
  ids: string[];
};

export type DatapointResult = {
  id: string;
  label_en: string;
  label_hr: string;
  unit: string;
  value: number | string | null;
  evidence: EvidenceRef[];
  skipReason?: string;
};

export type CompilePeriod = {
  periodStart: string;
  periodEnd: string;
};
