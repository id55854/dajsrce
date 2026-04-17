import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// Append-only audit log. Always called from server route handlers with
// supabaseAdmin (service role) because the audit_log table has RLS enabled
// with no user-facing policies.
//
// The hash chain is best-effort: we read the most recent prev_hash, compute
// sha256(prev_hash || canonical_payload || created_at), and insert. Under
// heavy concurrent writes the chain is not strict (two rows may both point
// at the same prev_hash); we accept this trade-off in exchange for avoiding
// advisory locks on the hot write path. Phase 1 tightens this when the
// receipt generator lands.

type AuditEntry = {
  actor_profile_id: string | null;
  company_id: string | null;
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  payload?: Record<string, unknown> | null;
};

export async function writeAuditLog(admin: SupabaseClient, entry: AuditEntry): Promise<void> {
  const createdAt = new Date().toISOString();

  const { data: last } = await admin
    .from("audit_log")
    .select("hash")
    .eq("company_id", entry.company_id)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  const prevHash = last?.hash ?? null;
  const hash = computeHash(prevHash, entry.payload ?? null, createdAt);

  const { error } = await admin.from("audit_log").insert({
    actor_profile_id: entry.actor_profile_id,
    company_id: entry.company_id,
    action: entry.action,
    entity_type: entry.entity_type ?? null,
    entity_id: entry.entity_id ?? null,
    payload: entry.payload ?? null,
    prev_hash: prevHash,
    hash,
    created_at: createdAt,
  });

  if (error) {
    // Never throw from audit logging. We prefer a missing audit row over a
    // user-visible 500 on an otherwise successful mutation.
    console.error("[audit_log] insert failed", { action: entry.action, error: error.message });
  }
}

function computeHash(
  prev: string | null,
  payload: Record<string, unknown> | null,
  createdAt: string
): string {
  const h = crypto.createHash("sha256");
  h.update(prev ?? "");
  h.update("|");
  h.update(payload ? canonicalize(payload) : "");
  h.update("|");
  h.update(createdAt);
  return h.digest("hex");
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(",")}}`;
}
