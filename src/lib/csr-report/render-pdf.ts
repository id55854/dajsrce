import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { CsrReportManifest } from "./gather";

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

function fmtEur(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

/** Single- or two-page ASCII-safe CSR summary PDF. */
export async function renderCsrReportPdf(manifest: CsrReportManifest): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const accent = hexToRgb(manifest.company.brand_primary_hex);

  const drawPage1 = () => {
    const page = doc.addPage([595.28, 841.89]);
    const { width, height } = page.getSize();
    let y = height - 48;
    const left = 48;
    const line = 14;

    const title = manifest.company.display_name?.trim() || manifest.company.legal_name;
    page.drawText("DajSrce — CSR impact summary", {
      x: left,
      y,
      size: 10,
      font: fontBold,
      color: rgb(accent.r, accent.g, accent.b),
    });
    y -= line * 1.4;
    page.drawText(title, { x: left, y, size: 18, font: fontBold, color: rgb(0.15, 0.15, 0.15) });
    y -= line * 2;
    page.drawText(
      `Reporting period: ${manifest.period_start} to ${manifest.period_end}`,
      { x: left, y, size: 10, font, color: rgb(0.35, 0.35, 0.35) }
    );
    y -= line * 2;

    if (manifest.company.tagline) {
      const tag = manifest.company.tagline.slice(0, 200);
      page.drawText(tag, { x: left, y, size: 10, font, color: rgb(0.25, 0.25, 0.25) });
      y -= line * 2;
    }

    page.drawText("Executive summary", {
      x: left,
      y,
      size: 12,
      font: fontBold,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= line * 1.5;

    const lines = [
      `Acknowledged giving (in scope): ${fmtEur(manifest.totals.given_eur)}`,
      `Volunteer hours (company-linked, in period): ${manifest.totals.volunteer_hours.toFixed(1)} h`,
      `Beneficiary institutions (distinct): ${manifest.totals.institutions_supported}`,
      `Pledges counted: ${manifest.totals.pledges_in_scope}`,
    ];
    for (const t of lines) {
      page.drawText(t, { x: left, y, size: 10, font, color: rgb(0.2, 0.2, 0.2) });
      y -= line;
    }
    y -= line;

    if (manifest.monthly_eur.length > 0) {
      page.drawText("Giving by month (EUR)", {
        x: left,
        y,
        size: 11,
        font: fontBold,
        color: rgb(0.1, 0.1, 0.1),
      });
      y -= line * 1.2;
      const maxEur = Math.max(...manifest.monthly_eur.map((m) => m.eur), 1);
      const chartH = 100;
      const chartW = width - left * 2;
      const barGap = 4;
      const n = manifest.monthly_eur.length;
      const barW = Math.max(8, (chartW - barGap * (n + 1)) / n);
      let x = left;
      const baseY = y - chartH - 16;
      for (const m of manifest.monthly_eur) {
        const h = (m.eur / maxEur) * chartH;
        page.drawRectangle({
          x: x + barGap,
          y: baseY,
          width: barW,
          height: Math.max(h, 1),
          color: rgb(accent.r, accent.g, accent.b),
        });
        const label = m.month.slice(5);
        page.drawText(label, {
          x: x + barGap,
          y: baseY - 4,
          size: 7,
          font,
          color: rgb(0.35, 0.35, 0.35),
        });
        x += barW + barGap;
      }
      y = baseY - line * 2;
    }

    page.drawText("Top beneficiary institutions (by EUR in scope)", {
      x: left,
      y,
      size: 11,
      font: fontBold,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= line * 1.2;
    for (const row of manifest.top_institutions.slice(0, 6)) {
      const t = `${row.name.slice(0, 72)} — ${fmtEur(row.eur)}`;
      page.drawText(t, { x: left, y, size: 9, font, color: rgb(0.2, 0.2, 0.2) });
      y -= line * 0.95;
      if (y < 72) break;
    }

    page.drawText("Methodology: totals include delivered/confirmed pledges with EUR amounts", {
      x: left,
      y: 40,
      size: 8,
      font,
      color: rgb(0.45, 0.45, 0.45),
    });
    page.drawText(
      "whose delivery or creation date falls in the reporting window. Not legal/tax advice.",
      { x: left, y: 28, size: 8, font, color: rgb(0.45, 0.45, 0.45) }
    );
  };

  drawPage1();

  if (manifest.campaigns.length > 0) {
    const page = doc.addPage([595.28, 841.89]);
    const { height } = page.getSize();
    let y = height - 48;
    const left = 48;
    const line = 14;
    page.drawText("Active campaigns (snapshot)", {
      x: left,
      y,
      size: 12,
      font: fontBold,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= line * 1.5;
    for (const c of manifest.campaigns.slice(0, 12)) {
      const sdg = c.sdg_tags.length ? ` · SDG: ${c.sdg_tags.join(", ")}` : "";
      const t = `${c.name.slice(0, 80)}${sdg}`;
      page.drawText(t, { x: left, y, size: 10, font, color: rgb(0.2, 0.2, 0.2) });
      y -= line;
      if (y < 60) break;
    }
  }

  return doc.save();
}
