import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { TaxCategory } from "@/lib/types";

export type ReceiptLineItem = {
  pledgeId: string;
  dateIso: string;
  institutionName: string;
  institutionOib: string | null;
  taxCategory: TaxCategory | string;
  amountEur: number;
  ackKind: "manual" | "auto";
};

export type ReceiptCompanyBlock = {
  legal_name: string;
  oib: string | null;
  address: string | null;
  city: string | null;
  brand_primary_hex?: string | null;
};

function hexToRgb(hex: string | null | undefined): { r: number; g: number; b: number } {
  if (!hex || !/^#[0-9A-Fa-f]{6}$/.test(hex)) {
    return { r: 0.93, g: 0.27, b: 0.27 };
  }
  return {
    r: parseInt(hex.slice(1, 3), 16) / 255,
    g: parseInt(hex.slice(3, 5), 16) / 255,
    b: parseInt(hex.slice(5, 7), 16) / 255,
  };
}

/** Build a simple ASCII-safe fiscal-year donation receipt PDF. */
export async function renderDonationReceiptPdf(input: {
  company: ReceiptCompanyBlock;
  fiscalYear: number;
  ceilingPct: number;
  consumedPct: number;
  lines: ReceiptLineItem[];
  totalEur: number;
  version: number;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const accent = hexToRgb(input.company.brand_primary_hex);

  let y = height - 48;
  const left = 48;
  const right = width - 48;

  page.drawText("DajSrce — donation receipt (informational)", {
    x: left,
    y,
    size: 11,
    font: fontBold,
    color: rgb(accent.r, accent.g, accent.b),
  });
  y -= 22;
  page.drawText(`Fiscal year: ${input.fiscalYear} · Version: ${input.version}`, {
    x: left,
    y,
    size: 10,
    font,
    color: rgb(0.2, 0.2, 0.2),
  });
  y -= 28;

  page.drawText("Donor (company)", { x: left, y, size: 10, font: fontBold });
  y -= 14;
  page.drawText(input.company.legal_name, { x: left, y, size: 10, font });
  y -= 12;
  if (input.company.oib) {
    page.drawText(`OIB: ${input.company.oib}`, { x: left, y, size: 9, font });
    y -= 12;
  }
  const addr = [input.company.address, input.company.city].filter(Boolean).join(", ");
  if (addr) {
    page.drawText(addr, { x: left, y, size: 9, font });
    y -= 12;
  }
  y -= 16;

  page.drawText("Deduction ceiling (Profit Tax Act)", { x: left, y, size: 10, font: fontBold });
  y -= 14;
  page.drawText(
    `Ceiling: ${input.ceilingPct.toFixed(2)}% of prior-year revenue · Consumed (estimated): ${input.consumedPct.toFixed(2)}%`,
    { x: left, y, size: 9, font }
  );
  y -= 22;

  page.drawText("Line items (acknowledged deliveries)", { x: left, y, size: 10, font: fontBold });
  y -= 16;

  const colDate = left;
  const colInst = left + 72;
  const colCat = left + 220;
  const colAmt = right - 72;
  page.drawText("Date", { x: colDate, y, size: 8, font: fontBold });
  page.drawText("Beneficiary", { x: colInst, y, size: 8, font: fontBold });
  page.drawText("Category", { x: colCat, y, size: 8, font: fontBold });
  page.drawText("EUR", { x: colAmt, y, size: 8, font: fontBold });
  y -= 12;

  for (const line of input.lines) {
    if (y < 120) break;
    const d = line.dateIso.slice(0, 10);
    const inst = line.institutionOib
      ? `${line.institutionName} (OIB ${line.institutionOib})`
      : line.institutionName;
    const star = line.ackKind === "auto" ? "*" : "";
    page.drawText(d + star, { x: colDate, y, size: 8, font });
    page.drawText(inst.slice(0, 42), { x: colInst, y, size: 8, font });
    page.drawText(String(line.taxCategory).slice(0, 14), { x: colCat, y, size: 8, font });
    page.drawText(line.amountEur.toFixed(2), { x: colAmt, y, size: 8, font });
    y -= 11;
  }

  y -= 8;
  page.drawText(`Total EUR: ${input.totalEur.toFixed(2)}`, {
    x: colAmt - 40,
    y,
    size: 10,
    font: fontBold,
  });
  y -= 24;
  page.drawText(
    "* Auto-acknowledged by DajSrce after the statutory waiting period without NGO response.",
    { x: left, y, size: 8, font, color: rgb(0.35, 0.35, 0.35), maxWidth: right - left }
  );
  y -= 36;
  page.drawText("This document is for your records. Consult your tax advisor for deductibility.", {
    x: left,
    y,
    size: 8,
    font,
    color: rgb(0.4, 0.4, 0.4),
    maxWidth: right - left,
  });

  return doc.save();
}

export function buildReceiptManifestXml(input: {
  companyId: string;
  fiscalYear: number;
  version: number;
  generatedAtIso: string;
  ceilingPct: number;
  consumedPct: number;
  totalEur: number;
  lines: ReceiptLineItem[];
}): string {
  const linesXml = input.lines
    .map(
      (l) => `  <line pledge_id="${escapeXml(l.pledgeId)}" date="${escapeXml(l.dateIso)}" institution="${escapeXml(l.institutionName)}" oib="${escapeXml(l.institutionOib ?? "")}" category="${escapeXml(String(l.taxCategory))}" amount_eur="${l.amountEur.toFixed(2)}" acknowledgement="${l.ackKind}" />`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<donation_receipt_manifest xmlns="https://dajsrce.app/ns/receipt/1"
  company_id="${escapeXml(input.companyId)}"
  fiscal_year="${input.fiscalYear}"
  version="${input.version}"
  generated_at="${escapeXml(input.generatedAtIso)}"
  ceiling_pct="${input.ceilingPct.toFixed(2)}"
  consumed_pct_estimate="${input.consumedPct.toFixed(4)}"
  total_amount_eur="${input.totalEur.toFixed(2)}">
${linesXml}
</donation_receipt_manifest>
`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
