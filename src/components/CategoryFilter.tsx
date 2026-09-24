"use client";

import type { InstitutionCategory } from "@/lib/types";
import { CATEGORY_CONFIG } from "@/lib/constants";
import { useLocale, useT } from "@/i18n/client";
import { FilterDropdown } from "./FilterDropdown";

const ALL_CATEGORIES = Object.keys(CATEGORY_CONFIG) as InstitutionCategory[];

export function CategoryFilter({ value, onChange, categories = ALL_CATEGORIES }: {
  value: InstitutionCategory[];
  onChange: (next: InstitutionCategory[]) => void;
  /** The categories offered; every category unless a surface narrows it. */
  categories?: InstitutionCategory[];
}) {
  const t = useT();
  const { locale } = useLocale();
  return <FilterDropdown
    label={t("filters.organisation_type")}
    allLabel={t("filters.category_any")}
    options={categories.map((key) => ({ value: key, label: locale === "hr" ? CATEGORY_CONFIG[key].labelHr : CATEGORY_CONFIG[key].label }))}
    value={value}
    onChange={onChange}
    multiple
    searchable
  />;
}
