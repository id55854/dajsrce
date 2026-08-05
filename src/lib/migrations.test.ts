import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = path.join(process.cwd(), "supabase", "migrations");
const releaseMigrations = [
  "202608010300_transactional_integrity.sql",
  "20260801150000_location_fast_path.sql",
  "20260801160000_security_release_gate.sql",
  "20260801170000_registry_pipeline.sql",
  "20260801180000_async_notifications_public_metrics.sql",
  "20260804190000_official_association_directory.sql",
  "20260804200000_registry_snapshot_reconciliation.sql",
  "20260804203000_atomic_registry_snapshot_visibility.sql",
  "20260804210000_registry_snapshot_memberships.sql",
  "20260804213000_constant_time_registry_finalize.sql",
  "20260804220000_registry_directory_projection.sql",
  "20260804223000_registry_compatibility_reconciliation.sql",
  "20260804230000_registry_storage_lifecycle.sql",
  "20260804233000_registry_count_fast_path.sql",
  "20260805010000_active_registry_scope.sql",
  "20260805160000_active_registry_map.sql",
  "20260805180000_dgu_exact_address_geocoding.sql",
];

describe("release migration contracts", () => {
  it("uses unique, sortable migration identifiers", async () => {
    const names = (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql"));
    const identifiers = names.map((name) => name.split("_")[0]);
    expect(new Set(identifiers).size).toBe(identifiers.length);
    expect(names).toContain("20260801010000_profiles_locale_default_en.sql");
  });

  it.each(releaseMigrations)("hardens SECURITY DEFINER search paths in %s", async (name) => {
    const sql = await readFile(path.join(migrationsDirectory, name), "utf8");
    const definitionCount = sql.match(/^\s*SECURITY DEFINER\s*$/gim)?.length ?? 0;
    const hardenedCount = sql.match(
      /^\s*SECURITY DEFINER\s*\r?\n\s*SET search_path = pg_catalog,/gim
    )?.length ?? 0;
    expect(definitionCount).toBeGreaterThan(0);
    expect(hardenedCount).toBe(definitionCount);
  });

  it("keeps mutation and evidence RPCs service-only", async () => {
    const sql = await readFile(
      path.join(migrationsDirectory, "202608010300_transactional_integrity.sql"),
      "utf8"
    );
    for (const functionName of [
      "create_pledge_transaction",
      "acknowledge_pledge_transaction",
      "volunteer_checkout_transaction",
      "claim_stripe_event",
      "reserve_artifact_version",
      "get_acknowledged_pledges_json",
    ]) {
      expect(sql).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${functionName}\\([^;]+FROM PUBLIC, anon, authenticated`, "i")
      );
      expect(sql).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${functionName}\\([^;]+TO service_role`, "i")
      );
    }
  });

  it("preserves private exact locations behind bounded public projections", async () => {
    const [locationSql, securitySql] = await Promise.all([
      readFile(path.join(migrationsDirectory, "20260801150000_location_fast_path.sql"), "utf8"),
      readFile(path.join(migrationsDirectory, "20260801160000_security_release_gate.sql"), "utf8"),
    ]);
    expect(locationSql).toContain("public_location extensions.geography(Point, 4326)");
    expect(locationSql).toMatch(
      /WHEN coalesce\(is_location_hidden, false\) THEN ''\s+ELSE coalesce\(address, ''\)/i
    );
    expect(locationSql).toContain("p_limit integer");
    expect(locationSql).toMatch(/greatest\(1, least\(coalesce\(p_limit, 150\), 200\)\)/i);
    expect(securitySql).toContain("REVOKE SELECT ON public.institutions FROM anon, authenticated");
    expect(securitySql).toContain("public_lat");
    expect(securitySql).toContain("public_lng");
  });

  it("queues nearby delivery and bases public impact on acknowledgements", async () => {
    const sql = await readFile(
      path.join(migrationsDirectory, "20260801180000_async_notifications_public_metrics.sql"),
      "utf8"
    );
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(sql).toContain("uq_notifications_delivery_job_user");
    expect(sql).toContain("idx_profiles_location_notifications_gist");
    expect(sql).toContain("worker lease expired after final attempt");
    expect(sql).toContain("GRANT UPDATE (is_read) ON public.notifications TO authenticated");
    expect(sql).toMatch(/JOIN public\.pledge_acknowledgements a ON a\.pledge_id = p\.id/i);
    expect(sql).toContain("generation_status = 'ready'");
  });

  it("removes direct mutation bypasses and explicit default function grants", async () => {
    const sql = await readFile(
      path.join(migrationsDirectory, "20260801160000_security_release_gate.sql"),
      "utf8"
    );
    for (const table of ["pledges", "pledge_acknowledgements", "volunteer_signups"]) {
      expect(sql).toMatch(
        new RegExp(`REVOKE INSERT, UPDATE, DELETE ON public\\.${table} FROM anon, authenticated`, "i")
      );
    }
    for (const functionName of [
      "create_company_tenant_transaction",
      "confirm_company_verification",
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${functionName}\\([^;]+FROM PUBLIC, anon, authenticated`,
          "i"
        )
      );
    }
  });

  it("seeds artifact allocators after historic versions", async () => {
    const sql = await readFile(
      path.join(migrationsDirectory, "202608010300_transactional_integrity.sql"),
      "utf8"
    );
    expect(sql).toContain("WITH ranked_reports AS");
    expect(sql).toContain("WITH duplicate_hours AS");
    expect(sql.match(/INSERT INTO public\.artifact_version_counters AS counters/g)).toHaveLength(3);
    expect(sql.trim().endsWith("COMMIT;")).toBe(true);
  });

  it("hosts official registry rows behind bounded public RPCs", async () => {
    const sql = await readFile(
      path.join(migrationsDirectory, "20260804190000_official_association_directory.sql"),
      "utf8"
    );
    expect(sql).toContain("PRIMARY KEY (udr_id)");
    expect(sql).toContain("ALTER COLUMN oib DROP NOT NULL");
    expect(sql).toContain("source_present boolean NOT NULL DEFAULT true");
    expect(sql).toContain("CHECK (validation_status IN ('valid', 'warning', 'invalid'))");
    expect(sql).toContain("p_page_size > 100");
    expect(sql).toContain("registry mirror mismatch");
    expect(sql).toContain("DELETE FROM public.ngo_registry_staging");
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.search_association_registry_v1[\s\S]+TO anon, authenticated, service_role/i);
    expect(sql).not.toMatch(/GRANT\s+SELECT\s+ON\s+public\.ngo_registry\s+TO\s+anon/i);
  });

  it("publishes registry snapshots through one atomic membership pointer", async () => {
    const sql = await readFile(
      path.join(migrationsDirectory, "20260804210000_registry_snapshot_memberships.sql"),
      "utf8"
    );
    expect(sql).toContain("registry_snapshot_memberships");
    expect(sql).toContain("registry_publication_state");
    expect(sql).toContain("registry membership mismatch");
    expect(sql).toMatch(/SET current_batch_id = p_batch_id/i);
    expect(sql).not.toMatch(/GRANT\s+SELECT\s+ON\s+public\.current_association_registry/i);
  });

  it("keeps final snapshot publication constant-time", async () => {
    const sql = await readFile(
      path.join(migrationsDirectory, "20260804213000_constant_time_registry_finalize.sql"),
      "utf8"
    );
    expect(sql).toContain("v_batch.rows_merged <> p_expected_source_rows");
    expect(sql).toContain("SET current_batch_id = p_batch_id");
    expect(sql).not.toMatch(/count\(\*\)[\s\S]+registry_snapshot_memberships/i);
  });

  it("serves directory queries from a lean snapshot projection", async () => {
    const sql = await readFile(
      path.join(migrationsDirectory, "20260804220000_registry_directory_projection.sql"),
      "utf8"
    );
    expect(sql).toContain("registry_directory_entries");
    expect(sql).toContain("registry_snapshot_facets");
    expect(sql).toContain("refresh_registry_snapshot_facets");
    expect(sql).toMatch(/FROM public\.registry_directory_entries d/i);
    expect(sql).not.toMatch(/GRANT\s+SELECT\s+ON\s+public\.registry_directory_entries/i);
  });

  it("reconciles legacy maintenance visibility in bounded service-only batches", async () => {
    const sql = await readFile(
      path.join(migrationsDirectory, "20260804223000_registry_compatibility_reconciliation.sql"),
      "utf8"
    );
    expect(sql).toContain("idx_ngo_registry_source_present_udr_id");
    expect(sql).toContain("p_limit integer DEFAULT 250");
    expect(sql).toContain("FOR UPDATE OF r SKIP LOCKED");
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.reconcile_registry_source_presence_batch[\s\S]+TO service_role/i);
    expect(sql).not.toMatch(/GRANT EXECUTE[\s\S]+TO anon/i);
  });

  it("bounds historical registry snapshot storage", async () => {
    const sql = await readFile(
      path.join(migrationsDirectory, "20260804230000_registry_storage_lifecycle.sql"),
      "utf8"
    );
    expect(sql).toContain("cleanup_registry_snapshot_storage_batch");
    expect(sql).toContain("p_limit integer DEFAULT 250");
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(sql).toContain("DROP INDEX IF EXISTS public.idx_ngo_registry_name_trgm");
    expect(sql).toContain("idx_registry_directory_entries_city_trgm");
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.cleanup_registry_snapshot_storage_batch[\s\S]+TO service_role/i);
    expect(sql).not.toMatch(/GRANT EXECUTE[\s\S]+TO anon/i);
  });

  it("uses immutable facets for unfiltered directory totals", async () => {
    const sql = await readFile(
      path.join(migrationsDirectory, "20260804233000_registry_count_fast_path.sql"),
      "utf8"
    );
    expect(sql).toMatch(/IF v_query IS NULL AND v_status IS NULL[\s\S]+registry_snapshot_facets/i);
    expect(sql).toMatch(/ELSE\s+SELECT count\(\*\) INTO v_total/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.search_association_registry_v1[\s\S]+TO anon, authenticated, service_role/i);
  });

  it("enforces an active-only official registry and purges unpublished rows", async () => {
    const sql = await readFile(
      path.join(migrationsDirectory, "20260805010000_active_registry_scope.sql"),
      "utf8"
    );
    expect(sql).toContain("mirror_scope IN ('complete', 'active')");
    expect(sql).toContain("status IS DISTINCT FROM 'AKTIVAN'");
    expect(sql).toContain("idx_ngo_registry_import_batch_udr_id");
    expect(sql).toContain("purge_unpublished_registry_rows_batch");
    expect(sql).toMatch(/NOT EXISTS \([\s\S]+registry_snapshot_memberships/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.purge_unpublished_registry_rows_batch[\s\S]+TO service_role/i);
    expect(sql).not.toMatch(/GRANT EXECUTE[\s\S]+TO anon/i);
  });

  it("maps every active registry row through bounded, non-truncating clusters", async () => {
    const sql = await readFile(
      path.join(migrationsDirectory, "20260805160000_active_registry_map.sql"),
      "utf8"
    );
    expect(sql).toContain("registry_location_centroids");
    expect(sql).toContain("registry_public_map_point");
    expect(sql).toContain("map_association_registry_v1");
    expect(sql).toContain("axis_cells");
    expect(sql).toContain("s.matches > effective_limit");
    expect(sql).toContain("s.matches <= effective_limit");
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.map_association_registry_v1[\s\S]+TO anon, authenticated, service_role/i);
    expect(sql).not.toMatch(/GRANT\s+SELECT\s+ON\s+public\.registry_location_centroids/i);
  });

  it("publishes only audited DGU building points as exact registry locations", async () => {
    const sql = await readFile(
      path.join(migrationsDirectory, "20260805180000_dgu_exact_address_geocoding.sql"),
      "utf8"
    );
    expect(sql).toContain("registry_dgu_geocode_staging");
    expect(sql).toContain("dgu_inspire_addresses");
    expect(sql).toContain("geocode_confidence = 'exact'");
    expect(sql).toContain("map_association_registry_v2");
    expect(sql).toMatch(/p_limit < 1 OR p_limit > 500/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.apply_registry_dgu_geocode_batch[\s\S]+TO service_role/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.map_association_registry_v2[\s\S]+TO anon, authenticated, service_role/i);
    expect(sql).not.toMatch(/GRANT\s+SELECT[\s\S]+registry_dgu_geocode_staging[\s\S]+TO\s+(?:anon|authenticated)/i);
  });
});
