import type { SupabaseClient } from "@supabase/supabase-js";

type AuditEntry = {
  actor_profile_id: string | null;
  company_id: string | null;
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  payload?: Record<string, unknown> | null;
};

/**
 * Append a serialized, complete-envelope audit event through the database.
 * The RPC takes an advisory transaction lock per company and hashes the actor,
 * action, entity, payload, timestamp, and previous hash. Audit failure is not
 * silently ignored: callers must surface or compensate for a failed evidence
 * write instead of claiming that an unaudited action succeeded.
 */
export async function writeAuditLog(admin: SupabaseClient, entry: AuditEntry): Promise<void> {
  const { error } = await admin.rpc("append_audit_log_event", {
    p_actor_profile_id: entry.actor_profile_id,
    p_company_id: entry.company_id,
    p_action: entry.action,
    p_entity_type: entry.entity_type ?? null,
    p_entity_id: entry.entity_id ?? null,
    p_payload: entry.payload ?? {},
  });

  if (error) {
    console.error("[audit_log] append failed", {
      action: entry.action,
      code: error.code,
      message: error.message,
    });
    throw new Error("Audit evidence could not be recorded");
  }
}
