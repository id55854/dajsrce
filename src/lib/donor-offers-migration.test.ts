import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const MIGRATION = "20260812130000_donor_offers.sql";

const MUTATION_RPCS = [
  "create_donor_offer_transaction",
  "update_donor_offer_transaction",
  "set_donor_offer_status_transaction",
  "claim_donor_offer_transaction",
  "withdraw_offer_claim_transaction",
  "respond_to_offer_claim_transaction",
  "list_open_donor_offers",
  "list_own_donor_offers",
  "list_institution_offer_claims",
  "expire_due_donor_offers_batch",
];

let sql = "";

beforeAll(async () => {
  sql = await readFile(
    path.join(process.cwd(), "supabase", "migrations", MIGRATION),
    "utf8"
  );
});

describe("donor offer migration contracts", () => {
  it("hardens every SECURITY DEFINER search path", () => {
    const definitions = sql.match(/^\s*SECURITY DEFINER\s*$/gim)?.length ?? 0;
    const hardened =
      sql.match(/^\s*SECURITY DEFINER\s*\r?\n\s*SET search_path = pg_catalog,/gim)
        ?.length ?? 0;
    expect(definitions).toBeGreaterThan(0);
    expect(hardened).toBe(definitions);
  });

  it("keeps every offer RPC service-only", () => {
    for (const name of MUTATION_RPCS) {
      expect(sql, `${name} is not revoked`).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${name}\\([^;]+FROM PUBLIC, anon, authenticated`,
          "i"
        )
      );
      expect(sql, `${name} is not granted to service_role`).toMatch(
        new RegExp(
          `GRANT EXECUTE ON FUNCTION public\\.${name}\\([^;]+TO service_role`,
          "i"
        )
      );
    }
    // No GRANT EXECUTE statement in this migration may reach `anon`.
    expect(sql).not.toMatch(/GRANT EXECUTE[^;]*\banon\b/i);
  });

  it("never gives anonymous callers a row", () => {
    expect(sql).toContain("ALTER TABLE public.donor_offers ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("ALTER TABLE public.offer_claims ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain(
      "REVOKE ALL ON public.donor_offers FROM PUBLIC, anon, authenticated"
    );
    expect(sql).toContain(
      "REVOKE ALL ON public.offer_claims FROM PUBLIC, anon, authenticated"
    );
    expect(sql).not.toMatch(/GRANT SELECT[^;]*ON public\.donor_offers[^;]*TO[^;]*anon/i);
    expect(sql).not.toMatch(/GRANT SELECT[^;]*ON public\.offer_claims[^;]*TO[^;]*anon/i);
  });

  it("grants explicit columns rather than a whole table", () => {
    expect(sql).toMatch(/GRANT SELECT \(\s*id, user_id, title/i);
    expect(sql).toMatch(/GRANT SELECT \(\s*id, offer_id, institution_id, status/i);
    // The requesting staff member's profile id is not in any read surface.
    expect(sql).not.toMatch(/GRANT SELECT \([^)]*claimed_by[^)]*\)/i);
    expect(sql).not.toMatch(/GRANT SELECT ON public\.(donor_offers|offer_claims)/i);
  });

  it("stores a coarse point and no exact private location", () => {
    const table = sql.slice(
      sql.indexOf("CREATE TABLE IF NOT EXISTS public.donor_offers"),
      sql.indexOf("CREATE TABLE IF NOT EXISTS public.offer_claims")
    );
    expect(table).toContain("coarse_lat double precision");
    expect(table).toContain("coarse_lng double precision");
    // No exact coordinate pair and no street address may exist on the row.
    expect(table).not.toMatch(/^\s+lat\s+double precision/im);
    expect(table).not.toMatch(/^\s+lng\s+double precision/im);
    expect(table).not.toMatch(/^\s+address\s+text/im);

    // The grid projection matches the institution privacy projection.
    expect(sql).toContain("grid_size constant double precision := 0.05");
    expect(sql).toContain("coarse_lat := floor((p_lat + 90.0) / grid_size)");
    expect(sql).toMatch(/IF coarse_lat = p_lat AND coarse_lng = p_lng THEN/);
  });

  it("requires verified organisation membership before an offer is visible", () => {
    expect(sql).toContain("verified_offer_institution_for_actor");
    expect(sql).toContain("organisation is not verified");
    expect(sql).toContain("organisation membership required");
    expect(sql).toMatch(/v_role <> 'ngo'/);
    expect(sql).toMatch(/coalesce\(v_is_verified, false\) = false/);
    // Both the browse RPC and the claim RPC go through the same gate.
    for (const name of [
      "claim_donor_offer_transaction",
      "list_open_donor_offers",
      "list_institution_offer_claims",
    ]) {
      const body = sql.slice(sql.indexOf(`FUNCTION public.${name}(`));
      expect(body.slice(0, 4000)).toContain(
        "public.verified_offer_institution_for_actor(p_actor_id)"
      );
    }
  });

  it("locks the parent offer before any multi-row transition", () => {
    for (const name of [
      "update_donor_offer_transaction",
      "set_donor_offer_status_transaction",
      "claim_donor_offer_transaction",
      "respond_to_offer_claim_transaction",
    ]) {
      const body = sql.slice(sql.indexOf(`FUNCTION public.${name}(`));
      expect(body.slice(0, 4000), `${name} takes no row lock`).toMatch(
        /FROM public\.donor_offers WHERE id = [\w_.]+ FOR UPDATE/
      );
    }
    expect(sql).toContain("FOR UPDATE OF o SKIP LOCKED");
  });

  it("declines the remaining requests atomically when one is accepted", () => {
    const respond = sql.slice(
      sql.indexOf("FUNCTION public.respond_to_offer_claim_transaction("),
      sql.indexOf("REVOKE ALL ON FUNCTION public.respond_to_offer_claim_transaction")
    );
    // Siblings are declined and the offer flips to 'claimed' in the same body,
    // under the lock taken on the parent offer.
    expect(respond).toMatch(
      /UPDATE public\.offer_claims\s+SET status = 'declined', responded_at = v_now\s+WHERE offer_id = v_offer_id AND status = 'requested' AND id <> p_claim_id/
    );
    expect(respond).toMatch(/SET status = 'accepted', responded_at = v_now/);
    expect(respond).toMatch(/SET status = 'claimed',\s+claimed_institution_id = v_claim\.institution_id/);
    expect(respond).toContain("declined_others");
    // Only the offer's author may answer.
    expect(respond).toMatch(/v_offer\.user_id <> p_actor_id/);
  });

  it("keeps the author the only actor who can withdraw an offer", () => {
    const status = sql.slice(
      sql.indexOf("FUNCTION public.set_donor_offer_status_transaction("),
      sql.indexOf("REVOKE ALL ON FUNCTION public.set_donor_offer_status_transaction")
    );
    expect(status).toMatch(/v_offer\.user_id <> p_actor_id/);
    expect(status).toContain("RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'");
    // Withdrawing releases the organisations still waiting for an answer.
    expect(status).toMatch(
      /UPDATE public\.offer_claims\s+SET status = 'declined', responded_at = v_now/
    );
  });

  it("enforces one live claim per organisation and one acceptance per offer", () => {
    expect(sql).toContain("uq_offer_claims_live_per_institution");
    expect(sql).toContain("uq_offer_claims_accepted_per_offer");
    expect(sql).toMatch(/WHERE status = 'accepted'/);
  });

  it("bounds every list RPC", () => {
    for (const name of [
      "list_open_donor_offers",
      "list_own_donor_offers",
      "list_institution_offer_claims",
    ]) {
      const body = sql.slice(sql.indexOf(`FUNCTION public.${name}(`));
      expect(body.slice(0, 4000), `${name} is unbounded`).toContain(
        "greatest(1, least(coalesce(p_limit, 30), 60))"
      );
    }
  });

  it("commits as one migration", () => {
    expect(sql.trimStart().startsWith("--")).toBe(true);
    expect(sql).toContain("\nBEGIN;\n");
    expect(sql.trim().endsWith("COMMIT;")).toBe(true);
  });
});
