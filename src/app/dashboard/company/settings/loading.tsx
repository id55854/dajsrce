import { Skeleton } from "@/components/ui";

export default function CompanySettingsLoading() {
  return (
    <div aria-busy="true">
      <div className="mb-8">
        <Skeleton className="h-9 w-56" />
      </div>

      {/* The tab strip, then the brand / finance / billing cards. */}
      <Skeleton className="mb-6 h-14 w-full rounded-full" />
      <div className="space-y-8">
        <Skeleton className="h-80 rounded-card" />
        <Skeleton className="h-56 rounded-card" />
        <Skeleton className="h-48 rounded-card" />
      </div>
    </div>
  );
}
