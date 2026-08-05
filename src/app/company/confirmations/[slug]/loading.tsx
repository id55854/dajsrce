import { PageShell, Skeleton } from "@/components/ui";

export default function CompanyConfirmationLoading() {
  return (
    <PageShell width="content">
      <div aria-busy="true">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div className="space-y-3">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-9 w-64" />
          </div>
          <Skeleton className="h-11 w-52 rounded-full" />
        </div>
        <Skeleton className="h-96 rounded-card" />
      </div>
    </PageShell>
  );
}
