import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import type { CsrReportManifest } from "./gather";

function fmtEur(value: number): string {
  return new Intl.NumberFormat("hr-HR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function safeBrandColor(value: string | null): string {
  return /^#[0-9A-Fa-f]{6}$/.test(value ?? "") ? value!.slice(1).toUpperCase() : "D93654";
}

const noBorders = {
  top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
};

function cell(text: string, options: { bold?: boolean; fill?: string } = {}): TableCell {
  return new TableCell({
    verticalAlign: VerticalAlign.CENTER,
    shading: options.fill
      ? { type: ShadingType.CLEAR, color: "auto", fill: options.fill }
      : undefined,
    margins: { top: 70, bottom: 70, left: 110, right: 110 },
    children: [
      new Paragraph({
        spacing: { before: 0, after: 0 },
        children: [new TextRun({ text, bold: options.bold, size: 19 })],
      }),
    ],
  });
}

function twoColumnTable(rows: Array<[string, string]>, withHeader?: [string, string]): Table {
  const tableRows: TableRow[] = [];
  if (withHeader) {
    tableRows.push(
      new TableRow({
        tableHeader: true,
        children: [cell(withHeader[0], { bold: true, fill: "E9EBEE" }), cell(withHeader[1], { bold: true, fill: "E9EBEE" })],
      })
    );
  }
  rows.forEach(([label, value], index) => {
    const fill = index % 2 === 0 ? "F5F5F5" : undefined;
    tableRows.push(
      new TableRow({ children: [cell(label, { fill }), cell(value, { bold: true, fill })] })
    );
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: noBorders,
    rows: tableRows,
  });
}

function sectionHeading(text: string, brandColor: string, pageBreakBefore = false): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    pageBreakBefore,
    keepNext: true,
    spacing: { before: 260, after: 100 },
    children: [new TextRun({ text, bold: true, color: brandColor, size: 28 })],
  });
}

export async function renderCsrReportDocx(manifest: CsrReportManifest): Promise<Buffer> {
  const title = manifest.company.display_name?.trim() || manifest.company.legal_name;
  const brandColor = safeBrandColor(manifest.company.brand_primary_hex);
  const children: (Paragraph | Table)[] = [
    new Paragraph({
      spacing: { after: 100 },
      children: [new TextRun({ text: "DajSrce — CSR pregled učinka", bold: true, color: brandColor, size: 24 })],
    }),
    new Paragraph({
      heading: HeadingLevel.TITLE,
      spacing: { after: 120 },
      children: [new TextRun({ text: title, bold: true, size: 40 })],
    }),
    new Paragraph({
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: `Izvještajno razdoblje: ${manifest.period_start} — ${manifest.period_end}`,
          color: "555555",
          size: 21,
        }),
      ],
    }),
  ];

  if (manifest.company.tagline?.trim()) {
    children.push(
      new Paragraph({
        spacing: { after: 160 },
        children: [new TextRun({ text: manifest.company.tagline.trim(), size: 22 })],
      })
    );
  }

  children.push(
    sectionHeading("Sažetak", brandColor),
    twoColumnTable([
      ["Potvrđene donacije u razdoblju", fmtEur(manifest.totals.given_eur)],
      ["Volonterski sati povezani s tvrtkom", `${manifest.totals.volunteer_hours.toFixed(2)} h`],
      ["Podržane ustanove i organizacije", String(manifest.totals.institutions_supported)],
      ["Obuhvaćene potvrđene donacije", String(manifest.totals.pledges_in_scope)],
    ])
  );

  if (manifest.monthly_eur.length > 0) {
    children.push(
      sectionHeading("Potvrđene donacije po mjesecima", brandColor, true),
      twoColumnTable(
        manifest.monthly_eur.map((row) => [row.month, fmtEur(row.eur)]),
        ["Mjesec", "Iznos"]
      )
    );
  }

  if (manifest.top_institutions.length > 0) {
    children.push(
      sectionHeading("Najviše podržane ustanove i organizacije", brandColor, true),
      twoColumnTable(
        manifest.top_institutions.map((row) => [row.name, fmtEur(row.eur)]),
        ["Ustanova ili organizacija", "Potvrđeni iznos"]
      )
    );
  }

  if (manifest.campaigns.length > 0) {
    children.push(
      sectionHeading("Aktivne kampanje — stanje pri izradi izvještaja", brandColor),
      twoColumnTable(
        manifest.campaigns.map((campaign) => [
          campaign.name,
          campaign.sdg_tags.length > 0 ? `SDG ${campaign.sdg_tags.join(", ")}` : "Bez SDG oznake",
        ]),
        ["Kampanja", "Ciljevi održivog razvoja"]
      )
    );
  }

  children.push(
    sectionHeading("Metodologija i ograničenja", brandColor),
    new Paragraph({
      spacing: { after: 100 },
      children: [
        new TextRun({
          text: "Iznosi uključuju samo donacije koje je ustanova potvrdila ručno ili koje su potvrđene automatiziranim postupkom nakon isteka roka za odgovor. Volonterski sati uključuju dovršene prijave povezane s tvrtkom u istom razdoblju.",
          size: 19,
        }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: "Ovaj dokument je informativni pregled podataka platforme i nije zamjena za neovisnu reviziju, porezno mišljenje ili pravni savjet.",
          color: "666666",
          italics: true,
          size: 18,
        }),
      ],
    })
  );

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: "Arial", size: 20 }, paragraph: { spacing: { after: 80 } } },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 720, right: 720, bottom: 720, left: 720, header: 360, footer: 360 },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [new TextRun({ text: manifest.company.legal_name, color: "777777", size: 16 })],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({ text: "DajSrce · ", color: "777777", size: 16 }),
                  new TextRun({ children: [PageNumber.CURRENT], color: "777777", size: 16 }),
                  new TextRun({ text: " / ", color: "777777", size: 16 }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], color: "777777", size: 16 }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}
