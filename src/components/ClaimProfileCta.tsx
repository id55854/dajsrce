import Link from "next/link";
import { Building2 } from "lucide-react";
import { buttonClasses } from "@/components/ui/button-classes";
import { NGO_SIGNUP_HREF } from "@/lib/auth/onboarding";

/**
 * "Is this your association? Claim the profile" on an official register
 * record, for the map panel and the full record page alike.
 *
 * Deliberately not a client component and never session-aware, so a public
 * page gains no request for it: the link always goes to the NGO sign-up, and
 * /auth/register forwards a signed-in account to /auth/setup?role=ngo, which
 * knows whether that account can still claim. The caller passes translated
 * strings because this renders from both server and client trees.
 */
export function ClaimProfileCta({ question, action }: { question: string; action: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-brand/30 bg-brand-soft/40 p-4">
      <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
        <Building2 className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
        {question}
      </p>
      <Link href={NGO_SIGNUP_HREF} className={buttonClasses({ size: "sm" })}>
        {action}
      </Link>
    </div>
  );
}
