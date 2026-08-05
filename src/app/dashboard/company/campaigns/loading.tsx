import { Skeleton } from "@/components/ui";

export default function CompanyCampaignsLoading() {
  return (
    <div aria-busy="true">
      <div className="mb-8 flex items-end justify-between gap-4">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-11 w-40 rounded-full" />
      </div>

      <ul className="space-y-3">
        {Array.from({ length: 3 }, (_, i) => (
          <li key={i}>
            <Skeleton className="h-24 rounded-card" />
          </li>
        ))}
      </ul>
    </div>
  );
}
