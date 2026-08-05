import { PageShell, Skeleton } from "@/components/ui";

export default function AdminDashboardLoading() {
  return (
    <PageShell width="wide">
      <div aria-busy="true">
        <div className="mb-8 space-y-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-5 w-96" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[7.5rem] rounded-card" />
          ))}
        </div>
        <Skeleton className="mt-8 h-40 rounded-card" />
      </div>
    </PageShell>
  );
}
