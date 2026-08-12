import Link from "next/link";
import { Compass } from "lucide-react";
import { buttonClasses } from "@/components/ui";
import { getTranslator } from "@/i18n/server";

export default async function NotFound() {
  const t = await getTranslator();

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-24 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-soft text-brand">
        <Compass className="h-7 w-7" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <h1 className="text-2xl font-bold tracking-[-0.02em] text-ink">
        {t("errors.not_found_title")}
      </h1>
      <p className="text-base text-ink-secondary">{t("errors.not_found_body")}</p>
      <Link href="/" className={buttonClasses({ className: "mt-2" })}>
        {t("errors.go_to_map")}
      </Link>
    </div>
  );
}
