"use client";

import type { DonationType } from "@/lib/types";
import { DONATION_TYPES } from "@/lib/constants";
import { useLocale, useT } from "@/i18n/client";
import { FilterDropdown } from "./FilterDropdown";

/**
 * `multiple` is the caller's choice because the two surfaces mean different
 * things by a donation type. The map asks which kinds of help an organisation
 * accepts, and an organisation accepts several, so picking more than one reads
 * as "any of these". A need on `/doniraj` has exactly one type, so there the
 * single-choice list is the honest control.
 */
export function DonationFilter({ value, onChange, multiple = false }: {
  value: DonationType[];
  onChange: (next: DonationType[]) => void;
  multiple?: boolean;
}) {
  const t = useT();
  const { locale } = useLocale();
  return <FilterDropdown
    label={t("needs_page.donation_type")}
    allLabel={t("filters.donation_any")}
    options={(Object.keys(DONATION_TYPES) as DonationType[]).map((key) => ({ value: key, label: locale === "hr" ? DONATION_TYPES[key].labelHr : DONATION_TYPES[key].label }))}
    value={value}
    onChange={onChange}
    multiple={multiple}
  />;
}
