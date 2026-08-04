// Discover and mirror the complete official Croatian Associations Register.
// CKAN package metadata is authoritative; the CTS CSV is streamed to a private
// temporary directory and handed to the resumable staged importer.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { spawn } from "node:child_process";
import { supabaseAdmin } from "./lib/supabase-admin.mjs";

const DATASET_ID = "registar-udruga";
const PACKAGE_API = `https://data.gov.hr/ckan/api/3/action/package_show?id=${DATASET_ID}`;
const USER_AGENT = process.env.REGISTRY_USER_AGENT ||
  "DajSrce/1.0 (+https://dajsrce.vercel.app; official-registry-sync)";
const MAX_SOURCE_BYTES = 300 * 1024 * 1024;
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const argVal = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};

function isOfficialDataUrl(value) {
  const parsed = new URL(value);
  return parsed.protocol === "https:" &&
    (parsed.hostname === "data.gov.hr" || parsed.hostname.endsWith(".data.gov.hr"));
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json, text/csv;q=0.9" },
      redirect: "follow",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

const metadataResponse = await fetchWithTimeout(PACKAGE_API, 30_000);
if (!metadataResponse.ok) {
  throw new Error(`CKAN package metadata HTTP ${metadataResponse.status}`);
}
const metadata = await metadataResponse.json();
if (!metadata?.success || !metadata?.result) {
  throw new Error("CKAN package metadata did not contain a successful result");
}

const resource = metadata.result.resources?.find((item) =>
  item?.format?.toUpperCase() === "CSV" && /\s-\sCTS$/i.test(item?.name || "")
);
if (!resource?.id || !resource?.url) {
  throw new Error("Official CTS CSV resource was not found in CKAN package metadata");
}
const resourceUrl = new URL(resource.url);
if (!isOfficialDataUrl(resourceUrl)) {
  throw new Error(`Official CTS resource URL is outside data.gov.hr: ${resourceUrl.origin}`);
}

const metadataModified = resource.last_modified || metadata.result.metadata_modified;
if (!metadataModified) throw new Error("Official source has no modification timestamp");

let alreadyComplete = false;
if (!flag("--force") && !flag("--dry-run")) {
  const { data: existing, error } = await supabaseAdmin
    .from("registry_import_batches")
    .select("id, source_rows, completed_at")
    .eq("source_resource_id", resource.id)
    .eq("source_metadata_modified", metadataModified)
    .eq("status", "completed")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (existing) {
    console.log(
      `Official registry snapshot ${metadataModified} is already complete ` +
      `(${Number(existing.source_rows || 0).toLocaleString()} rows, batch ${existing.id}).`
    );
    alreadyComplete = true;
  }
}

if (!alreadyComplete) {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "dajsrce-registry-"));
  const csvPath = path.join(tempDirectory, `registar-udruga-${resource.id}.csv`);
  let sourceBytes = 0;

  try {
    console.log(`Official dataset modified: ${metadataModified}`);
    console.log(`Downloading CTS CSV resource ${resource.id}...`);
    const sourceResponse = await fetchWithTimeout(resourceUrl, 10 * 60_000);
    if (!sourceResponse.ok || !sourceResponse.body) {
      throw new Error(`Official CTS CSV HTTP ${sourceResponse.status}`);
    }
    if (!isOfficialDataUrl(sourceResponse.url)) {
      throw new Error(`Official CTS redirect left data.gov.hr: ${new URL(sourceResponse.url).origin}`);
    }
    const declaredLength = Number(sourceResponse.headers.get("content-length") || 0);
    if (declaredLength > MAX_SOURCE_BYTES) {
      throw new Error(`Official source exceeds ${MAX_SOURCE_BYTES} bytes`);
    }

    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        sourceBytes += chunk.length;
        if (sourceBytes > MAX_SOURCE_BYTES) {
          callback(new Error(`Official source exceeded ${MAX_SOURCE_BYTES} bytes while streaming`));
          return;
        }
        callback(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(sourceResponse.body),
      meter,
      fs.createWriteStream(csvPath, { flags: "wx", mode: 0o600 })
    );
    console.log(`Downloaded ${sourceBytes.toLocaleString()} bytes.`);

    const importerArgs = [
      path.join(process.cwd(), "scripts", "import-registry.mjs"),
      "--csv",
      csvPath,
      "--batch-size",
      argVal("--batch-size", "500"),
    ];
    if (flag("--dry-run")) importerArgs.push("--dry-run");

    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, importerArgs, {
        cwd: process.cwd(),
        env: {
          ...process.env,
          REGISTRY_SOURCE_DATASET_ID: metadata.result.id,
          REGISTRY_SOURCE_RESOURCE_ID: resource.id,
          REGISTRY_SOURCE_URL: resourceUrl.href,
          REGISTRY_SOURCE_METADATA_MODIFIED: metadataModified,
          REGISTRY_SOURCE_BYTES: String(sourceBytes),
        },
        stdio: "inherit",
      });
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    });
    if (exitCode !== 0) throw new Error(`Registry importer exited with code ${exitCode}`);
  } finally {
    if (flag("--keep-file")) {
      console.log(`Kept source file: ${csvPath}`);
    } else {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  }
}
