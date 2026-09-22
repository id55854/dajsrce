"use client";

import type { DonationType } from "@/lib/types";
import { DONATION_TYPES } from "@/lib/constants";
import { useLocale, useT } from "@/i18n/client";
import { FilterDropdown } from "./FilterDropdown";

export function DonationFilter({ value, onChange }: {
  value: DonationType | null;
  onChange: (next: DonationType | null) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  return <FilterDropdown
    label={t("needs_page.donation_type")}
    allLabel={t("filters.donation_any")}
    options={(Object.keys(DONATION_TYPES) as DonationType[]).map((key) => ({ value: key, label: locale === "hr" ? DONATION_TYPES[key].labelHr : DONATION_TYPES[key].label }))}
    value={value ? [value] : []}
    onChange={(next) => onChange(next[0] ?? null)}
  />;
}
