import { NextResponse } from "next/server";
import { flags } from "@/lib/flags";
import { SUBSCRIPTION_TIERS } from "@/lib/constants";
import type { Framework, SubscriptionTier } from "@/lib/types";

/** Returns a NextResponse when the receipts feature or tier blocks the action. */
export function assertTaxReceiptsFeature(): NextResponse | null {
  if (!flags.receiptsEnabled) {
    return NextResponse.json(
      { error: "Tax receipts are disabled. Set NEXT_PUBLIC_FLAG_RECEIPTS_ENABLED=true." },
      { status: 403 }
    );
  }
  return null;
}

export function assertCompanyTierAllowsReceipts(tier: SubscriptionTier): NextResponse | null {
  const blocked = assertTaxReceiptsFeature();
  if (blocked) return blocked;
  if (!SUBSCRIPTION_TIERS[tier]?.taxReceipts) {
    return NextResponse.json(
      {
        error: "Active paid plan required to generate tax receipts.",
        code: "PAYMENT_REQUIRED",
      },
      { status: 402 }
    );
  }
  return null;
}

export function assertEsgExportsFeature(): NextResponse | null {
  if (!flags.exportsEnabled) {
    return NextResponse.json(
      { error: "ESG exports are disabled. Set NEXT_PUBLIC_FLAG_EXPORTS_ENABLED=true." },
      { status: 403 }
    );
  }
  return null;
}

export function assertCompanyTierAllowsFramework(
  tier: SubscriptionTier,
  framework: Framework
): NextResponse | null {
  const blocked = assertEsgExportsFeature();
  if (blocked) return blocked;
  const allowed = SUBSCRIPTION_TIERS[tier]?.exports ?? [];
  if (!allowed.includes(framework)) {
    return NextResponse.json(
      {
        error: "Your plan does not include this framework export.",
        code: "PAYMENT_REQUIRED",
        allowed_frameworks: allowed,
      },
      { status: 402 }
    );
  }
  return null;
}

export function assertPublicProfileFeature(): NextResponse | null {
  if (!flags.publicProfileEnabled) {
    return NextResponse.json(
      {
        error:
          "Public profile and CSR reports are disabled. Set NEXT_PUBLIC_FLAG_PUBLIC_PROFILE_ENABLED=true.",
      },
      { status: 403 }
    );
  }
  return null;
}

export function assertCompanyTierAllowsCsrReport(tier: SubscriptionTier): NextResponse | null {
  const blocked = assertPublicProfileFeature();
  if (blocked) return blocked;
  if (!SUBSCRIPTION_TIERS[tier]?.csrReport) {
    return NextResponse.json(
      {
        error: "Active SME Plus or Enterprise plan required for CSR reports.",
        code: "PAYMENT_REQUIRED",
      },
      { status: 402 }
    );
  }
  return null;
}
