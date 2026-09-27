export const ASSOCIATION_DIRECTORY_API_VERSION = 1 as const;
export const ASSOCIATION_DIRECTORY_DEFAULT_PAGE_SIZE = 24;
export const ASSOCIATION_DIRECTORY_MAX_PAGE_SIZE = 100;

export const ASSOCIATION_DIRECTORY_SORTS = [
  "name_asc",
  "name_desc",
  "registered_desc",
  "registered_asc",
  "status_changed_desc",
] as const;

export type AssociationDirectorySort = typeof ASSOCIATION_DIRECTORY_SORTS[number];

export type AssociationDirectoryQuery = {
  query: string | null;
  status: string | null;
  county: string | null;
  city: string | null;
  form: string | null;
  sort: AssociationDirectorySort;
  page: number;
  pageSize: number;
};

export type AssociationDirectoryItem = {
  id: string;
  oib: string | null;
  name: string;
  short_name: string | null;
  status: string;
  address: string | null;
  city: string | null;
  county: string | null;
  registered_on: string | null;
  status_changed_on: string | null;
  registry_number: string | null;
  legal_form: string | null;
  email: string | null;
  website: string | null;
  last_verified_at: string | null;
};

export type AssociationDirectoryFacet = { value: string; count: number };

export type AssociationDirectoryResponse = {
  version: typeof ASSOCIATION_DIRECTORY_API_VERSION;
  items: AssociationDirectoryItem[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    pageCount: number;
  };
  facets: {
    total: number;
    statuses: AssociationDirectoryFacet[];
    counties: AssociationDirectoryFacet[];
    forms: AssociationDirectoryFacet[];
    snapshot: {
      metadata_modified: string | null;
      imported_at: string | null;
      source_file_hash: string | null;
      source_resource_id: string | null;
    } | null;
  };
};

export type AssociationRegistryEntry = {
  id: string;
  oib: string | null;
  name: string;
  short_name: string | null;
  status: string;
  goals: string | null;
  address: string | null;
  city: string | null;
  county: string | null;
  registered_on: string | null;
  website: string | null;
  email: string | null;
  status_changed_on: string | null;
  target_groups: string | null;
  activity_description: string | null;
  registry_number: string | null;
  legal_form: string | null;
  economic_activities: string | null;
  names_in_other_languages: string | null;
  founding_assembly_on: string | null;
  short_names_in_other_languages: string | null;
  last_verified_at: string | null;
  source_metadata_modified: string | null;
  /**
   * The reviewed classification of the register row (20260927100000);
   * `association` is the unclassified catch-all. Absent on an older schema.
   */
  category?: string | null;
  source: {
    publisher: string;
    dataset: string;
    dataset_url: string;
    license: string;
  };
};

/**
 * DajSrce is only for associations of a social character, so a public page or
 * API shows a register entry only when its row is classified into one of the
 * social categories. Unclassified (`association`) or unknown means not shown.
 * The claim flow reads entries without this filter, so every association can
 * still find and claim its own record.
 */
export function isSocialRegistryEntry(entry: Pick<AssociationRegistryEntry, "category">): boolean {
  return typeof entry.category === "string" && entry.category !== "" && entry.category !== "association";
}

export class AssociationDirectoryQueryError extends Error {
  constructor(public readonly issues: string[]) {
    super("Invalid association directory query");
  }
}

function optionalText(
  params: URLSearchParams,
  name: string,
  maxLength: number,
  issues: string[]
): string | null {
  const value = params.get(name)?.trim() || null;
  if (value && value.length > maxLength) issues.push(`${name} is too long`);
  return value;
}

function positiveInteger(
  raw: string | null,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
  issues: string[]
): number {
  if (raw == null || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) {
    issues.push(`${name} must be an integer`);
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (value < minimum || value > maximum) {
    issues.push(`${name} must be between ${minimum} and ${maximum}`);
    return fallback;
  }
  return value;
}

export function parseAssociationDirectoryQuery(
  params: URLSearchParams
): AssociationDirectoryQuery {
  const issues: string[] = [];
  const query = optionalText(params, "q", 100, issues);
  if (query && query.length < 2) issues.push("q must contain at least 2 characters");
  const status = optionalText(params, "status", 100, issues);
  const county = optionalText(params, "county", 100, issues);
  const city = optionalText(params, "city", 150, issues);
  const form = optionalText(params, "form", 150, issues);
  const rawSort = params.get("sort") || "name_asc";
  const sort = ASSOCIATION_DIRECTORY_SORTS.includes(rawSort as AssociationDirectorySort)
    ? rawSort as AssociationDirectorySort
    : "name_asc";
  if (sort !== rawSort) issues.push("sort is not supported");
  const page = positiveInteger(params.get("page"), 1, 1, 10_000, "page", issues);
  const pageSize = positiveInteger(
    params.get("pageSize"),
    ASSOCIATION_DIRECTORY_DEFAULT_PAGE_SIZE,
    1,
    ASSOCIATION_DIRECTORY_MAX_PAGE_SIZE,
    "pageSize",
    issues
  );

  if (issues.length > 0) throw new AssociationDirectoryQueryError(issues);
  return { query, status, county, city, form, sort, page, pageSize };
}

/**
 * The browser URL with every parameter the API would reject removed.
 *
 * A stale or hand-edited link (`?sort=newest`, `?q=x`, `?page=abc`) used to
 * reach the API as-is, get a 400, and be shown as "the official register is
 * temporarily unavailable". Dropping what is invalid answers the rest of the
 * query instead of blaming the service. Unknown parameters are left alone.
 */
export function sanitizeDirectoryParams(params: URLSearchParams): URLSearchParams {
  const clean = new URLSearchParams(params);
  const sort = clean.get("sort");
  if (sort != null && !ASSOCIATION_DIRECTORY_SORTS.includes(sort as AssociationDirectorySort)) {
    clean.delete("sort");
  }
  const query = clean.get("q")?.trim();
  if (query != null && (query.length < 2 || query.length > 100)) clean.delete("q");
  for (const [name, maxLength] of [["status", 100], ["county", 100], ["city", 150], ["form", 150]] as const) {
    if ((clean.get(name)?.trim().length ?? 0) > maxLength) clean.delete(name);
  }
  for (const [name, maximum] of [["page", 10_000], ["pageSize", ASSOCIATION_DIRECTORY_MAX_PAGE_SIZE]] as const) {
    const raw = clean.get(name);
    if (raw != null && !(/^\d+$/.test(raw) && Number(raw) >= 1 && Number(raw) <= maximum)) {
      clean.delete(name);
    }
  }
  return clean;
}

/**
 * The engaged subset: organisations from the official register that also have
 * an account here, optionally narrowed to those with something open.
 *
 * Kept as its own query rather than extra flags on the register search,
 * because the two answer different questions, "does this association exist"
 * versus "who can I help right now"; and the register's contract states that
 * presence in it is not organisational confirmation.
 */
export type EngagedDirectoryQuery = {
  query: string | null;
  county: string | null;
  city: string | null;
  onlyWithNeeds: boolean;
  onlyVerified: boolean;
  page: number;
  pageSize: number;
};

export type EngagedAssociationItem = AssociationDirectoryItem & {
  institution_id: string;
  is_verified: boolean;
  accepts_donations: string[];
  open_needs: number;
  urgent_needs: number;
};

export type EngagedDirectoryResponse = {
  version: typeof ASSOCIATION_DIRECTORY_API_VERSION;
  items: EngagedAssociationItem[];
  meta: { total: number; page: number; pageSize: number; pageCount: number };
};

function optionalBoolean(params: URLSearchParams, name: string, issues: string[]): boolean {
  const raw = params.get(name);
  if (raw == null || raw === "" || raw === "false" || raw === "0") return false;
  if (raw === "true" || raw === "1") return true;
  issues.push(`${name} must be true or false`);
  return false;
}

export function parseEngagedDirectoryQuery(params: URLSearchParams): EngagedDirectoryQuery {
  const issues: string[] = [];
  const query = optionalText(params, "q", 100, issues);
  if (query && query.length < 2) issues.push("q must contain at least 2 characters");
  const county = optionalText(params, "county", 100, issues);
  const city = optionalText(params, "city", 150, issues);
  const onlyWithNeeds = optionalBoolean(params, "withNeeds", issues);
  const onlyVerified = optionalBoolean(params, "verified", issues);
  const page = positiveInteger(params.get("page"), 1, 1, 10_000, "page", issues);
  const pageSize = positiveInteger(
    params.get("pageSize"),
    ASSOCIATION_DIRECTORY_DEFAULT_PAGE_SIZE,
    1,
    ASSOCIATION_DIRECTORY_MAX_PAGE_SIZE,
    "pageSize",
    issues
  );

  if (issues.length > 0) throw new AssociationDirectoryQueryError(issues);
  return { query, county, city, onlyWithNeeds, onlyVerified, page, pageSize };
}

export function engagedDirectoryRpcArgs(query: EngagedDirectoryQuery) {
  return {
    p_query: query.query,
    p_county: query.county,
    p_city: query.city,
    p_only_with_needs: query.onlyWithNeeds,
    p_only_verified: query.onlyVerified,
    p_page: query.page,
    p_page_size: query.pageSize,
  };
}

export function associationDirectoryRpcArgs(query: AssociationDirectoryQuery) {
  return {
    p_query: query.query,
    p_status: query.status,
    p_county: query.county,
    p_city: query.city,
    p_form: query.form,
    p_sort: query.sort,
    p_page: query.page,
    p_page_size: query.pageSize,
    // Browsing and searching alike stay within the twelve social categories:
    // DajSrce is only for associations of a social character, and the ~40,700
    // register rows the classifier placed in the `association` catch-all
    // (sports, culture, hobby; see 20260821150000_register_classified_only_
    // default.sql) are not shown anywhere. Associations still find their own
    // register entry to claim it through the claim search, which covers the
    // whole register.
    p_classified_only: true,
  };
}
