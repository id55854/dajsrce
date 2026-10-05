import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const MIGRATIONS = path.join(process.cwd(), "supabase", "migrations");
const ORGANISATIONS = "20261005120000_official_organisation_claims.sql";
const LOCATIONS = "20261005110000_curated_locations_dgu.sql";

let sql = "";
let executable = "";
let locations = "";

function withoutComments(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

function functionBody(name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `${name} is not defined`).toBeGreaterThan(-1);
  const end = sql.slice(start).search(/\n\$(function)?\$;/);
  expect(end, `${name} has no terminator`).toBeGreaterThan(0);
  return sql.slice(start, start + end);
}

async function liveBody(file: string, name: string): Promise<string> {
  const text = await readFile(path.join(MIGRATIONS, file), "utf8");
  const start = text.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const end = text.slice(start).search(/\n\$(function)?\$;/);
  return text.slice(start, start + end);
}

beforeAll(async () => {
  sql = await readFile(path.join(MIGRATIONS, ORGANISATIONS), "utf8");
  executable = withoutComments(sql);
  locations = withoutComments(await readFile(path.join(MIGRATIONS, LOCATIONS), "utf8"));
});

describe("official organisation claims migration", () => {
  it("runs in one transaction", () => {
    expect(executable.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(executable.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("keeps the mirror away from every API role", () => {
    for (const table of ["official_organisations", "official_organisation_syncs"]) {
      expect(executable).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);
      expect(executable).toContain(`REVOKE ALL ON public.${table} FROM PUBLIC, anon, authenticated;`);
      expect(executable).toContain(`GRANT ALL ON public.${table} TO service_role;`);
    }
    expect(executable).not.toMatch(/GRANT [^;]*TO (anon|authenticated)/i);
  });

  it("revokes every new function from the API roles and grants it to service_role only", () => {
    const created = [...executable.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map(
      (match) => match[1]
    );
    const existing = new Set([
      "search_claimable_associations_v1",
      "request_institution_claim_transaction",
      "approve_institution_claim_transaction",
      "start_institution_claim_email_verification",
      "confirm_institution_claim_email",
      "get_own_institution_claim",
      "list_institution_claims_for_review",
      "map_association_registry_v1",
    ]);
    for (const name of created.filter((fn) => !existing.has(fn))) {
      expect(executable, name).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`)
      );
      expect(executable, name).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) TO service_role;`)
      );
    }
  });

  it("hardens the search path of every SECURITY DEFINER function", () => {
    const definers = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(([\s\S]*?)\$(function)?\$/g)];
    for (const [, name, header] of definers) {
      if (!/SECURITY DEFINER/.test(header)) continue;
      expect(header, name).toMatch(/SET search_path (=|TO) '?pg_catalog'?/);
    }
  });

  it("accepts only the register keys it mirrors and never a person's data", () => {
    expect(executable).toContain(
      "id ~ '^(epokc|evz|zaklade):[0-9][0-9.]{0,19}$' OR id ~ '^oib:[0-9]{11}$'"
    );
    for (const column of ["iban", "person", "osoba", "contact_person"]) {
      expect(executable.toLowerCase()).not.toMatch(new RegExp(`\\b${column}\\b[^\\n]*\\b(text|jsonb)\\b`));
    }
  });

  it("leaves registered associations to their UDR_ID", () => {
    const upsert = functionBody("upsert_official_organisations_batch");
    expect(upsert).toContain("FROM public.ngo_registry g");
    expect(upsert).toContain("g.oib = r.oib AND g.source_present AND g.status = 'AKTIVAN'");
  });

  it("refuses a sync that would deactivate most of the mirror", () => {
    const finish = functionBody("finish_official_organisations_sync");
    expect(finish).toContain("v_seen < floor(v_active_before * 0.9)");
    expect(finish).toContain("v_seen <> p_expected_rows");
  });

  it("keeps the associations path of request and approval byte for byte", async () => {
    const dispatch = /\n {2}-- Organisations outside the associations register \(20261005120000\)[\s\S]*?\n {2}END IF;\n/;
    const request = functionBody("request_institution_claim_transaction").replace(dispatch, "\n");
    expect(request).toBe(
      await liveBody("20260926110000_launch_claims_editing_and_safety.sql", "request_institution_claim_transaction")
    );

    const approve = functionBody("approve_institution_claim_transaction").replace(dispatch, "\n");
    expect(approve).toBe(
      await liveBody("20260927110000_claim_review_category.sql", "approve_institution_claim_transaction")
    );
  });

  it("changes no claim RPC signature", () => {
    expect(executable).not.toMatch(/DROP FUNCTION/);
    expect(executable).not.toContain("p_institution_id uuid DEFAULT");
  });

  it("sends only organisation keys down the new path", () => {
    expect(functionBody("request_institution_claim_transaction")).toContain(
      "IF public.is_official_organisation_key(btrim(coalesce(p_udr_id, ''))) THEN"
    );
    expect(functionBody("approve_institution_claim_transaction")).toContain(
      "WHERE c.id = p_claim_id AND public.is_official_organisation_key(c.udr_id)"
    );
    expect(functionBody("is_official_organisation_key")).toContain("'^(epokc|evz|zaklade|oib):'");
  });

  it("keeps the mailbox rule and never fabricates a building for an organisation", () => {
    const approve = functionBody("approve_organisation_claim_transaction");
    expect(approve).toContain("v_note !~* '^[[:space:]]*provjereno[[:space:]]*:'");
    expect(approve).toContain("v_org.geocode_source = 'dgu_inspire_addresses'");
    expect(approve).toContain("the register has no usable location for this organisation");
    // A coarse point is published hidden, like an association's without DGU.
    expect(approve).toMatch(/registry_public_map_point\([\s\S]*?\) point;\n\s*v_hidden := true;/);
    expect(approve).toContain("IF v_category = 'domestic_violence' THEN");
    expect(approve).toContain("'organisation_claim'");
  });

  it("takes back only the organisation's own earlier institution, never a curated one", () => {
    const approve = functionBody("approve_organisation_claim_transaction");
    expect(approve).toContain("v_adopt_id := v_org.institution_id;");
    expect(approve).not.toContain("'curated'");
    expect(approve).toContain("v_category := v_requested_category;");
  });

  it("challenges only an address an official register publishes", () => {
    const start = functionBody("start_institution_claim_email_verification");
    expect(start).toContain("FROM public.official_organisations o");
    expect(start).toContain("the official register publishes no email for this organisation");
    expect(start).not.toMatch(/v_registry_email\s*:=\s*[^;]*contact_email/);
  });

  it("puts claimed organisations on the map like curated ones", () => {
    const map = functionBody("map_association_registry_v1");
    expect(map).toContain("(i.source IN ('curated', 'organisation_claim') AND i.is_verified = true)");
    expect(map).toContain("OR i.source = 'official_register'");
    expect(map).not.toContain("WHERE i.source = 'curated'");
    expect(executable).toContain("'registry_claim', 'organisation_claim', 'official_register'");
  });

  it("puts only Caritas on the map before a claim, on its DGU building, never over a curated seat", () => {
    const refresh = functionBody("refresh_official_organisation_map_points");
    expect(refresh).toContain("public.hr_fold(o.name) ~ '(^| )caritas( |$)'");
    expect(refresh).toContain("o.primary_register IN ('epokc', 'evz')");
    expect(refresh).toContain("o.geocode_source = 'dgu_inspire_addresses'");
    expect(refresh).toContain("WHERE i.source = 'curated'");
    expect(refresh).toContain("false, false, 'official_register'");
    // Only an unheld register pin is ever removed.
    expect(refresh).toContain("AND NOT public.official_organisation_is_linked(i.id)");
    expect(functionBody("finish_official_organisations_sync")).toContain(
      "public.refresh_official_organisation_map_points()"
    );
    expect(functionBody("apply_official_organisation_geocodes")).toContain(
      "PERFORM public.refresh_official_organisation_map_points();"
    );
  });
});

describe("curated locations migration", () => {
  it("runs in one transaction", () => {
    expect(locations.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(locations.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("moves Babonićeva 121 to its DGU building only from the old point", () => {
    expect(locations).toMatch(
      /'c7d3ce6a-7fda-4fc6-8d85-64d0afa896be', 45\.809, 15\.9372, 45\.82437414, 15\.98788045/
    );
    expect(locations).toContain("AND i.lat = v.old_lat AND i.lng = v.old_lng");
  });

  it("moves only curated institutions and clears hand-typed stops", () => {
    expect(locations).toContain("AND i.source = 'curated'");
    expect(locations).toContain("SET nearest_zet_stop = NULL, zet_lines = NULL");
  });
});
