export const APP_ROLES = ["individual", "ngo", "superadmin"] as const;

export type AppRole = (typeof APP_ROLES)[number];

const LEGACY_ROLE_MAP: Record<string, AppRole> = {
  citizen: "individual",
  institution: "ngo",
  individual: "individual",
  ngo: "ngo",
  superadmin: "superadmin",
};

export function normalizeRole(value: string | null | undefined): AppRole {
  if (!value) return "individual";
  return LEGACY_ROLE_MAP[value] ?? "individual";
}

export function roleToDashboardPath(role: AppRole): string {
  if (role === "ngo") return "/dashboard/ngo";
  if (role === "superadmin") return "/dashboard/admin";
  return "/dashboard/individual";
}

export function roleLabel(role: AppRole): string {
  if (role === "ngo") return "NGO";
  if (role === "superadmin") return "Superadmin";
  return "Individual";
}
