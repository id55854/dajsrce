// Load city district boundaries and assign every published row to one.
//
// Source: OpenStreetMap relations tagged boundary=administrative,
// admin_level=9 inside Grad Zagreb - the 17 official gradske cetvrti. The
// polygons are committed to data/zagreb-city-districts.geojson so this import
// is reproducible offline and reviewable in a diff; re-fetching them is a
// deliberate act, not a side effect of running the loader.
//
// (c) OpenStreetMap contributors, ODbL 1.0.
//
//   node scripts/import-city-districts.mjs --dry-run
//   node scripts/import-city-districts.mjs
//
// Safe to re-run: boundaries upsert on (city, name) and the backfill only
// touches rows whose district disagrees with the polygon they fall in.

import fs from "node:fs";
import path from "node:path";
import { supabaseAdmin } from "./lib/supabase-admin.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const argVal = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};

const DRY_RUN = flag("--dry-run");
const geojsonPath = path.resolve(
  process.cwd(),
  argVal("--geojson", "data/zagreb-city-districts.geojson")
);

if (!fs.existsSync(geojsonPath)) {
  console.error(`Boundary file not found: ${geojsonPath}`);
  process.exit(1);
}

const collection = JSON.parse(fs.readFileSync(geojsonPath, "utf8"));
if (collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
  console.error("Expected a GeoJSON FeatureCollection.");
  process.exit(1);
}

// Every feature must be an area with a city and a name, or the point-in-polygon
// assignment silently loses a district and its rows fall back to the city tier.
const districts = [];
for (const feature of collection.features) {
  const name = feature?.properties?.name;
  const city = feature?.properties?.city;
  const geometryType = feature?.geometry?.type;
  if (!name || !city) {
    console.error(`Feature missing city/name: ${JSON.stringify(feature?.properties)}`);
    process.exit(1);
  }
  if (geometryType !== "MultiPolygon" && geometryType !== "Polygon") {
    console.error(`${city}/${name}: expected a (Multi)Polygon, got ${geometryType}`);
    process.exit(1);
  }
  districts.push({
    city,
    name,
    osm_relation: feature.properties.osm_relation ?? null,
    // PostGIS reads GeoJSON directly, which keeps the ring order and hole
    // semantics the source published rather than a WKT round-trip of ours.
    geometry:
      geometryType === "Polygon"
        ? { type: "MultiPolygon", coordinates: [feature.geometry.coordinates] }
        : feature.geometry,
  });
}

console.log(`${districts.length} districts in ${path.relative(process.cwd(), geojsonPath)}`);
if (collection.attribution) console.log(`Attribution: ${collection.attribution}`);

if (DRY_RUN) {
  for (const district of districts) {
    const rings = district.geometry.coordinates.reduce((sum, poly) => sum + poly.length, 0);
    console.log(`  ${district.city} / ${district.name} (${rings} rings)`);
  }
  console.log("\n[DRY RUN] No rows written.");
  process.exit(0);
}

const { data: loaded, error: loadError } = await supabaseAdmin.rpc(
  "upsert_city_districts",
  { p_districts: districts }
);
if (loadError) {
  console.error(`Boundary upsert failed: ${loadError.message ?? JSON.stringify(loadError)}`);
  process.exit(1);
}
console.log(`Boundaries stored: ${JSON.stringify(loaded)}`);

// Bounded so a slow shared instance cannot time the whole run out on one
// statement; the RPC reports completion rather than us guessing a row count.
let totalUpdated = 0;
let limit = 2000;
for (;;) {
  const { data, error } = await supabaseAdmin.rpc("backfill_registry_districts_batch", {
    p_limit: limit,
  });
  if (error?.code === "57014" && limit > 100) {
    limit = Math.max(100, Math.floor(limit / 2));
    console.warn(`  backfill timed out; retrying with batch size ${limit}`);
    continue;
  }
  if (error) {
    console.error(`District backfill failed: ${error.message ?? JSON.stringify(error)}`);
    process.exit(1);
  }
  totalUpdated += data.updated;
  if (data.updated > 0) console.log(`  assigned ${data.updated} rows (${totalUpdated} total)`);
  if (data.complete) break;
}

console.log(`\nDistricts assigned to ${totalUpdated} directory rows.`);
