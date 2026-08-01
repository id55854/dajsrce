import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";
import type { CsrReportManifest } from "./gather";

const PAGE_SIZE: [number, number] = [595.28, 841.89];
const LEFT = 48;
const RIGHT = PAGE_SIZE[0] - 48;
const TOP = PAGE_SIZE[1] - 48;
const BOTTOM = 62;
const CONTENT_WIDTH = RIGHT - LEFT;
const FONT_DIRECTORY = path.join(
  process.cwd(),
  "node_modules",
  "@expo-google-fonts",
  "noto-sans"
);
const REGULAR_FONT_PATH = path.join(
  FONT_DIRECTORY,
  "400Regular",
  "NotoSans_400Regular.ttf"
);
const BOLD_FONT_PATH = path.join(FONT_DIRECTORY, "700Bold", "NotoSans_700Bold.ttf");

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

function fmtEur(value: number): string {
  return new Intl.NumberFormat("hr-HR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function splitLongWord(word: string, font: PDFFont, size: number, maxWidth: number): string[] {
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
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const rawWords = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const words = rawWords.flatMap((word) =>
    font.widthOfTextAtSize(word, size) <= maxWidth
      ? [word]
      : splitLongWord(word, font, size, maxWidth)
  );
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

/** Render a complete, Unicode-capable and automatically paginated CSR summary. */
export async function renderCsrReportPdf(manifest: CsrReportManifest): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [regularBytes, boldBytes] = await Promise.all([
    readFile(REGULAR_FONT_PATH),
    readFile(BOLD_FONT_PATH),
  ]);
  // Full embedding avoids invalid CID mappings produced by fontkit's subset
  // path for this static TTF and keeps rendering consistent across readers.
  const font = await doc.embedFont(regularBytes, { subset: false });
  const fontBold = await doc.embedFont(boldBytes, { subset: false });
  const accent = hexToRgb(manifest.company.brand_primary_hex);
  const accentColor = rgb(accent.r, accent.g, accent.b);
  let page!: PDFPage;
  let y!: number;

  const addPage = (continuation = true): void => {
    page = doc.addPage(PAGE_SIZE);
    y = TOP;
    if (continuation) {
      page.drawText("DajSrce — CSR pregled učinka", {
        x: LEFT,
        y,
        size: 9,
        font: fontBold,
        color: accentColor,
      });
      y -= 25;
    }
  };

  const ensureSpace = (height: number): void => {
    if (y - height < BOTTOM) addPage();
  };

  const drawWrapped = (
    text: string,
    options: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; gap?: number } = {}
  ): void => {
    const size = options.size ?? 9;
    const selectedFont = options.bold ? fontBold : font;
    const lineHeight = size + 3;
    const lines = wrapText(text, selectedFont, size, CONTENT_WIDTH);
    ensureSpace(lines.length * lineHeight + (options.gap ?? 0));
    for (const line of lines) {
      page.drawText(line, {
        x: LEFT,
        y,
        size,
        font: selectedFont,
        color: options.color ?? rgb(0.18, 0.18, 0.18),
      });
      y -= lineHeight;
    }
    y -= options.gap ?? 0;
  };

  const drawSectionTitle = (title: string): void => {
    ensureSpace(34);
    y -= 8;
    page.drawText(title, { x: LEFT, y, size: 11, font: fontBold, color: rgb(0.08, 0.08, 0.08) });
    y -= 19;
  };

  const drawTableRow = (label: string, value: string, alternate: boolean): void => {
    const valueWidth = 150;
    const labelWidth = CONTENT_WIDTH - valueWidth - 16;
    const labelLines = wrapText(label, font, 8.5, labelWidth);
    const valueLines = wrapText(value, fontBold, 8.5, valueWidth - 8);
    const rowHeight = Math.max(labelLines.length, valueLines.length) * 12 + 8;
    ensureSpace(rowHeight);
    if (alternate) {
      page.drawRectangle({
        x: LEFT,
        y: y - rowHeight + 5,
        width: CONTENT_WIDTH,
        height: rowHeight,
        color: rgb(0.965, 0.965, 0.965),
      });
    }
    labelLines.forEach((line, index) => {
      page.drawText(line, { x: LEFT + 5, y: y - index * 12, size: 8.5, font });
    });
    valueLines.forEach((line, index) => {
      page.drawText(line, { x: RIGHT - valueWidth + 5, y: y - index * 12, size: 8.5, font: fontBold });
    });
    y -= rowHeight;
  };

  addPage(false);
  page.drawText("DajSrce — CSR pregled učinka", {
    x: LEFT,
    y,
    size: 11,
    font: fontBold,
    color: accentColor,
  });
  y -= 28;
  drawWrapped(manifest.company.display_name?.trim() || manifest.company.legal_name, {
    size: 18,
    bold: true,
    gap: 5,
  });
  drawWrapped(`Izvještajno razdoblje: ${manifest.period_start} — ${manifest.period_end}`, {
    size: 9.5,
    color: rgb(0.35, 0.35, 0.35),
    gap: 8,
  });
  if (manifest.company.tagline?.trim()) {
    drawWrapped(manifest.company.tagline.trim(), { size: 10, gap: 7 });
  }

  drawSectionTitle("Sažetak");
  [
    ["Potvrđene donacije u razdoblju", fmtEur(manifest.totals.given_eur)],
    ["Volonterski sati povezani s tvrtkom", `${manifest.totals.volunteer_hours.toFixed(2)} h`],
    ["Podržane ustanove i organizacije", String(manifest.totals.institutions_supported)],
    ["Obuhvaćene potvrđene donacije", String(manifest.totals.pledges_in_scope)],
  ].forEach(([label, value], index) => drawTableRow(label, value, index % 2 === 0));

  if (manifest.monthly_eur.length > 0) {
    drawSectionTitle("Potvrđene donacije po mjesecima");
    manifest.monthly_eur.forEach((month, index) => {
      drawTableRow(month.month, fmtEur(month.eur), index % 2 === 0);
    });
  }

  if (manifest.top_institutions.length > 0) {
    drawSectionTitle("Najviše podržane ustanove i organizacije");
    manifest.top_institutions.forEach((institution, index) => {
      drawTableRow(institution.name, fmtEur(institution.eur), index % 2 === 0);
    });
  }

  if (manifest.campaigns.length > 0) {
    drawSectionTitle("Aktivne kampanje — stanje pri izradi izvještaja");
    manifest.campaigns.forEach((campaign, index) => {
      const sdg = campaign.sdg_tags.length > 0 ? `SDG ${campaign.sdg_tags.join(", ")}` : "Bez SDG oznake";
      drawTableRow(campaign.name, sdg, index % 2 === 0);
    });
  }

  drawSectionTitle("Metodologija i ograničenja");
  drawWrapped(
    "Iznosi uključuju samo donacije koje je ustanova potvrdila ručno ili koje su potvrđene automatiziranim postupkom nakon isteka roka za odgovor. Volonterski sati uključuju dovršene prijave povezane s tvrtkom u istom razdoblju.",
    { size: 8, gap: 5 }
  );
  drawWrapped(
    "Ovaj dokument je informativni pregled podataka platforme i nije zamjena za neovisnu reviziju, porezno mišljenje ili pravni savjet.",
    { size: 8, color: rgb(0.38, 0.38, 0.38) }
  );

  const pages = doc.getPages();
  pages.forEach((currentPage, index) => {
    currentPage.drawLine({
      start: { x: LEFT, y: 48 },
      end: { x: RIGHT, y: 48 },
      thickness: 0.4,
      color: rgb(0.82, 0.82, 0.82),
    });
    currentPage.drawText(`Stranica ${index + 1} od ${pages.length}`, {
      x: LEFT,
      y: 32,
      size: 7,
      font,
      color: rgb(0.45, 0.45, 0.45),
    });
  });

  return doc.save();
}
