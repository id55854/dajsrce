// Mirror the official registers of organisations that are not associations
// into official_organisations (20261005120000), so a Caritas, a parish, a
// religious community's charity, a foundation or a social-care institution
// can claim its profile the way an association does with its UDR_ID.
//
// Sources (all official; the first four under Otvorena dozvola):
//   - Evidencija pravnih osoba Katoličke Crkve u RH (data.gov.hr, CTS CSV)
//   - Evidencija vjerskih zajednica u RH, with organisational units (data.gov.hr, CSV)
//   - Registar zaklada RH (data.gov.hr, CTS CSV)
//   - MROSP Registar pružatelja socijalnih usluga (mrosp.gov.hr/registar/registar.json)
//   - RNO, Registar neprofitnih organizacija (banovac.mfin.hr/rnoprt/Export), read
//     only for the number and published contacts of organisations already
//     found above; nothing else from it is kept.
//
// Usage:
//   node scripts/sync-official-organisations.mjs --dry-run [--output rows.json]
//   node scripts/sync-official-organisations.mjs
//   node scripts/sync-official-organisations.mjs --source-dir C:\downloads   # files saved beforehand
//
// --source-dir expects epokc.csv, evz.csv, evz-units.csv, zaklade.csv,
// mrosp.json and rno.csv (the RNO "CSV izvoz").

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  fromCatholicRegister,
  fromFoundations,
  fromReligiousCommunities,
  fromSocialProviders,
  mergeOrganisations,
  parseCsvObjects,
  parseRnoExport,
} from "./lib/official-organisations.mjs";

const USER_AGENT =
  process.env.REGISTRY_USER_AGENT || "DajSrce/1.0 (+https://dajsrce.hr; official-organisations-sync)";
const MAX_SOURCE_BYTES = 80 * 1024 * 1024;
const BATCH_SIZE = 500;

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const argValue = (name) => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : null;
};
const outputPath = argValue("--output");
const sourceDir = argValue("--source-dir");

// data.gov.hr datasets and the resource each one is read from.
const CKAN = {
  epokc: {
    dataset: "evidencija-pravnih-osoba-katolicke-crkve-u-republici-hrvatskoj",
    pick: (resource) => resource.format === "CSV" && /- CTS$/.test(resource.name),
  },
  evz: {
    dataset: "evidencija-vjerskih-zajednica-u-republici-hrvatskoj",
    pick: (resource) => resource.format === "CSV" && /- CTS$/.test(resource.name),
  },
  evzUnits: {
    dataset: "evidencija-vjerskih-zajednica-u-republici-hrvatskoj",
    pick: (resource) => resource.format === "CSV" && /Organizacijski oblici/i.test(resource.name),
  },
  zaklade: {
    dataset: "registar-zaklada-republike-hrvatske",
    pick: (resource) => resource.format === "CSV" && /- CTS$/.test(resource.name),
  },
};
const MROSP_URL = "https://mrosp.gov.hr/registar/registar.json";
const RNO_URL = "https://banovac.mfin.hr/rnoprt/Export";
const OFFICIAL_HOSTS = ["data.gov.hr", "mrosp.gov.hr", "banovac.mfin.hr"];

// A register that suddenly shrinks is a broken download, not a mass
// deregistration. Well under the 2026-09-30 sizes (2,104 / 54 / 863 / 352 /
// 1,422 active rows).
const MINIMUM_ROWS = { epokc: 1500, evz: 500, zaklade: 200, mrosp: 250 };

function officialUrl(value) {
  const url = new URL(value);
  return (
    url.protocol === "https:" &&
    OFFICIAL_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
  );
}

async function download(url, accept) {
  if (!officialUrl(url)) throw new Error(`Refusing a non-official source: ${url}`);
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5 * 60_000);
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: accept },
        redirect: "follow",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      if (!officialUrl(response.url)) throw new Error(`Redirect left the official host: ${response.url}`);
      const declared = Number(response.headers.get("content-length") || 0);
      if (declared > MAX_SOURCE_BYTES) throw new Error(`${url} exceeds ${MAX_SOURCE_BYTES} bytes`);
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length > MAX_SOURCE_BYTES) throw new Error(`${url} exceeds ${MAX_SOURCE_BYTES} bytes`);
      return body;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 3_000));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

async function ckanResource({ dataset, pick }) {
  const body = await download(
    `https://data.gov.hr/ckan/api/3/action/package_show?id=${encodeURIComponent(dataset)}`,
    "application/json"
  );
  const meta = JSON.parse(body.toString("utf8"));
  const resource = meta?.result?.resources?.find(pick);
  if (!resource?.url) throw new Error(`No matching resource in ${dataset}`);
  return { url: resource.url, modified: resource.last_modified || resource.metadata_modified || null };
}

async function loadSources() {
  if (sourceDir) {
    const read = (name) => fs.readFileSync(path.join(sourceDir, name));
    return {
      epokc: read("epokc.csv").toString("utf8"),
      evz: read("evz.csv").toString("utf8"),
      evzUnits: read("evz-units.csv").toString("utf8"),
      zaklade: read("zaklade.csv").toString("utf8"),
      mrosp: read("mrosp.json").toString("utf8"),
      rno: read("rno.csv"),
      meta: { source_dir: path.resolve(sourceDir) },
    };
  }
  const meta = {};
  const texts = {};
  for (const [name, spec] of Object.entries(CKAN)) {
    const resource = await ckanResource(spec);
    meta[name] = resource;
    texts[name] = (await download(resource.url, "text/csv")).toString("utf8");
  }
  meta.mrosp = { url: MROSP_URL };
  texts.mrosp = (await download(MROSP_URL, "application/json")).toString("utf8");
  meta.rno = { url: RNO_URL };
  texts.rno = await download(RNO_URL, "text/csv, application/octet-stream");
  return { ...texts, meta };
}

const sources = await loadSources();
const candidates = {
  epokc: fromCatholicRegister(parseCsvObjects(sources.epokc)),
  evz: fromReligiousCommunities(parseCsvObjects(sources.evz), parseCsvObjects(sources.evzUnits)),
  zaklade: fromFoundations(parseCsvObjects(sources.zaklade)),
  mrosp: fromSocialProviders(JSON.parse(sources.mrosp)),
};
for (const [name, minimum] of Object.entries(MINIMUM_ROWS)) {
  if (candidates[name].length < minimum) {
    throw new Error(`${name} yielded ${candidates[name].length} active rows (minimum ${minimum}); refusing to sync`);
  }
}
const all = Object.values(candidates).flat();
const oibs = new Set(all.map((candidate) => candidate.oib).filter(Boolean));
const rno = parseRnoExport(sources.rno, oibs);
const rows = mergeOrganisations(all, rno);

const summary = {
  candidates: Object.fromEntries(Object.entries(candidates).map(([name, list]) => [name, list.length])),
  rno_matches: rno.size,
  organisations: rows.length,
  with_email: rows.filter((row) => row.email).length,
  social_providers: rows.filter((row) => row.social_provider).length,
};
console.log(JSON.stringify(summary, null, 2));
if (outputPath) fs.writeFileSync(outputPath, JSON.stringify(rows, null, 2));

if (DRY_RUN) {
  console.log("Dry run: nothing written.");
  process.exit(0);
}

const { supabaseAdmin } = await import("./lib/supabase-admin.mjs");

async function rpc(name, params) {
  const { data, error } = await supabaseAdmin.rpc(name, params);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}

const syncId = await rpc("begin_official_organisations_sync", {
  p_sources: { ...sources.meta, summary },
});
try {
  let accepted = 0;
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    accepted += await rpc("upsert_official_organisations_batch", {
      p_sync_id: syncId,
      p_rows: rows.slice(offset, offset + BATCH_SIZE),
    });
  }
  const result = await rpc("finish_official_organisations_sync", {
    p_sync_id: syncId,
    p_expected_rows: accepted,
  });
  console.log(
    `Stored ${accepted} organisations (${rows.length - accepted} left out as registered associations); ${result.rows_deactivated} deactivated.`
  );
} catch (error) {
  await supabaseAdmin.rpc("fail_official_organisations_sync", { p_sync_id: syncId });
  throw error;
}
