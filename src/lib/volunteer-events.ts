import { format, parseISO } from "date-fns";
import { hr } from "date-fns/locale";

/**
 * Small facts about a volunteer event that the API, the cards, the dashboards
 * and the e-mails have to agree on: which calendar day it is in Croatia,
 * whether an event is over, where it happens and how an organisation's
 * register name reads inside a sentence.
 */

const ZAGREB = "Europe/Zagreb";

const DATE_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZAGREB,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const TIME_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZAGREB,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * Today's calendar date in Croatia, as YYYY-MM-DD. Event dates are plain
 * dates, so "today" must be the Croatian one: at 00:30 in Zagreb the UTC date
 * is still yesterday.
 */
export function zagrebToday(now: Date = new Date()): string {
  return DATE_FORMAT.format(now);
}

/** The wall-clock time in Croatia, as HH:MM. */
export function zagrebTime(now: Date = new Date()): string {
  return TIME_FORMAT.format(now);
}

/**
 * An event is over once its end time has passed in Croatia; a same-day event
 * stays open until then. Without an end time it lasts the whole day.
 */
export function hasVolunteerEventEnded(
  event: { event_date: string; end_time?: string | null },
  now: Date = new Date()
): boolean {
  const today = zagrebToday(now);
  if (event.event_date !== today) return event.event_date < today;
  const end = event.end_time?.slice(0, 5);
  return Boolean(end) && end! <= zagrebTime(now);
}

type TimedEvent = { event_date: string; start_time?: string | null; end_time?: string | null };

/** Soonest first, by day and then start time. */
function byEventStart(a: { event: TimedEvent | null }, b: { event: TimedEvent | null }): number {
  const left = `${a.event?.event_date ?? ""} ${a.event?.start_time ?? ""}`;
  const right = `${b.event?.event_date ?? ""} ${b.event?.start_time ?? ""}`;
  return left.localeCompare(right);
}

/**
 * A volunteer's signups split into upcoming ones, soonest first, and past
 * ones, latest first. This morning's event moves to the past as soon as it
 * finishes. A signup whose event cannot be read has nothing left to act on
 * and sits with the past ones.
 */
export function splitByEventTime<T extends { event: TimedEvent | null }>(
  signups: readonly T[],
  now: Date = new Date()
): { upcoming: T[]; past: T[] } {
  const upcoming: T[] = [];
  const past: T[] = [];
  for (const signup of signups) {
    (signup.event && !hasVolunteerEventEnded(signup.event, now) ? upcoming : past).push(signup);
  }
  upcoming.sort(byEventStart);
  past.sort((a, b) => byEventStart(b, a));
  return { upcoming, past };
}

function isLetter(character: string | undefined): boolean {
  return character !== undefined && /\p{L}/u.test(character);
}

/** True when `town` appears in `address` as a whole word ("Zagrebačka" is not "Zagreb"). */
function namesTown(address: string, town: string): boolean {
  const haystack = address.toLocaleLowerCase("hr");
  const needle = town.toLocaleLowerCase("hr");
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    if (!isLetter(haystack[at - 1]) && !isLetter(haystack[at + needle.length])) return true;
  }
  return false;
}

/**
 * "Ilica 1, Zagreb", without printing the city twice when the address already
 * names it: the register often stores "Rebro 38/16, Sesvete" next to the city
 * "Sesvete".
 */
export function addressWithCity(address?: string | null, city?: string | null): string {
  const street = address?.trim() ?? "";
  const town = city?.trim() ?? "";
  if (!town) return street;
  if (!street) return town;
  return namesTown(street, town) ? street : `${street}, ${town}`;
}

/**
 * Where a volunteer goes: the place the organisation typed for this event,
 * else the organisation's public address. Callers pass the public
 * projection, so a hidden location is already coarse here.
 */
export function volunteerEventPlace(
  location?: string | null,
  address?: string | null,
  city?: string | null
): string {
  return location?.trim() || addressWithCity(address, city);
}

/** Croatian prepositions and conjunctions that stay lowercase inside a name. */
const FUNCTION_WORDS = new Set([
  "a", "bez", "do", "i", "ili", "iz", "k", "ka", "kod", "kroz", "među", "na", "nad",
  "o", "od", "po", "pod", "pri", "protiv", "radi", "s", "sa", "te", "u", "uz", "za",
]);

/**
 * Register names are legal names in capitals ("UDRUGA ZA DIGITALNU
 * SOLIDARNOST DAJSRCE"), which read as shouting inside a sentence. A name with
 * no lowercase letter is recased word by word: Croatian function words go
 * lowercase, a word without vowels ("DVD", "HGSS") stays an abbreviation and
 * every other word is capitalised, so a place name is never lowercased. A
 * name typed in mixed case is left as it is.
 */
export function readableOrganisationName(name: string): string {
  const trimmed = name.replace(/\s+/g, " ").trim();
  if (!/\p{Lu}/u.test(trimmed) || /\p{Ll}/u.test(trimmed)) return trimmed;
  let first = true;
  return trimmed.replace(/\p{L}+/gu, (word) => {
    const lower = word.toLocaleLowerCase("hr");
    const isFirst = first;
    first = false;
    if (!isFirst && FUNCTION_WORDS.has(lower)) return lower;
    if (word.length <= 5 && !/[aeiou]/.test(lower)) return word;
    return lower.charAt(0).toLocaleUpperCase("hr") + lower.slice(1);
  });
}

/** "1. listopada 2026.", the date as a Croatian sentence says it. */
export function croatianDate(eventDate: string): string {
  return format(parseISO(eventDate), "d. MMMM yyyy.", { locale: hr });
}

/**
 * The in-app notice nearby opted-in volunteers get when an event is
 * published, in Croatian like the rest of the product.
 */
export function nearbyEventNotice(
  organisationName: string | null | undefined,
  title: string,
  eventDate: string
): { title: string; body: string } {
  const organisation = organisationName?.trim() ? readableOrganisationName(organisationName) : "Udruga";
  return {
    title: `Volonterski događaj: ${title}`,
    body: `${organisation} u vašoj blizini traži volontere za "${title}" ${croatianDate(eventDate)}`,
  };
}
