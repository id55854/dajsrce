import Link from "next/link";

export default function NewCompanyActionPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
        <h1 className="text-2xl font-bold">Legacy self-reported actions are retired</h1>
        <p className="mt-2 text-sm leading-relaxed">
          These entries were not acknowledged by the named NGO and therefore cannot be
          presented as verified impact evidence. Create a pledge, complete delivery, and obtain
          NGO acknowledgement instead.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/needs"
            className="rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
          >
            Find an NGO need
          </Link>
          <Link
            href="/dashboard/company"
            className="rounded-full border border-amber-400 px-4 py-2 text-sm font-semibold hover:bg-amber-100 dark:hover:bg-amber-900/30"
          >
            Return to company dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
