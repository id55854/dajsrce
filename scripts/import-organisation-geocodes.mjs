// Apply the DGU building points found by
//   node scripts/audit-dgu-address-match.mjs --organisations --archive <zip> --output matches.jsonl
// to official_organisations. Only a row whose address still equals the one
// the audit matched takes the point (apply_official_organisation_geocodes).
//
// Usage: node scripts/import-organisation-geocodes.mjs --input matches.jsonl

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { supabaseAdmin } from "./lib/supabase-admin.mjs";

const args = process.argv.slice(2);
const index = args.indexOf("--input");
const inputPath = index >= 0 ? args[index + 1] : null;
if (!inputPath) throw new Error("--input is required");

const rows = fs
  .readFileSync(path.resolve(inputPath), "utf8")
  .split(/\r?\n/)
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line))
  .filter((row) => row.organisation_id && row.source === "dgu_inspire_addresses")
  .map((row) => ({
    organisation_id: row.organisation_id,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    dgu_address_id: row.dgu_address_id,
  }));
if (rows.length === 0) throw new Error(`No organisation matches in ${inputPath}`);

let updated = 0;
for (let offset = 0; offset < rows.length; offset += 500) {
  const { data, error } = await supabaseAdmin.rpc("apply_official_organisation_geocodes", {
    p_rows: rows.slice(offset, offset + 500),
  });
  if (error) throw new Error(`apply_official_organisation_geocodes: ${error.message}`);
  updated += data;
}
console.log(`${updated} of ${rows.length} organisation seats took their DGU point.`);
