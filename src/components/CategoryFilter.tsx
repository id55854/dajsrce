"use client";

import type { InstitutionCategory } from "@/lib/types";
import { CATEGORY_CONFIG } from "@/lib/constants";
import { useLocale, useT } from "@/i18n/client";
import { FilterDropdown } from "./FilterDropdown";

export function CategoryFilter({ value, onChange }: {
  value: InstitutionCategory[];
  onChange: (next: InstitutionCategory[]) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  return <FilterDropdown
    label={t("filters.organisation_type")}
    allLabel={t("filters.category_any")}
    options={(Object.keys(CATEGORY_CONFIG) as InstitutionCategory[]).map((key) => ({ value: key, label: locale === "hr" ? CATEGORY_CONFIG[key].labelHr : CATEGORY_CONFIG[key].label }))}
    value={value}
    onChange={onChange}
    multiple
    searchable
  />;
}
