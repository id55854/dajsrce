import { Skeleton } from "@/components/ui";

/**
 * The parent `dashboard/company/loading.tsx` mirrors the metrics dashboard, so
 * without this the team tab flashed a four-stat skeleton it never renders.
 */
export default function CompanyTeamLoading() {
  return (
    <div aria-busy="true">
      <div className="mb-8 space-y-3">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-5 w-32" />
      </div>

      <div className="space-y-8">
        <div className="space-y-3 rounded-card border border-border-subtle bg-surface-raised p-6 shadow-raised">
          <Skeleton className="h-6 w-40" />
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-16 rounded-control" />
          ))}
        </div>
        <Skeleton className="h-56 rounded-card" />
        <Skeleton className="h-56 rounded-card" />
      </div>
    </div>
  );
}
