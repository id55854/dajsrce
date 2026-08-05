"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui";
import { useT } from "@/i18n/client";

/**
 * Every company tab runs several Supabase queries. Without a boundary here a
 * failing query took down the whole route with Next's unstyled fallback; the
 * tenant nav in the layout stays usable because this scopes to the page.
 */
export default function CompanyDashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();

  useEffect(() => {
    // Digest only: the message can carry query internals.
    console.error("company dashboard error", { digest: error.digest });
  }, [error]);

  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-warning-soft text-warning">
        <AlertTriangle className="h-7 w-7" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <h1 className="text-2xl font-bold tracking-[-0.02em] text-ink">
        {t("errors.generic_title")}
      </h1>
      <p className="max-w-md text-base leading-7 text-ink-secondary">{t("errors.generic_body")}</p>
      <Button onClick={reset} className="mt-2">
        {t("errors.retry")}
      </Button>
    </div>
  );
}
