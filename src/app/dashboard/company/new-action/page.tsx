import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { buttonClasses } from "@/components/ui";

export default function NewCompanyActionPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-card border border-warning/30 bg-warning-soft p-6 text-warning-on-soft">
        <AlertTriangle className="mb-3 h-8 w-8 text-warning" aria-hidden="true" />
        <h1 className="text-2xl font-bold tracking-[-0.02em]">
          Legacy self-reported actions are retired
        </h1>
        <p className="mt-3 text-base leading-7">
          These entries were not acknowledged by the named NGO and therefore cannot be presented
          as verified impact evidence. Create a pledge, complete delivery, and obtain NGO
          acknowledgement instead.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/needs" className={buttonClasses()}>
            Find an NGO need
          </Link>
          <Link href="/dashboard/company" className={buttonClasses({ variant: "secondary" })}>
            Return to company dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
