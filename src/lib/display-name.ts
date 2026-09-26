/**
 * An organisation's name as it reads inside a Croatian sentence.
 *
 * The register stores legal names in capitals ("UDRUGA ZA DIGITALNU
 * SOLIDARNOST DAJSRCE"), which shouts in the middle of a notification. Croatian
 * capitalises only the first word of a name (and proper nouns), so an
 * all-capitals name becomes sentence case, with the first letter inside
 * opening quotation marks capitalised, since that is usually the
 * organisation's own name. Tokens without a vowel or with a digit are kept as
 * written, as they are usually abbreviations ("DVD", "HGSS"). A place name
 * loses its capital; that is the known cost of not guessing. A name that
 * already has lowercase letters was written by a person and is left alone.
 */
const VOWELS = /[AEIOUaeiou]/;
const QUOTES = new Set(["\"", "'", "„", "“", "”", "«", "»", "‚", "‘", "’"]);

function isAbbreviation(token: string): boolean {
  const letters = token.replace(/[^\p{L}\p{N}]/gu, "");
  return letters.length > 0 && (/\d/.test(letters) || !VOWELS.test(letters));
}

export function displayOrganisationName(raw: string | null | undefined): string {
  const name = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!name || name !== name.toLocaleUpperCase("hr") || !/\p{Lu}/u.test(name)) return name;

  const lowered = name
    .split(" ")
    .map((word) => (isAbbreviation(word) ? word : word.toLocaleLowerCase("hr")))
    .join(" ");

  let result = "";
  // The name's first letter, and the first letter after a quotation mark
  // that opens a word (a closing one follows a letter, not a space).
  let capitalizeNext = true;
  let previous = " ";
  for (const character of lowered) {
    if (capitalizeNext && /\p{L}/u.test(character)) {
      result += character.toLocaleUpperCase("hr");
      capitalizeNext = false;
    } else {
      if (QUOTES.has(character) && previous === " ") capitalizeNext = true;
      result += character;
    }
    previous = character;
  }
  return result;
}
