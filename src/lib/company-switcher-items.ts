import type { Company, CompanyRole } from "@/lib/types";

export type CompanySwitcherItem = {
  id: string;
  slug: string;
  display_name: string | null;
  legal_name: string;
  logo_url: string | null;
  role: CompanyRole;
};

export function toSwitcherItems(
  memberships: Array<{ company: Company; role: CompanyRole }>
): CompanySwitcherItem[] {
  return memberships.map(({ company, role }) => ({
    id: company.id,
    slug: company.slug,
    display_name: company.display_name,
    legal_name: company.legal_name,
    logo_url: company.logo_url,
    role,
  }));
}
