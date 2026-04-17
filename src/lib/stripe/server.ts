import Stripe from "stripe";
import type { SubscriptionTier } from "@/lib/types";

/** Stripe API version pinned for typed webhook/event compatibility. */
const API_VERSION = "2026-03-25.dahlia";

let stripeSingleton: Stripe | null | undefined;

export function getStripe(): Stripe | null {
  if (stripeSingleton !== undefined) return stripeSingleton;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    stripeSingleton = null;
    return null;
  }
  stripeSingleton = new Stripe(key, { apiVersion: API_VERSION });
  return stripeSingleton;
}

export function requireStripe(): Stripe {
  const s = getStripe();
  if (!s) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  return s;
}

export function priceIdForPaidTier(tier: Exclude<SubscriptionTier, "free">): string | null {
  switch (tier) {
    case "sme_tax":
      return process.env.STRIPE_PRICE_SME_TAX ?? null;
    case "sme_plus":
      return process.env.STRIPE_PRICE_SME_PLUS ?? null;
    case "enterprise":
      return process.env.STRIPE_PRICE_ENTERPRISE ?? null;
    default:
      return null;
  }
}

export function tierForStripePriceId(priceId: string): SubscriptionTier | null {
  if (process.env.STRIPE_PRICE_SME_TAX === priceId) return "sme_tax";
  if (process.env.STRIPE_PRICE_SME_PLUS === priceId) return "sme_plus";
  if (process.env.STRIPE_PRICE_ENTERPRISE === priceId) return "enterprise";
  return null;
}
