import { DONATION_TYPES } from "@/lib/constants";
import type { DonationType } from "@/lib/types";

/**
 * Client-side text search over a list the page has already loaded (the open
 * needs on /doniraj, the upcoming events on /volunteer). It never reaches the
 * server, so the CDN-cached list responses stay one copy for everyone.
 *
 * Both sides are folded the same way: case, combining marks (č/ć → c, š → s,
 * ž → z) and đ, which has no canonical decomposition, so it is mapped by hand.
 * People also write đ as "dj" ("Djakovo"), so a text holding either spelling
 * is searchable by both. Every whitespace-separated term must match (AND).
 */

/** Longest query that is searched; anything after it is ignored. */
export const LIST_SEARCH_MAX_QUERY_LENGTH = 120;
/** At most this many terms are matched, so a pasted paragraph stays cheap. */
const MAX_TERMS = 8;

/** Lower-case, diacritic-free form; đ becomes d. */
export function foldSearchText(value: string): string {
  return value
    .toLocaleLowerCase("hr")
    .replace(/đ/g, "d")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/**
 * The folded text plus its alternative đ/dj spelling when it has one. The
 * variants are joined with a newline, which no term can contain, so a term
 * never matches across two of them.
 */
export function searchHaystack(fields: ReadonlyArray<string | null | undefined>): string {
  const text = fields.filter((field): field is string => typeof field === "string" && field.length > 0).join("\n");
  const variants = [foldSearchText(text)];
  if (/đ/i.test(text)) variants.push(foldSearchText(text.replace(/đ/g, "dj").replace(/Đ/g, "Dj")));
  if (variants[0].includes("dj")) variants.push(variants[0].replace(/dj/g, "d"));
  return variants.join("\n");
}

/** Folded, de-duplicated terms of a query; empty means "no search". */
export function searchTerms(query: string): string[] {
  const folded = foldSearchText(query.slice(0, LIST_SEARCH_MAX_QUERY_LENGTH));
  const terms = folded
    .split(/[\s,.;:!?()"'„“”‘’/\\-]+/u)
    .filter((term) => term.length > 0);
  return [...new Set(terms)].slice(0, MAX_TERMS);
}

/**
 * Croatian inflects nouns, so "higijena" should still find "Higijenske
 * potrepštine" and "hrana" should find "hrane". A term of four or more
 * letters ending in a vowel also matches without its trailing vowels, as
 * long as at least three letters remain. Deliberately light: no dictionary,
 * no per-word stemming of the text itself.
 */
function termForms(term: string): string[] {
  if (term.length < 4) return [term];
  const stem = term.replace(/[aeiou]+$/u, "");
  return stem !== term && stem.length >= 3 ? [term, stem] : [term];
}

/** True when every term (in any of its forms) occurs in the haystack. */
export function matchesSearch(haystack: string, terms: readonly string[]): boolean {
  return terms.every((term) => termForms(term).some((form) => haystack.includes(form)));
}

/**
 * The rows that match every term of `query`, in their original order. An
 * empty query returns the same array instance, so a caller's memo holds.
 */
export function filterBySearch<T>(
  rows: readonly T[],
  query: string,
  fields: (row: T) => ReadonlyArray<string | null | undefined>
): readonly T[] {
  const terms = searchTerms(query);
  if (terms.length === 0) return rows;
  return rows.filter((row) => matchesSearch(searchHaystack(fields(row)), terms));
}

type SearchableInstitution = { name?: string | null; city?: string | null } | null | undefined;

/** What a need on /doniraj is found by: its text, its organisation and both labels of its type. */
export function needSearchFields(need: {
  title?: string | null;
  description?: string | null;
  donation_type?: DonationType | string | null;
  institution?: SearchableInstitution;
}): Array<string | null | undefined> {
  const type =
    need.donation_type && Object.hasOwn(DONATION_TYPES, need.donation_type)
      ? DONATION_TYPES[need.donation_type as DonationType]
      : null;
  return [
    need.title,
    need.description,
    need.institution?.name,
    need.institution?.city,
    type?.labelHr,
    type?.label,
  ];
}

/** What a volunteer event is found by: its text, where it happens and who runs it. */
export function volunteerEventSearchFields(event: {
  title?: string | null;
  description?: string | null;
  location?: string | null;
  institution?: SearchableInstitution;
}): Array<string | null | undefined> {
  return [
    event.title,
    event.description,
    event.location,
    event.institution?.name,
    event.institution?.city,
  ];
}
