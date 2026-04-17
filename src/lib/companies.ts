import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompanyRole } from "@/lib/types";

export type MembershipCheck =
  | { ok: true; role: CompanyRole }
  | { ok: false; status: 401 | 403 | 404; error: string };

// Resolve the caller's role in the given company, or explain why access
// should be denied. Callers are expected to short-circuit on !ok.
export async function requireMembership(
  supabase: SupabaseClient,
  companyId: string,
  userId: string | null,
  allowed: readonly CompanyRole[] = ["owner", "admin", "finance", "employee"]
): Promise<MembershipCheck> {
  if (!userId) return { ok: false, status: 401, error: "Not authenticated" };

  const { data, error } = await supabase
    .from("company_members")
    .select("role")
    .eq("company_id", companyId)
    .eq("profile_id", userId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, status: 404, error: "Company not found" };
  }
  if (!allowed.includes(data.role as CompanyRole)) {
    return { ok: false, status: 403, error: "Insufficient company role" };
  }
  return { ok: true, role: data.role as CompanyRole };
}

export function slugify(source: string): string {
  return source
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "company";
}

export function generateToken(bytes = 24): string {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function addDays(days: number, from = new Date()): Date {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function parseCompanyDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  return email.slice(at + 1).toLowerCase();
}
