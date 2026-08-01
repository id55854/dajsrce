#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const buildDir = resolve(process.cwd(), ".next");
const appManifest = JSON.parse(
  await readFile(resolve(buildDir, "app-build-manifest.json"), "utf8")
);
const loadableManifest = JSON.parse(
  await readFile(resolve(buildDir, "react-loadable-manifest.json"), "utf8")
);

const mapEntry = appManifest.pages?.["/map/page"];
const rootEntry = appManifest.pages?.["/page"] ?? [];
if (!Array.isArray(mapEntry)) {
  throw new Error("The production build does not contain /map/page");
}

const frameworkFiles = new Set(mapEntry.filter((file) => rootEntry.includes(file)));
const mapFiles = new Set(mapEntry.filter((file) => !frameworkFiles.has(file)));
for (const [key, value] of Object.entries(loadableManifest)) {
  if (key.includes("app\\map\\page.tsx") || key.includes("app/map/page.tsx")) {
    for (const file of value.files ?? []) mapFiles.add(file);
  }
}

const measured = [];
for (const file of [...mapFiles].sort()) {
  const bytes = (await stat(resolve(buildDir, file))).size;
  measured.push({ file, bytes });
}

const totalRawBytes = measured.reduce((sum, item) => sum + item.bytes, 0);
const maximumRawBytes = 320 * 1024;
const result = {
  route: "/map",
  budget: { maximumRawBytes, excludesSharedFramework: true },
  result: { totalRawBytes, passed: totalRawBytes <= maximumRawBytes },
  files: measured,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.result.passed) process.exitCode = 1;
