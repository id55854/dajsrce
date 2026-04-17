import { createHash } from "node:crypto";
import JSZip from "jszip";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { DatapointResult } from "@/lib/frameworks/types";

function sha256(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

async function datapointEvidencePdf(datapointId: string, refs: DatapointResult["evidence"]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 420]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let y = 380;
  page.drawText(`Evidence summary: ${datapointId}`, { x: 40, y, size: 12, font, color: rgb(0.1, 0.1, 0.1) });
  y -= 24;
  for (const ref of refs) {
    const line = `${ref.kind}: ${ref.ids.length} id(s)`;
    page.drawText(line.slice(0, 90), { x: 40, y, size: 10, font, color: rgb(0.2, 0.2, 0.2) });
    y -= 14;
    if (y < 40) break;
  }
  return doc.save();
}

async function narrativePdf(params: {
  companyName: string;
  framework: string;
  periodStart: string;
  periodEnd: string;
  results: DatapointResult[];
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let y = 800;
  page.drawText("DajSrce — ESG export summary", { x: 48, y, size: 16, font: bold, color: rgb(0.8, 0.2, 0.2) });
  y -= 28;
  page.drawText(params.companyName, { x: 48, y, size: 12, font: bold });
  y -= 20;
  page.drawText(`Framework: ${params.framework}`, { x: 48, y, size: 11, font });
  y -= 16;
  page.drawText(`Period: ${params.periodStart} — ${params.periodEnd}`, { x: 48, y, size: 11, font });
  y -= 28;
  page.drawText("Datapoints", { x: 48, y, size: 12, font: bold });
  y -= 18;
  for (const r of params.results) {
    const val =
      r.value === null || r.value === undefined
        ? "—"
        : typeof r.value === "number"
          ? String(r.value)
          : String(r.value);
    const line = `• ${r.id}: ${val} ${r.unit}${r.skipReason ? ` (${r.skipReason})` : ""} — evidence rows: ${r.evidence.reduce((n, e) => n + e.ids.length, 0)}`;
    page.drawText(line.slice(0, 95), { x: 52, y, size: 9, font });
    y -= 12;
    if (y < 60) break;
  }
  return doc.save();
}

export type PackResult = {
  zipBytes: Uint8Array;
  manifest: Record<string, unknown>;
};

export async function buildEsgExportZip(params: {
  companyName: string;
  framework: string;
  periodStart: string;
  periodEnd: string;
  results: DatapointResult[];
}): Promise<PackResult> {
  const zip = new JSZip();
  const generatedAt = new Date().toISOString();

  const dataJson = JSON.stringify(
    {
      generated_at: generatedAt,
      framework: params.framework,
      period_start: params.periodStart,
      period_end: params.periodEnd,
      datapoints: params.results,
    },
    null,
    2
  );

  const csvLines = [
    "id,label_en,value,unit,skip_reason,evidence_total_ids",
    ...params.results.map((r) => {
      const ev = r.evidence.reduce((n, e) => n + e.ids.length, 0);
      const skip = (r.skipReason ?? "").replaceAll(",", ";");
      return [
        r.id,
        `"${r.label_en.replaceAll('"', "'")}"`,
        r.value === null || r.value === undefined ? "" : String(r.value),
        r.unit,
        `"${skip}"`,
        String(ev),
      ].join(",");
    }),
  ];
  const dataCsv = csvLines.join("\n");

  const narrativeBytes = await narrativePdf(params);
  zip.file("data.json", dataJson);
  zip.file("data.csv", dataCsv);
  zip.file("narrative.pdf", Buffer.from(narrativeBytes));

  const fileHashes: Record<string, string> = {};
  const addHash = (path: string, body: Buffer) => {
    fileHashes[path] = sha256(body);
  };

  addHash("data.json", Buffer.from(dataJson));
  addHash("data.csv", Buffer.from(dataCsv, "utf8"));
  addHash("narrative.pdf", Buffer.from(narrativeBytes));

  for (const r of params.results) {
    if (!r.evidence.length) continue;
    const pdf = await datapointEvidencePdf(r.id, r.evidence);
    const p = `evidence/${r.id}/summary.pdf`;
    zip.file(p, Buffer.from(pdf));
    addHash(p, Buffer.from(pdf));
  }

  const manifest = {
    generated_at: generatedAt,
    framework: params.framework,
    period_start: params.periodStart,
    period_end: params.periodEnd,
    files: fileHashes,
  };
  const manifestStr = JSON.stringify(manifest, null, 2);
  zip.file("manifest.json", manifestStr);
  addHash("manifest.json", Buffer.from(manifestStr));

  const zipBytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return { zipBytes, manifest };
}
