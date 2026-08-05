// Production-safe coverage, clustering, navigation and access-control checks
// for the active official-registry map projection.

import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "./lib/supabase-admin.mjs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anonKey) throw new Error("Missing public Supabase URL or anon key");

const publicClient = createClient(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: facets, error: facetsError } = await publicClient.rpc(
  "association_registry_facets_v1"
);
assert.ifError(facetsError);
const officialTotal = Number(facets.total);
assert.ok(officialTotal > 40_000, "official active registry unexpectedly small");

const { data: publication, error: publicationError } = await supabaseAdmin
  .from("registry_publication_state")
  .select("current_batch_id")
  .eq("singleton", true)
  .single();
assert.ifError(publicationError);

const { count: mappedCount, error: mappedCountError } = await supabaseAdmin
  .from("registry_directory_entries")
  .select("udr_id", { count: "exact", head: true })
  .eq("batch_id", publication.current_batch_id)
  .not("map_location", "is", null);
assert.ifError(mappedCountError);
assert.equal(mappedCount, officialTotal, "every published active row must have a map point");

const nationalParams = {
  p_min_lng: 13,
  p_min_lat: 42,
  p_max_lng: 20,
  p_max_lat: 47,
  p_zoom: 7,
  p_categories: [],
  p_only_zagreb: false,
  p_only_urgent: false,
  p_limit: 150,
};
const { data: nationalRows, error: nationalError } = await publicClient.rpc(
  "map_association_registry_v2",
  nationalParams
);
assert.ifError(nationalError);
assert.ok(nationalRows.length > 0 && nationalRows.length <= 150);
assert.ok(nationalRows.every((row) => row.feature_kind === "cluster"));
assert.equal(Number(nationalRows[0].total_matches), officialTotal);
assert.equal(
  nationalRows.reduce((sum, row) => sum + Number(row.member_count), 0),
  officialTotal,
  "national cluster counts must represent every active organisation"
);
assert.equal(Number(nationalRows[0].total_features), nationalRows.length);

const { count: dguExactCount, error: dguExactCountError } = await supabaseAdmin
  .from("ngo_registry")
  .select("udr_id", { count: "exact", head: true })
  .eq("geocode_source", "dgu_inspire_addresses")
  .eq("geocode_confidence", "exact");
assert.ifError(dguExactCountError);
assert.equal(dguExactCount, 39_414, "audited DGU exact-point count changed unexpectedly");

const { data: exactRegistryOnly, error: exactRegistryOnlyError } = await supabaseAdmin
  .from("registry_directory_entries")
  .select("udr_id,address")
  .eq("batch_id", publication.current_batch_id)
  .is("institution_id", null)
  .eq("map_precision", "exact")
  .limit(1)
  .single();
assert.ifError(exactRegistryOnlyError);

const { data: exactRows, error: exactError } = await publicClient.rpc(
  "map_association_registry_v2",
  { ...nationalParams, p_query: exactRegistryOnly.udr_id }
);
assert.ifError(exactError);
const exactResult = exactRows.find((row) => row.registry_id === exactRegistryOnly.udr_id);
assert.ok(exactResult, "exact registry ID search must expose the requested map record");
assert.equal(exactResult.location_precision, "exact");
assert.equal(exactResult.address, exactRegistryOnly.address);
assert.equal(exactResult.approximate_area, null);

const { data: approximateRegistryOnly, error: approximateRegistryOnlyError } = await supabaseAdmin
  .from("registry_directory_entries")
  .select("udr_id")
  .eq("batch_id", publication.current_batch_id)
  .is("institution_id", null)
  .in("map_precision", ["city", "county"])
  .limit(1)
  .single();
assert.ifError(approximateRegistryOnlyError);

const { data: searchRows, error: searchError } = await publicClient.rpc(
  "map_association_registry_v2",
  { ...nationalParams, p_query: approximateRegistryOnly.udr_id }
);
assert.ifError(searchError);
const registryResult = searchRows.find((row) => row.registry_id === approximateRegistryOnly.udr_id);
assert.ok(registryResult, "registry ID search must expose the requested map record");
assert.equal(registryResult.entity_type, "registry");
assert.equal(registryResult.feature_id, `registry:${approximateRegistryOnly.udr_id}`);
assert.ok(["city", "county"].includes(registryResult.location_precision));
assert.equal(registryResult.address, null);

const { data: hiddenDirectory, error: hiddenDirectoryError } = await supabaseAdmin
  .from("registry_directory_entries")
  .select("udr_id")
  .eq("batch_id", publication.current_batch_id)
  .eq("map_precision", "hidden")
  .limit(1)
  .maybeSingle();
assert.ifError(hiddenDirectoryError);
if (hiddenDirectory) {
  const { data: hiddenRows, error: hiddenError } = await publicClient.rpc(
    "map_association_registry_v2",
    { ...nationalParams, p_query: hiddenDirectory.udr_id }
  );
  assert.ifError(hiddenError);
  const hiddenResult = hiddenRows.find((row) => row.registry_id === hiddenDirectory.udr_id);
  assert.ok(hiddenResult, "hidden registry link must remain represented on the map");
  assert.equal(hiddenResult.location_precision, "hidden");
  assert.equal(hiddenResult.address, null);
}

const { error: directProjectionError } = await publicClient
  .from("registry_directory_entries")
  .select("udr_id")
  .limit(1);
assert.ok(directProjectionError, "anonymous direct projection reads must be denied");

console.log(JSON.stringify({
  ok: true,
  batch_id: publication.current_batch_id,
  active_organisations: officialTotal,
  mapped_organisations: mappedCount,
  national_clusters: nationalRows.length,
  represented_by_clusters: nationalRows.reduce(
    (sum, row) => sum + Number(row.member_count),
    0
  ),
  dgu_exact_building_points: dguExactCount,
  exact_registry_navigation_sample: exactRegistryOnly.udr_id,
  approximate_registry_navigation_sample: approximateRegistryOnly.udr_id,
  hidden_location_sample: hiddenDirectory?.udr_id ?? null,
  direct_table_access: "denied",
}, null, 2));
