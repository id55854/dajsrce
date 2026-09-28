import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { SOCIAL_MAP_CATEGORIES } from "@/lib/location-map";

const MIGRATION = "20260927110000_claim_review_category.sql";

let sql = "";
/** The migration with full-line `--` commentary removed. */
let executable = "";

function functionBody(name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `${name} is not defined`).toBeGreaterThan(-1);
  const end = sql.indexOf("\n$function$;", start);
  expect(end, `${name} has no terminator`).toBeGreaterThan(start);
  return sql.slice(start, end);
}

beforeAll(async () => {
  sql = await readFile(path.join(process.cwd(), "supabase", "migrations", MIGRATION), "utf8");
  executable = sql
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
});

describe("claim review category migration", () => {
  it("replaces the approval signature atomically, keeping three-argument calls valid", () => {
    expect(executable.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(executable.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(executable).toContain(
      "DROP FUNCTION IF EXISTS public.approve_institution_claim_transaction(uuid, uuid, text);"
    );
    expect(executable).toContain(
      "public.approve_institution_claim_transaction(p_reviewer_id uuid, p_claim_id uuid, p_note text DEFAULT NULL::text, p_category text DEFAULT NULL::text)"
    );
  });

  it("accepts exactly the application's twelve social categories", () => {
    const approve = functionBody("approve_institution_claim_transaction");
    const array = /v_social constant text\[\] := ARRAY\[([\s\S]*?)\];/.exec(approve);
    expect(array).not.toBeNull();
    const listed = [...(array?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(listed).toEqual([...SOCIAL_MAP_CATEGORIES].sort());
    expect(listed).not.toContain("association");
  });

  it("never publishes an approval outside the social categories", () => {
    const approve = functionBody("approve_institution_claim_transaction");
    expect(approve).toContain(
      "IF v_requested_category IS NOT NULL AND NOT (v_requested_category = ANY (v_social)) THEN"
    );
    expect(approve).toContain("RAISE EXCEPTION 'invalid category' USING ERRCODE = '22023';");
    expect(approve).toContain("IF v_category IS NULL OR NOT (v_category = ANY (v_social)) THEN");
    expect(approve).toContain("RAISE EXCEPTION 'choose a social category for this organisation'");
    // The old catch-all fallback is gone.
    expect(approve).not.toContain("''), 'association');");
    // The reviewer's choice wins over the register's.
    expect(approve).toMatch(
      /v_category := coalesce\(\s*v_requested_category,\s*nullif\(btrim\(coalesce\(v_directory\.category, ''\)\), ''\)\s*\);/
    );
    // A protected category still hides the location, whoever chose it.
    expect(approve).toContain("IF v_category = 'domestic_violence' THEN\n    v_hidden := true;");
  });

  it("records the category in the audit event and the result", () => {
    const approve = functionBody("approve_institution_claim_transaction");
    expect(approve).toContain("'institution_claim.approve'");
    expect(approve).toContain("'category', v_category,\n      'category_chosen_by_reviewer'");
    expect(approve).toContain("'is_location_hidden', v_hidden,\n    'category', v_category\n  );");
  });

  it("shows the reviewer the category, the classifier status and its suggestion", () => {
    const list = functionBody("list_institution_claims_for_review");
    expect(list).toContain("'category', d.category,");
    expect(list).toContain("'classification_status', r.classification_status,");
    expect(list).toContain("WHEN r.classification_status = 'needs_review' THEN r.mapped_category");
    expect(list).toContain("LEFT JOIN public.ngo_registry r ON r.udr_id = c.udr_id");
  });

  it("keeps both functions hardened and service-only", () => {
    const definers = sql.match(/^\s*(STABLE )?SECURITY DEFINER\s*$/gim)?.length ?? 0;
    const hardened =
      sql.match(/^\s*(STABLE )?SECURITY DEFINER\s*\r?\n\s*SET search_path TO 'pg_catalog', 'public'/gim)
        ?.length ?? 0;
    expect(definers).toBe(2);
    expect(hardened).toBe(definers);
    for (const signature of [
      "approve_institution_claim_transaction(uuid, uuid, text, text)",
      "list_institution_claims_for_review(uuid, text, integer)",
    ]) {
      expect(executable).toContain(
        `REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC, anon, authenticated;`
      );
      expect(executable).toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO service_role;`);
    }
    expect(executable).not.toMatch(/GRANT EXECUTE[^;]*\b(anon|authenticated)\b/i);
  });
});
