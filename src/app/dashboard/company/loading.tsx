import { Skeleton } from "@/components/ui";

/**
 * Company tabs are server-rendered, so without this boundary switching tabs
 * left the previous page frozen on screen until the query resolved. The
 * tenant nav in the layout stays interactive while this renders.
 *
 * Shape mirrors the dashboard: title, four stats, three artifact sections and
 * the campaigns row.
 */
export default function CompanyDashboardLoading() {
  return (
    <div aria-busy="true">
      <div className="mb-8 space-y-3">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-5 w-80" />
      </div>

      <div className="space-y-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[7.5rem] rounded-card" />
          ))}
        </div>

        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-64 rounded-card" />
        ))}

        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-40 rounded-card" />
          <Skeleton className="h-40 rounded-card" />
        </div>
      </div>
    </div>
  );
}
