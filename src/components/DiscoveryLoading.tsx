"use client";

import { useT } from "@/i18n/client";
import { PageShell, Skeleton } from "@/components/ui";

/** Route-level feedback also lets Next prefetch the shell of these dynamic pages. */
export function DiscoveryLoading({ labelKey }: { labelKey: string }) {
  const t = useT();
  return (
    <PageShell>
      <div role="status" aria-label={t(labelKey)}>
        <Skeleton className="mb-3 h-10 w-64" />
        <Skeleton className="mb-8 h-5 w-full max-w-xl" />
        <Skeleton className="mb-6 h-16 w-full" />
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((key) => <Skeleton key={key} className="h-64 w-full" />)}
        </div>
      </div>
    </PageShell>
  );
}
