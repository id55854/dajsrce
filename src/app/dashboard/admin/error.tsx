"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button, PageShell } from "@/components/ui";
import { useT } from "@/i18n/client";

/** Four admin count queries run per load; any of them can fail. */
export default function AdminDashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();

  useEffect(() => {
    console.error("admin dashboard error", { digest: error.digest });
  }, [error]);

  return (
    <PageShell width="narrow">
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-warning-soft text-warning">
          <AlertTriangle className="h-7 w-7" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <h1 className="text-2xl font-bold tracking-[-0.02em] text-ink">
          {t("errors.generic_title")}
        </h1>
        <p className="text-base leading-7 text-ink-secondary">{t("errors.generic_body")}</p>
        <Button onClick={reset} className="mt-2">
          {t("errors.retry")}
        </Button>
      </div>
    </PageShell>
  );
}
