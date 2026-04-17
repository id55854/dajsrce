import { NextResponse } from "next/server";
import { flags } from "@/lib/flags";
import { SUBSCRIPTION_TIERS } from "@/lib/constants";
import type { SubscriptionTier } from "@/lib/types";

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
