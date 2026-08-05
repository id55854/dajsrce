import { PageShell, Skeleton } from "@/components/ui";

export default function IndividualDashboardLoading() {
  return (
    <PageShell width="content">
      <div aria-busy="true">
        <div className="mb-8 space-y-3">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-5 w-80" />
        </div>
        <div className="space-y-8">
          <Skeleton className="h-44 rounded-card" />
          <div className="grid gap-4 sm:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-[7.5rem] rounded-card" />
            ))}
          </div>
          <div className="space-y-3">
            <Skeleton className="h-6 w-48" />
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-24 rounded-card" />
            ))}
          </div>
        </div>
      </div>
    </PageShell>
  );
}
