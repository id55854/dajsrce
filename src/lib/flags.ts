// ESG feature flags. Public flags (NEXT_PUBLIC_*) are baked into the
// client bundle; server-only flags are read on each route hit.
//
// Defaults match the phase rollout plan:
//   - Companies are enabled by default after Phase 0 ships.
//   - Receipts, exports, and public profiles stay off until their phases
//     are reviewed and legal/tax signoff is in place.

function readBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "on" || normalized === "yes") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "off" || normalized === "no") {
    return false;
  }
  return fallback;
}

export const flags = {
  companiesEnabled: readBool(process.env.NEXT_PUBLIC_FLAG_COMPANIES_ENABLED, true),
  receiptsEnabled: readBool(process.env.NEXT_PUBLIC_FLAG_RECEIPTS_ENABLED, false),
  exportsEnabled: readBool(process.env.NEXT_PUBLIC_FLAG_EXPORTS_ENABLED, false),
  publicProfileEnabled: readBool(process.env.NEXT_PUBLIC_FLAG_PUBLIC_PROFILE_ENABLED, false),
};

export type FlagKey = keyof typeof flags;

export function isFlagEnabled(key: FlagKey): boolean {
  return flags[key];
}
