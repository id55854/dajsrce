import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { renderCsrReportDocx } from "./csr-report/render-docx";
import { renderCsrReportPdf } from "./csr-report/render-pdf";
import type { CsrReportManifest } from "./csr-report/gather";
import {
  buildReceiptManifestXml,
  renderDonationReceiptPdf,
  type ReceiptLineItem,
} from "./receipts/render";

async function writeQaArtifact(environmentName: string, data: Uint8Array): Promise<void> {
  const output = process.env[environmentName];
  if (!output) return;
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, data);
}

function receiptLines(count: number): ReceiptLineItem[] {
  return Array.from({ length: count }, (_, index) => ({
    pledgeId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    dateIso: `2026-${String((index % 12) + 1).padStart(2, "0")}-15T12:00:00.000Z`,
    institutionName:
      index % 9 === 0
        ? `Udruga za zaštitu djece, žrtava nasilja i osoba s teškoćama — podružnica ${index + 1}`
        : `Udruga Čuvari srca ${index + 1}`,
    institutionOib: index % 3 === 0 ? "12345678903" : null,
    taxCategory: index % 2 === 0 ? "humanitarian" : "other_public_benefit",
    amountEur: (index % 7) + 0.25,
    ackKind: index % 5 === 0 ? "auto" : "manual",
  }));
}

function csrManifest(): CsrReportManifest {
  return {
    period_start: "2022-01-01",
    period_end: "2026-12-31",
    company: {
      legal_name: "Čuvari zajednice d.o.o.",
      display_name: "Čuvari zajednice — održiva pomoć",
      tagline:
        "Transparentno povezujemo zaposlenike s ustanovama i udrugama diljem Hrvatske, uključujući Šibenik, Čakovec, Đakovo i Županju.",
      brand_primary_hex: "#C53A55",
    },
    totals: {
      given_eur: 123456.78,
      volunteer_hours: 987.65,
      institutions_supported: 48,
      pledges_in_scope: 2400,
    },
    monthly_eur: Array.from({ length: 60 }, (_, index) => ({
      month: `${2022 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`,
      eur: (index + 1) * 73.19,
    })),
    top_institutions: Array.from({ length: 8 }, (_, index) => ({
      name: `Udruga za pomoć djeci i osobama s teškoćama u razvoju — regionalni centar ${index + 1}`,
      eur: 8500 - index * 417.25,
    })),
    campaigns: Array.from({ length: 20 }, (_, index) => ({
      name: `Kampanja Čista budućnost i snažna zajednica — ciklus ${index + 1}`,
      sdg_tags: [1, 3, 10, 11],
    })),
  };
}

describe("evidence artifact renderers", () => {
  it(
    "renders a reconciled, Unicode, multi-page receipt without dropping rows",
    async () => {
      const lines = receiptLines(130);
      const totalEur = lines.reduce((sum, line) => sum + line.amountEur, 0);
      const bytes = await renderDonationReceiptPdf({
        company: {
          legal_name: "Čuvari zajednice d.o.o.",
          oib: "12345678903",
          address: "Ulica hrvatskih branitelja 42",
          city: "Šibenik",
          brand_primary_hex: "#C53A55",
        },
        fiscalYear: 2026,
        ceilingPct: 2,
        consumedPct: 41.52,
        lines,
        totalEur,
        version: 3,
      });
      const pdf = await PDFDocument.load(bytes);
      expect(pdf.getPageCount()).toBeGreaterThan(2);
      await writeQaArtifact("RECEIPT_QA_OUTPUT", bytes);

      const xml = buildReceiptManifestXml({
        companyId: "company&1",
        fiscalYear: 2026,
        version: 3,
        generatedAtIso: "2026-08-01T12:00:00.000Z",
        ceilingPct: 2,
        consumedPct: 41.52,
        totalEur,
        lines,
      });
      expect(xml).toContain('line_count="130"');
      expect(xml).toContain('company_id="company&amp;1"');
      expect(xml.match(/<line /g)).toHaveLength(130);
    },
    30_000
  );

  it("rejects duplicate receipt evidence and unreconciled totals", async () => {
    const lines = receiptLines(2);
    await expect(
      renderDonationReceiptPdf({
        company: { legal_name: "Test", oib: null, address: null, city: null },
        fiscalYear: 2026,
        ceilingPct: 2,
        consumedPct: 0,
        lines: [lines[0], lines[0]],
        totalEur: lines[0].amountEur * 2,
        version: 1,
      })
    ).rejects.toThrow(/Duplicate or missing pledge/);
    expect(() =>
      buildReceiptManifestXml({
        companyId: "test",
        fiscalYear: 2026,
        version: 1,
        generatedAtIso: "2026-08-01T12:00:00.000Z",
        ceilingPct: 2,
        consumedPct: 0,
        totalEur: 999,
        lines,
      })
    ).toThrow(/does not reconcile/);
  });

  it(
    "renders complete multi-page Unicode CSR PDF and structurally valid DOCX output",
    async () => {
      const manifest = csrManifest();
      const [pdfBytes, docxBytes] = await Promise.all([
        renderCsrReportPdf(manifest),
        renderCsrReportDocx(manifest),
      ]);
      const pdf = await PDFDocument.load(pdfBytes);
      expect(pdf.getPageCount()).toBeGreaterThan(2);

      const zip = await JSZip.loadAsync(docxBytes);
      const documentXml = await zip.file("word/document.xml")?.async("string");
      expect(documentXml).toContain("Čuvari zajednice");
      expect(documentXml).toContain("Kampanja Čista budućnost");
      expect(zip.file("[Content_Types].xml")).not.toBeNull();

      await Promise.all([
        writeQaArtifact("CSR_PDF_QA_OUTPUT", pdfBytes),
        writeQaArtifact("CSR_DOCX_QA_OUTPUT", docxBytes),
      ]);
    },
    30_000
  );
});
