import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  HeadingLevel,
} from "docx";
import type { CsrReportManifest } from "./gather";

function fmtEur(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

export async function renderCsrReportDocx(manifest: CsrReportManifest): Promise<Buffer> {
  const title = manifest.company.display_name?.trim() || manifest.company.legal_name;

  const summaryRows = [
    new TableRow({
      children: [
        new TableCell({ children: [new Paragraph("Acknowledged giving (in scope)")] }),
        new TableCell({ children: [new Paragraph(fmtEur(manifest.totals.given_eur))] }),
      ],
    }),
    new TableRow({
      children: [
        new TableCell({ children: [new Paragraph("Volunteer hours")] }),
        new TableCell({
          children: [new Paragraph(`${manifest.totals.volunteer_hours.toFixed(1)} h`)],
        }),
      ],
    }),
    new TableRow({
      children: [
        new TableCell({ children: [new Paragraph("Beneficiary institutions")] }),
        new TableCell({
          children: [new Paragraph(String(manifest.totals.institutions_supported))],
        }),
      ],
    }),
    new TableRow({
      children: [
        new TableCell({ children: [new Paragraph("Pledges counted")] }),
        new TableCell({
          children: [new Paragraph(String(manifest.totals.pledges_in_scope))],
        }),
      ],
    }),
  ];

  const topRows = [
    new TableRow({
      children: [
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Institution", bold: true })] })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "EUR", bold: true })] })] }),
      ],
    }),
    ...manifest.top_institutions.slice(0, 12).map(
      (r) =>
        new TableRow({
          children: [
            new TableCell({ children: [new Paragraph(r.name)] }),
            new TableCell({ children: [new Paragraph(fmtEur(r.eur))] }),
          ],
        })
    ),
  ];

  const children: (Paragraph | Table)[] = [
    new Paragraph({
      text: "CSR impact summary",
      heading: HeadingLevel.TITLE,
    }),
    new Paragraph({
      children: [
        new TextRun({ text: title, bold: true, size: 28 }),
      ],
    }),
    new Paragraph({
      text: `Period: ${manifest.period_start} — ${manifest.period_end}`,
    }),
  ];

  if (manifest.company.tagline) {
    children.push(new Paragraph(manifest.company.tagline));
  }

  children.push(
    new Paragraph({ text: "Executive summary", heading: HeadingLevel.HEADING_1 }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: summaryRows,
    }),
    new Paragraph({ text: "Top beneficiaries", heading: HeadingLevel.HEADING_1 }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: topRows,
    })
  );

  if (manifest.campaigns.length > 0) {
    children.push(new Paragraph({ text: "Campaigns", heading: HeadingLevel.HEADING_1 }));
    for (const c of manifest.campaigns) {
      const sdg = c.sdg_tags.length ? ` (SDG ${c.sdg_tags.join(", ")})` : "";
      children.push(new Paragraph(`${c.name}${sdg}`));
    }
  }

  children.push(
    new Paragraph({
      text: "Methodology: delivered/confirmed pledges with EUR in the date window; volunteer hours linked to the company in the same window. Informational only.",
      heading: HeadingLevel.HEADING_2,
    })
  );

  const doc = new Document({
    sections: [{ children }],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}
