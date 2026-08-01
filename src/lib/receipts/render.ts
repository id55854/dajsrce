import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";
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

const FONT_FILES_DIRECTORY = path.join(
  process.cwd(),
  "node_modules",
  "@expo-google-fonts",
  "noto-sans"
);
const REGULAR_FONT_PATH = path.join(
  FONT_FILES_DIRECTORY,
  "400Regular",
  "NotoSans_400Regular.ttf"
);
const BOLD_FONT_PATH = path.join(
  FONT_FILES_DIRECTORY,
  "700Bold",
  "NotoSans_700Bold.ttf"
);
const PAGE_SIZE: [number, number] = [595.28, 841.89];
const LEFT = 44;
const RIGHT = 551;
const CONTENT_WIDTH = RIGHT - LEFT;
const BOTTOM_CONTENT = 72;

function hexToRgb(hex: string | null | undefined): { r: number; g: number; b: number } {
  if (!hex || !/^#[0-9A-Fa-f]{6}$/.test(hex)) {
    return { r: 0.93, g: 0.27, b: 0.27 };
  }
  return {
    r: Number.parseInt(hex.slice(1, 3), 16) / 255,
    g: Number.parseInt(hex.slice(3, 5), 16) / 255,
    b: Number.parseInt(hex.slice(5, 7), 16) / 255,
  };
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .flatMap((word) => {
      if (font.widthOfTextAtSize(word, size) <= maxWidth) return [word];
      const chunks: string[] = [];
      let current = "";
      for (const character of word) {
        const candidate = current + character;
        if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
          chunks.push(current);
          current = character;
        } else {
          current = candidate;
        }
      }
      if (current) chunks.push(current);
      return chunks;
    });
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = words[0];
  for (const word of words.slice(1)) {
    const candidate = `${current} ${word}`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines;
}

function drawWrapped(
  page: PDFPage,
  text: string,
  options: {
    x: number;
    y: number;
    width: number;
    font: PDFFont;
    size: number;
    lineHeight?: number;
    color?: ReturnType<typeof rgb>;
  }
): number {
  const lineHeight = options.lineHeight ?? options.size + 3;
  const lines = wrapText(text, options.font, options.size, options.width);
  lines.forEach((line, index) => {
    page.drawText(line, {
      x: options.x,
      y: options.y - index * lineHeight,
      size: options.size,
      font: options.font,
      color: options.color,
    });
  });
  return options.y - lines.length * lineHeight;
}

function drawTableHeader(page: PDFPage, y: number, fontBold: PDFFont): number {
  page.drawRectangle({
    x: LEFT,
    y: y - 4,
    width: CONTENT_WIDTH,
    height: 17,
    color: rgb(0.95, 0.95, 0.95),
  });
  page.drawText("Datum", { x: LEFT + 3, y, size: 7.5, font: fontBold });
  page.drawText("Primatelj", { x: LEFT + 71, y, size: 7.5, font: fontBold });
  page.drawText("Kategorija", { x: LEFT + 317, y, size: 7.5, font: fontBold });
  page.drawText("EUR", { x: RIGHT - 57, y, size: 7.5, font: fontBold });
  return y - 17;
}

function assertReceiptInput(lines: ReceiptLineItem[], expectedTotal: number): void {
  const ids = new Set<string>();
  let cents = 0;
  for (const line of lines) {
    if (!line.pledgeId || ids.has(line.pledgeId)) {
      throw new Error(`Duplicate or missing pledge in receipt: ${line.pledgeId}`);
    }
    ids.add(line.pledgeId);
    if (!Number.isFinite(line.amountEur) || line.amountEur <= 0) {
      throw new Error(`Invalid amount for pledge ${line.pledgeId}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}/.test(line.dateIso)) {
      throw new Error(`Invalid acknowledgement date for pledge ${line.pledgeId}`);
    }
    cents += Math.round(line.amountEur * 100);
  }
  if (cents !== Math.round(expectedTotal * 100)) {
    throw new Error("Receipt total does not reconcile with line items");
  }
}

/** Render a reconciled, Unicode-capable, multi-page donation receipt PDF. */
export async function renderDonationReceiptPdf(input: {
  company: ReceiptCompanyBlock;
  fiscalYear: number;
  ceilingPct: number;
  consumedPct: number;
  lines: ReceiptLineItem[];
  totalEur: number;
  version: number;
}): Promise<Uint8Array> {
  assertReceiptInput(input.lines, input.totalEur);
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [regularBytes, boldBytes] = await Promise.all([
    readFile(REGULAR_FONT_PATH),
    readFile(BOLD_FONT_PATH),
  ]);
  // pdf-lib/fontkit subsetting corrupts CID mappings for this static TTF in
  // some PDF readers. Embed the complete fonts so Croatian text is portable.
  const font = await doc.embedFont(regularBytes, { subset: false });
  const fontBold = await doc.embedFont(boldBytes, { subset: false });
  const accent = hexToRgb(input.company.brand_primary_hex);
  let page = doc.addPage(PAGE_SIZE);
  let y = page.getHeight() - 46;

  page.drawText("DajSrce — evidencija donacija", {
    x: LEFT,
    y,
    size: 12,
    font: fontBold,
    color: rgb(accent.r, accent.g, accent.b),
  });
  y -= 22;
  page.drawText(`Fiskalna godina: ${input.fiscalYear} · Verzija: ${input.version}`, {
    x: LEFT,
    y,
    size: 9,
    font,
    color: rgb(0.2, 0.2, 0.2),
  });
  y -= 27;

  page.drawText("Donator (tvrtka)", { x: LEFT, y, size: 10, font: fontBold });
  y -= 15;
  y = drawWrapped(page, input.company.legal_name, {
    x: LEFT,
    y,
    width: CONTENT_WIDTH,
    size: 9.5,
    font,
  });
  if (input.company.oib) {
    page.drawText(`OIB: ${input.company.oib}`, { x: LEFT, y, size: 8.5, font });
    y -= 13;
  }
  const address = [input.company.address, input.company.city].filter(Boolean).join(", ");
  if (address) {
    y = drawWrapped(page, address, { x: LEFT, y, width: CONTENT_WIDTH, size: 8.5, font });
  }
  y -= 12;

  page.drawText("Informativni pregled poreznog praga", { x: LEFT, y, size: 10, font: fontBold });
  y -= 15;
  y = drawWrapped(
    page,
    `Konfigurirani prag: ${input.ceilingPct.toFixed(2)}% prihoda prethodne godine · Procijenjena iskorištenost: ${input.consumedPct.toFixed(2)}%`,
    { x: LEFT, y, width: CONTENT_WIDTH, size: 8.5, font }
  );
  y -= 12;
  page.drawText("Stavke s potvrđenom isporukom", { x: LEFT, y, size: 10, font: fontBold });
  y -= 18;
  y = drawTableHeader(page, y, fontBold);

  const newContinuationPage = (): void => {
    page = doc.addPage(PAGE_SIZE);
    y = page.getHeight() - 48;
    page.drawText(`DajSrce — evidencija donacija ${input.fiscalYear} (nastavak)`, {
      x: LEFT,
      y,
      size: 9.5,
      font: fontBold,
      color: rgb(accent.r, accent.g, accent.b),
    });
    y -= 24;
    y = drawTableHeader(page, y, fontBold);
  };

  for (const line of input.lines) {
    const beneficiary = line.institutionOib
      ? `${line.institutionName} (OIB ${line.institutionOib})`
      : line.institutionName;
    const beneficiaryLines = wrapText(beneficiary, font, 7.5, 238);
    const categoryLines = wrapText(String(line.taxCategory), font, 7.5, 100);
    const rowLines = Math.max(1, beneficiaryLines.length, categoryLines.length);
    const rowHeight = Math.max(14, rowLines * 10 + 4);
    if (y - rowHeight < BOTTOM_CONTENT) newContinuationPage();

    const date = `${line.dateIso.slice(0, 10)}${line.ackKind === "auto" ? "*" : ""}`;
    page.drawText(date, { x: LEFT + 3, y, size: 7.5, font });
    beneficiaryLines.forEach((value, index) => {
      page.drawText(value, { x: LEFT + 71, y: y - index * 10, size: 7.5, font });
    });
    categoryLines.forEach((value, index) => {
      page.drawText(value, { x: LEFT + 317, y: y - index * 10, size: 7.5, font });
    });
    page.drawText(line.amountEur.toFixed(2), { x: RIGHT - 57, y, size: 7.5, font });
    page.drawLine({
      start: { x: LEFT, y: y - rowHeight + 7 },
      end: { x: RIGHT, y: y - rowHeight + 7 },
      thickness: 0.3,
      color: rgb(0.85, 0.85, 0.85),
    });
    y -= rowHeight;
  }

  if (y < 150) {
    page = doc.addPage(PAGE_SIZE);
    y = page.getHeight() - 54;
  }
  page.drawText(`Ukupno EUR: ${input.totalEur.toFixed(2)}`, {
    x: RIGHT - 145,
    y,
    size: 10,
    font: fontBold,
  });
  y -= 28;
  y = drawWrapped(
    page,
    "* Automatska potvrda znači da je DajSrce evidentirao isporuku nakon konfiguriranog roka za odgovor; nije zamjena za neovisnu poreznu ili pravnu provjeru.",
    { x: LEFT, y, width: CONTENT_WIDTH, size: 7.5, lineHeight: 10.5, font, color: rgb(0.35, 0.35, 0.35) }
  );
  y -= 10;
  drawWrapped(
    page,
    "Ovaj dokument je informativna evidencija platforme. Za poreznu priznatost i potrebnu popratnu dokumentaciju obratite se ovlaštenom poreznom savjetniku.",
    { x: LEFT, y, width: CONTENT_WIDTH, size: 7.5, lineHeight: 10.5, font, color: rgb(0.35, 0.35, 0.35) }
  );

  const pages = doc.getPages();
  pages.forEach((currentPage, index) => {
    const label = `Stranica ${index + 1} od ${pages.length} · ${input.lines.length} stavki`;
    currentPage.drawText(label, {
      x: LEFT,
      y: 34,
      size: 7,
      font,
      color: rgb(0.45, 0.45, 0.45),
    });
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
  assertReceiptInput(input.lines, input.totalEur);
  const linesXml = input.lines
    .map(
      (line) => `  <line pledge_id="${escapeXml(line.pledgeId)}" date="${escapeXml(line.dateIso)}" institution="${escapeXml(line.institutionName)}" oib="${escapeXml(line.institutionOib ?? "")}" category="${escapeXml(String(line.taxCategory))}" amount_eur="${line.amountEur.toFixed(2)}" acknowledgement="${escapeXml(line.ackKind)}" />`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<donation_receipt_manifest xmlns="https://dajsrce.app/ns/receipt/1"
  company_id="${escapeXml(input.companyId)}"
  fiscal_year="${input.fiscalYear}"
  version="${input.version}"
  generated_at="${escapeXml(input.generatedAtIso)}"
  line_count="${input.lines.length}"
  ceiling_pct="${input.ceilingPct.toFixed(2)}"
  consumed_pct_estimate="${input.consumedPct.toFixed(4)}"
  total_amount_eur="${input.totalEur.toFixed(2)}">
${linesXml}
</donation_receipt_manifest>
`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
