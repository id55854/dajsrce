"use client";

import { useT } from "@/i18n/client";
import { PageShell, Skeleton } from "@/components/ui";

// Keep the shared navigation interactive while an uncached server page loads.
// More specific discovery routes retain their own tailored loading boundaries.
export default function Loading() {
  const t = useT();
  return (
    <PageShell>
      <div role="status" aria-live="polite" className="space-y-6">
        <p className="text-sm text-ink-secondary">{t("common.loading")}</p>
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-48 w-full" />
      </div>
    </PageShell>
  );
}
