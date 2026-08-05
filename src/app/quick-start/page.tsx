import type { Metadata } from "next";
import { QuickStartWizard } from "@/components/QuickStartWizard";
import { getTranslator } from "@/i18n/server";
import { PageHeader, PageShell } from "@/components/ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return {
    title: `${t("quick_start.page_title")} | DajSrce`,
    description: t("quick_start.page_subtitle"),
  };
}

export default async function QuickStartPage() {
  const t = await getTranslator();
  return (
    // One container for both header and card — they used to declare different
    // max widths, so the heading sat wider than the thing it introduced.
    <PageShell width="narrow">
      <PageHeader
        title={t("quick_start.page_title")}
        subtitle={t("quick_start.page_subtitle")}
      />
      <QuickStartWizard />
    </PageShell>
  );
}
