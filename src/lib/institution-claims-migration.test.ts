import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const MIGRATION = "20260812120000_institution_claims.sql";

const MUTATION_RPCS = [
  "search_claimable_associations_v1",
  "request_institution_claim_transaction",
  "start_institution_claim_email_verification",
  "confirm_institution_claim_email",
  "approve_institution_claim_transaction",
  "reject_institution_claim_transaction",
  "withdraw_institution_claim_transaction",
  "list_institution_claims_for_review",
  "get_own_institution_claim",
];

let sql = "";
/** The migration with full-line `--` commentary removed. */
let executable = "";

/** The body of one `CREATE OR REPLACE FUNCTION public.<name>` definition. */
function functionBody(name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `${name} is not defined`).toBeGreaterThan(-1);
  const end = sql.indexOf("\n$$;", start);
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

describe("institution claim migration contracts", () => {
  it("hardens every SECURITY DEFINER search path", () => {
    const definitions = sql.match(/^\s*SECURITY DEFINER\s*$/gim)?.length ?? 0;
    const hardened =
      sql.match(/^\s*SECURITY DEFINER\s*\r?\n\s*SET search_path = pg_catalog,/gim)?.length ?? 0;
    expect(definitions).toBeGreaterThan(0);
    expect(hardened).toBe(definitions);
  });

  it("keeps every claim RPC service-only", () => {
    for (const name of MUTATION_RPCS) {
      expect(sql, `${name} is not revoked`).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${name}\\([^;]+FROM PUBLIC, anon, authenticated`,
          "i"
        )
      );
      expect(sql, `${name} is not granted to service_role`).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^;]+TO service_role`, "i")
      );
    }
  });

  it("never exposes the claim table or the picker to anonymous callers", () => {
    expect(sql).toContain("ALTER TABLE public.institution_claims ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain(
      "REVOKE ALL ON public.institution_claims FROM PUBLIC, anon, authenticated"
    );
    // Explicit column grants only: no broad `GRANT SELECT ON <table>`.
    expect(sql).not.toMatch(/GRANT SELECT ON public\.institution_claims/i);
    expect(sql).toMatch(/GRANT SELECT \([^)]+\)\s+ON public\.institution_claims TO authenticated/i);
    // No GRANT EXECUTE in this migration may reach anon.
    expect(executable).not.toMatch(/GRANT EXECUTE[^;]*\banon\b/i);
  });

  it("hides the digest, its expiry and the reviewer from the browser column grant", () => {
    const grant = /GRANT SELECT \(([^)]+)\)\s+ON public\.institution_claims TO authenticated/i.exec(
      sql
    );
    expect(grant).not.toBeNull();
    const columns = (grant?.[1] ?? "").split(",").map((c) => c.trim());
    expect(columns).not.toContain("email_token_hash");
    expect(columns).not.toContain("email_token_expires_at");
    expect(columns).not.toContain("reviewed_by");
  });
});

describe("claim eligibility is decided in the database", () => {
  it("refuses a udr_id that is not in the currently published snapshot", () => {
    for (const name of [
      "request_institution_claim_transaction",
      "approve_institution_claim_transaction",
    ]) {
      const body = functionBody(name);
      expect(body, `${name} does not read the publication pointer`).toContain(
        "FROM public.registry_publication_state state"
      );
      expect(body, `${name} does not bind the entry to the live batch`).toMatch(
        /public\.registry_directory_entries d\s+WHERE d\.batch_id = v_batch_id AND d\.udr_id/
      );
      expect(body, `${name} does not refuse a missing entry`).toContain(
        "organisation is not in the published registry snapshot"
      );
      expect(body, `${name} does not require an active organisation`).toContain("'AKTIVAN'");
      expect(body).toContain("FOR UPDATE");
    }
  });

  it("refuses a second open claim per profile and a second claim per organisation", () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_institution_claims_open_per_profile\s+ON public\.institution_claims \(profile_id\)\s+WHERE status IN \('pending', 'email_sent'\)/
    );
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_institution_claims_open_per_udr\s+ON public\.institution_claims \(udr_id\)\s+WHERE status IN \('pending', 'email_sent', 'approved'\)/
    );

    const request = functionBody("request_institution_claim_transaction");
    expect(request).toContain("an open claim already exists for this account");
    expect(request).toContain("this organisation already has a claim under review");
    expect(request).toContain("organisation is already linked on the platform");
  });

  it("lets only an administrator decide, checked inside the transaction", () => {
    for (const name of [
      "approve_institution_claim_transaction",
      "reject_institution_claim_transaction",
      "list_institution_claims_for_review",
    ]) {
      const body = functionBody(name);
      expect(body, `${name} does not read the reviewer role`).toMatch(
        /SELECT p\.role INTO v_reviewer_role\s+FROM public\.profiles p\s+WHERE p\.id = p_reviewer_id/
      );
      expect(body, `${name} does not require superadmin`).toContain(
        "IF v_reviewer_role IS DISTINCT FROM 'superadmin' THEN"
      );
      expect(body).toContain("USING ERRCODE = '42501'");
    }
  });
});

describe("the mailbox challenge stores a digest and is consumed once", () => {
  it("never persists a raw token", () => {
    expect(sql).toMatch(
      /CHECK \(email_token_hash IS NULL OR email_token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/
    );
    const start = functionBody("start_institution_claim_email_verification");
    expect(start).toContain("p_token_hash !~ '^[0-9a-f]{64}$'");
    // The function only ever receives a digest; there is no plaintext column.
    expect(sql).not.toMatch(/institution_claims[\s\S]{0,400}?\n\s+token text/);
  });

  it("refuses an expired or already-consumed token", () => {
    const confirm = functionBody("confirm_institution_claim_email");
    expect(confirm).toContain("WHERE c.email_token_hash = p_token_hash");
    expect(confirm).toContain("FOR UPDATE");
    expect(confirm).toContain("IF v_claim.email_consumed_at IS NOT NULL THEN");
    expect(confirm).toContain("verification already used");
    expect(confirm).toContain("v_claim.email_token_expires_at <= v_now");
    expect(confirm).toContain("verification expired");
    // Consumption is conditional, so a concurrent replay cannot double-stamp.
    expect(confirm).toContain("WHERE c.id = v_claim.id AND c.email_consumed_at IS NULL");
  });

  it("binds the challenge to the address the official register publishes", () => {
    const start = functionBody("start_institution_claim_email_verification");
    expect(start).toContain("the official register publishes no email for this organisation");
    expect(start).toContain(
      "contact email does not match the address published by the register"
    );
  });

  it("clears the digest as soon as the claim leaves the open states", () => {
    for (const name of [
      "approve_institution_claim_transaction",
      "reject_institution_claim_transaction",
      "withdraw_institution_claim_transaction",
    ]) {
      expect(functionBody(name), `${name} keeps the digest`).toContain("email_token_hash = NULL");
    }
  });
});

describe("approval builds the institution from register facts", () => {
  const forbiddenCoordinate = /45\.8131|15\.9775/;

  it("never fabricates a coordinate", () => {
    // Only the header commentary, which documents the bug being removed, is
    // allowed to mention the old fabricated Zagreb point.
    expect(executable).not.toMatch(forbiddenCoordinate);
    expect(executable).not.toContain("Location withheld");
    const approve = functionBody("approve_institution_claim_transaction");
    // Exact only from an authoritative DGU address match.
    expect(approve).toContain("v_registry.geocode_source = 'dgu_inspire_addresses'");
    expect(approve).toContain("v_registry.geocode_confidence = 'exact'");
    // Anything else publishes the coarse point and hides the location.
    expect(approve).toContain("v_hidden := true;");
    // No usable point at all is a refusal, not an invented centre of Zagreb.
    expect(approve).toContain("the register has no usable location for this organisation");
  });

  it("copies name, address, city and county from the published directory row", () => {
    const approve = functionBody("approve_institution_claim_transaction");
    expect(approve).toContain("INSERT INTO public.institutions (");
    expect(approve).toContain("v_directory.name");
    expect(approve).toContain("v_directory.address");
    expect(approve).toContain("v_directory.city");
    expect(approve).toContain("v_directory.county");
    expect(approve).toContain("'registry_claim'");
    // Verified only because a reviewer approved it.
    expect(sql).toContain(
      "CHECK (source IN ('curated', 'registry', 'user_claimed', 'registry_claim'))"
    );
  });

  it("links the canonical registry row, the directory projection and the profile", () => {
    const approve = functionBody("approve_institution_claim_transaction");
    expect(approve).toMatch(
      /UPDATE public\.ngo_registry r\s+SET institution_id = v_institution\.id/
    );
    expect(approve).toMatch(
      /UPDATE public\.registry_directory_entries d\s+SET institution_id = v_institution\.id/
    );
    // The map joins institutions through the directory row, so the pin has to
    // be recomputed as part of the same transaction.
    expect(approve).toContain("public.registry_public_map_point(");
    expect(approve).toContain("map_location = extensions.st_setsrid(");
    expect(approve).toMatch(
      /UPDATE public\.profiles p\s+SET role = 'ngo', institution_id = v_institution\.id/
    );
    expect(approve).toContain("'institution_claim.approve'");
  });

  it("writes an audit event for every state transition", () => {
    for (const [name, action] of [
      ["request_institution_claim_transaction", "institution_claim.request"],
      ["start_institution_claim_email_verification", "institution_claim.email.start"],
      ["confirm_institution_claim_email", "institution_claim.email.confirm"],
      ["approve_institution_claim_transaction", "institution_claim.approve"],
      ["reject_institution_claim_transaction", "institution_claim.reject"],
      ["withdraw_institution_claim_transaction", "institution_claim.withdraw"],
    ] as const) {
      const body = functionBody(name);
      expect(body, `${name} does not append an audit event`).toContain(
        "public.append_audit_log_event("
      );
      expect(body, `${name} logs the wrong action`).toContain(`'${action}'`);
    }
  });
});

describe("onboarding no longer mints institutions", () => {
  it("redefines complete_profile_setup without an institutions insert", () => {
    const setup = functionBody("complete_profile_setup");
    expect(setup).not.toContain("INSERT INTO public.institutions");
    expect(setup).toContain("SET role = 'ngo', institution_id = NULL");
    // The signature and grants are restated so a deployed client keeps working.
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.complete_profile_setup(text, text) TO authenticated"
    );
  });

  it("still refuses to rewrite a profile that already holds an institution", () => {
    const setup = functionBody("complete_profile_setup");
    expect(setup).toContain("v_profile.institution_id IS NOT NULL");
    expect(setup).toContain("profile onboarding is already complete");
  });
});

describe("an unlinked NGO cannot publish", () => {
  it("requires a non-null institution on every needs and event write policy", () => {
    for (const policy of [
      "Linked NGO creates needs",
      "Linked NGO updates own needs",
      "Linked NGO creates volunteer events",
    ]) {
      const start = sql.indexOf(`CREATE POLICY "${policy}"`);
      expect(start, `${policy} is missing`).toBeGreaterThan(-1);
      const body = sql.slice(start, sql.indexOf(";", start));
      expect(body, `${policy} allows a NULL institution`).toContain(
        "public.current_user_institution_id() IS NOT NULL"
      );
      expect(body).toContain("institution_id = public.current_user_institution_id()");
      expect(body).toContain("TO authenticated");
    }
  });

  it("drops the old profile-subquery policies that never checked the role", () => {
    expect(sql).toContain(
      'DROP POLICY IF EXISTS "Institution users can create needs" ON public.needs'
    );
    expect(sql).toContain(
      'DROP POLICY IF EXISTS "Institution users can update own needs" ON public.needs'
    );
    expect(sql).toContain(
      'DROP POLICY IF EXISTS "Institution users can create events" ON public.volunteer_events'
    );
  });

  it("gives the update policy a WITH CHECK so a row cannot be re-pointed", () => {
    const start = sql.indexOf('CREATE POLICY "Linked NGO updates own needs"');
    const body = sql.slice(start, sql.indexOf(";", start));
    expect(body).toContain("USING (");
    expect(body).toContain("WITH CHECK (");
  });

  it("closes the stock table privileges these two tables still had", () => {
    expect(sql).toContain("REVOKE INSERT, UPDATE, DELETE ON public.needs FROM anon");
    expect(sql).toContain("REVOKE INSERT, UPDATE, DELETE ON public.volunteer_events FROM anon");
    expect(sql).toContain("REVOKE DELETE ON public.needs FROM authenticated");
    expect(sql).toContain("REVOKE DELETE ON public.volunteer_events FROM authenticated");
  });
});
