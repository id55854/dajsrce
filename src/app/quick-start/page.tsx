import { QuickStartWizard } from "@/components/QuickStartWizard";
import { getTranslator } from "@/i18n/server";

export default async function QuickStartPage() {
  const t = await getTranslator();
  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t("quick_start.page_title")}
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t("quick_start.page_subtitle")}
        </p>
      </header>
      <QuickStartWizard />
    </div>
  );
}
