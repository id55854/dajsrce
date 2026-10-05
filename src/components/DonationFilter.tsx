"use client";

import type { DonationType } from "@/lib/types";
import { DONATION_TYPES } from "@/lib/constants";
import { useLocale, useT } from "@/i18n/client";
import { FilterDropdown } from "./FilterDropdown";

/**
 * Both public surfaces use it as a multi-select meaning "any of these": on the
 * map, organisations that accept any of the picked kinds of help; on
 * `/doniraj`, needs whose (single) type is any of the picked ones, sent as
 * `donation_types=a,b` to `/api/needs`. `multiple` stays the caller's choice
 * for any surface where only one type makes sense.
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
