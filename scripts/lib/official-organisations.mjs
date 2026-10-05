// Official registers of organisations that are not associations, merged into
// the rows `upsert_official_organisations_batch` stores (20261005120000).
// Pure functions over downloaded text so the rules are testable; the CLI in
// scripts/sync-official-organisations.mjs does the I/O.
//
// Keys: the primary register's own number (`epokc:1.379`, `evz:6.10`,
// `zaklade:21000076`) or, for a social-care provider found only in MROSP,
// `oib:<OIB>`. One row per organisation: a later register with the same OIB
// adds itself to the first one's `registers` instead of making a second row.
// RNO only adds its number and published contacts to rows that already exist.
// No person's name, IBAN or natural-person provider is ever read into a row.

import { isValidOib } from "./oib.mjs";

/** CSV text to rows of cells. Quoted fields may hold the delimiter, doubled quotes and newlines. */
export function parseDelimited(text, delimiter = ",") {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = text.replace(/^﻿/, "");
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((cell) => cell !== "")) rows.push(row);
  return rows;
}

/** Header-keyed objects; header names are trimmed. */
export function parseCsvObjects(text, delimiter = ",") {
  const [header, ...rows] = parseDelimited(text, delimiter);
  if (!header) return [];
  const keys = header.map((name) => name.trim());
  return rows.map((cells) => Object.fromEntries(keys.map((key, index) => [key, (cells[index] ?? "").trim()])));
}

const clean = (value) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text === "" ? null : text;
};

export function normaliseOib(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length === 11 && isValidOib(digits) ? digits : null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** The first well-formed address in a field that may list several. */
export function firstEmail(value) {
  for (const part of String(value ?? "").split(/[;,\s]+/)) {
    const email = part.trim().toLowerCase().replace(/^mailto:/, "");
    if (email.length >= 5 && email.length <= 254 && EMAIL.test(email)) return email;
  }
  return null;
}

/** "Zagreb, Babonićeva 121" (the ministry registers' seat) to place and street. */
export function parseSeat(value) {
  const seat = clean(value);
  if (!seat) return { city: null, address: null };
  const comma = seat.indexOf(",");
  if (comma < 0) return { city: seat, address: null };
  return { city: clean(seat.slice(0, comma)), address: clean(seat.slice(comma + 1)) };
}

/** "7/19/2004 12:00:00 AM" (CTS exports) or "31.08.2009." (RNO) to "2004-07-19". */
export function parseRegisterDate(value) {
  const text = String(value ?? "").trim();
  let match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text);
  if (match) return isoDate(match[3], match[1], match[2]);
  match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(text);
  if (match) return isoDate(match[3], match[2], match[1]);
  match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (match) return isoDate(match[1], match[2], match[3]);
  return null;
}

function isoDate(year, month, day) {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (Number.isNaN(date.getTime()) || date.getUTCDate() !== Number(day)) return null;
  return date.toISOString().slice(0, 10);
}

// The Church register and Registar zaklada write AKTIVAN, the religious
// communities' register AKTIVNA.
const isActive = (status) => /^(AKTIVAN|AKTIVNA)$/i.test(String(status ?? "").trim());

// "GRAD ZAGREB" -> "Grad Zagreb"; RNO writes places in capitals.
export function titleCase(value) {
  const text = clean(value);
  if (!text) return null;
  if (text !== text.toLocaleUpperCase("hr")) return text;
  return text
    .toLocaleLowerCase("hr")
    .replace(/(^|[\s\-/(])(\p{L})/gu, (_, lead, letter) => lead + letter.toLocaleUpperCase("hr"));
}

// "ZAGREBAČKA NADBISKUPIJA" -> "Zagrebačka nadbiskupija".
function sentenceCase(value) {
  const text = clean(value);
  if (!text || text !== text.toLocaleUpperCase("hr")) return text;
  const lower = text.toLocaleLowerCase("hr");
  return lower.charAt(0).toLocaleUpperCase("hr") + lower.slice(1);
}

// Name or place compared across registers: no case, diacritics, spacing or
// punctuation ("SPLITSKO - MAKARSKE" and "Splitsko-makarske" are one name).
export function foldName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("hr")
    .replaceAll("đ", "d")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function evidenceNumber(value) {
  const number = String(value ?? "").trim().replace(/\.$/, "");
  return /^[0-9][0-9.]{0,19}$/.test(number) ? number : null;
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/** Evidencija pravnih osoba Katoličke Crkve (CTS CSV). */
export function fromCatholicRegister(rows) {
  const out = [];
  for (const row of rows) {
    const number = evidenceNumber(row.EVIDENCIJSKI_BROJ);
    const name = clean(row.NAZIV);
    if (!number || !name || !isActive(row.STATUS)) continue;
    const seat = parseSeat(row.SJEDISTE);
    const diocese = sentenceCase(row.BISKUPIJA_NADBISKUPIJA);
    out.push({
      register: "epokc",
      number,
      oib: normaliseOib(row.OIB),
      name,
      legal_form: diocese ? `Pravna osoba Katoličke Crkve (${diocese})` : "Pravna osoba Katoličke Crkve",
      registered_on: parseRegisterDate(row.DATUM_UPISA),
      address: seat.address,
      city: seat.city,
      extra_search: diocese,
    });
  }
  return out;
}

/** Evidencija vjerskih zajednica: the communities and their organisational units (CSV). */
export function fromReligiousCommunities(communities, units) {
  const out = [];
  for (const row of communities) {
    const number = evidenceNumber(row.EVIDENCIJSKI_BROJ);
    const name = clean(row.NAZIV);
    if (!number || !name || !isActive(row.STATUS)) continue;
    const seat = parseSeat(row.SJEDISTE);
    out.push({
      register: "evz",
      number,
      oib: normaliseOib(row.OIB),
      name,
      legal_form: "Vjerska zajednica",
      registered_on: parseRegisterDate(row.DATUM_UPISA),
      address: seat.address,
      city: seat.city,
    });
  }
  for (const row of units) {
    const number = evidenceNumber(row.EVIDENCIJSKI_BROJ);
    const name = clean(row.NAZIV_ORGANIZACIJSKOG_OBLIKA);
    if (!number || !name || !isActive(row.STATUS)) continue;
    const seat = parseSeat(row.SJEDISTE);
    const community = clean(row.VJERSKA_ZAJEDNICA);
    out.push({
      register: "evz",
      number,
      oib: normaliseOib(row.OIB_ORGANIZACIJSKOG_OBLIKA),
      name,
      legal_form: community
        ? `Organizacijski oblik vjerske zajednice (${community})`.slice(0, 200)
        : "Organizacijski oblik vjerske zajednice",
      registered_on: parseRegisterDate(row.DATUM_UPISA),
      address: seat.address,
      city: seat.city,
      extra_search: community,
    });
  }
  return out;
}

/** Registar zaklada (CTS CSV). */
export function fromFoundations(rows) {
  const out = [];
  for (const row of rows) {
    const number = String(row.REGISTARSKI_BROJ ?? "").trim();
    const name = clean(row.NAZIV);
    if (!/^[0-9]{1,20}$/.test(number) || !name || !isActive(row.STATUS)) continue;
    const seat = parseSeat(row.SJEDISTE);
    out.push({
      register: "zaklade",
      number,
      oib: normaliseOib(row.OIB_ZAKLADE),
      name,
      short_name: clean(row.SKRACENI_NAZIV),
      legal_form: "Zaklada",
      registered_on: parseRegisterDate(row.DATUM_UPISA),
      address: seat.address,
      city: seat.city,
      email: firstEmail(row.MAIL),
      email_source: "zaklade",
      website: clean(row.WEB_STRANICA),
    });
  }
  return out;
}

// MROSP legal statuses that are organisations of the kind DajSrce serves.
// Left out: associations (they claim by UDR_ID), companies, crafts and
// cooperatives (not non-profit), natural persons, local government and the
// state social-work institute (an authority, not a recipient).
const MROSP_EXCLUDED_STATUS = new Set([
  "Udruga",
  "Trgovačko društvo",
  "Obrt",
  "Fizička osoba",
  "Zadruga",
  "Jedinica lokalne samouprave",
  "Hrvatski zavod za socijalni rad",
]);
const MROSP_EXCLUDED_TYPE = new Set([
  "Fizička osoba kao profesionalna djelatnost",
  "Fizička osoba kao obrtnik",
  "Jedinica lokalne samouprave",
]);

function mrospContact(contacts, type) {
  for (const contact of contacts ?? []) {
    if (contact?.contactType === type && clean(contact.value)) return clean(contact.value);
  }
  return null;
}

/** MROSP Registar pružatelja socijalnih usluga (registar.json): legal persons only. */
export function fromSocialProviders(providers) {
  const out = [];
  for (const provider of providers ?? []) {
    if (!provider?.isActive) continue;
    const status = clean(provider.serviceProviderLegalStatus?.name);
    const type = clean(provider.serviceProviderType?.name);
    if (!status || MROSP_EXCLUDED_STATUS.has(status) || MROSP_EXCLUDED_TYPE.has(type)) continue;
    const oib = normaliseOib(provider.oib);
    const name = clean(provider.name);
    if (!oib || !name) continue;
    const street = clean([provider.headOfficeStreet, provider.number].filter(Boolean).join(" "));
    const emails = (provider.serviceProviderContact ?? [])
      .filter((contact) => contact?.contactType === "E-mail")
      .map((contact) => firstEmail(contact.value))
      .filter(Boolean);
    out.push({
      register: "mrosp",
      number: provider.regNo != null ? String(provider.regNo) : oib,
      oib,
      name,
      legal_form: status,
      registered_on: parseRegisterDate(provider.entryDate),
      address: street,
      city: clean(provider.city?.name),
      county: clean(provider.city?.countyName),
      postcode: clean(provider.city?.postNumber),
      email: emails[0] ?? null,
      email_source: "mrosp",
      website: mrospContact(provider.serviceProviderContact, "Web"),
      phone: mrospContact(provider.serviceProviderContact, "Telefon"),
      social_provider: true,
    });
  }
  return out;
}

// The RNO export columns this mirror reads, by their numbered headers. The
// export also lists named people and bank accounts; those columns are never
// looked up.
const RNO_COLUMNS = {
  number: /^\d+\.\s*RNO broj$/i,
  deleted: /^\d+\.\s*Datum brisanja/i,
  oib: /^\d+\.\s*OIB$/i,
  legalForm: /^\d+\.\s*Pravno ustrojbeni oblik$/i,
  address: /^\d+\.\s*Adresa sjedišta$/i,
  postcode: /^\d+\.\s*Poštanski broj$/i,
  city: /^\d+\.\s*Mjesto$/i,
  county: /^\d+\.\s*Županija$/i,
  phone: /^\d+\.\s*Telefon$/i,
  email: /^\d+\.\s*Email$/i,
  website: /^\d+\.\s*Web stranica$/i,
};

/**
 * RNO's "CSV izvoz" (UTF-16LE, `$`-separated, or UTF-8 `;` for a one-OIB
 * export) to a map from OIB to its number and published contacts, for the
 * OIBs asked for only; deleted organisations are skipped.
 */
export function parseRnoExport(buffer, wantedOibs) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe;
  const text = new TextDecoder(utf16 ? "utf-16le" : "utf-8").decode(bytes);
  const firstLine = text.slice(0, text.search(/\r?\n/));
  const delimiter = firstLine.includes("$") ? "$" : ";";
  const [header, ...rows] = parseDelimited(text, delimiter);
  if (!header) return new Map();
  const index = {};
  for (const [key, pattern] of Object.entries(RNO_COLUMNS)) {
    index[key] = header.findIndex((name) => pattern.test(name.trim()));
    if (index[key] < 0) throw new Error(`RNO export has no column for ${key}`);
  }
  const out = new Map();
  for (const cells of rows) {
    const oib = normaliseOib(cells[index.oib]);
    if (!oib || (wantedOibs && !wantedOibs.has(oib))) continue;
    if (clean(cells[index.deleted])) continue;
    out.set(oib, {
      number: clean(cells[index.number]),
      legal_form: clean(cells[index.legalForm]),
      address: titleCase(cells[index.address]),
      postcode: clean(cells[index.postcode]),
      city: titleCase(cells[index.city]),
      county: titleCase(cells[index.county]),
      phone: clean(cells[index.phone]),
      email: firstEmail(cells[index.email]),
      website: clean(cells[index.website]),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

const PRIMARY_ORDER = ["epokc", "evz", "zaklade", "mrosp"];

function keyOf(candidate) {
  return candidate.register === "mrosp" ? `oib:${candidate.oib}` : `${candidate.register}:${candidate.number}`;
}

/**
 * Candidates from every register to one row per organisation, ready for
 * `upsert_official_organisations_batch`. Rows sharing an OIB merge into the
 * one from the earliest register in PRIMARY_ORDER; a repeated key keeps the
 * first. RNO adds its number and contacts by OIB.
 */
export function mergeOrganisations(candidates, rno = new Map()) {
  const ordered = [...candidates].sort(
    (a, b) => PRIMARY_ORDER.indexOf(a.register) - PRIMARY_ORDER.indexOf(b.register)
  );
  const byKey = new Map();
  const byOib = new Map();
  // Rows without an OIB, by folded name and place: the Church register omits
  // the OIB of some bodies MROSP lists with one (Caritas Split, Šibenik).
  const unnumbered = new Map();
  const nameKey = (candidate) =>
    candidate.city ? `${foldName(candidate.name)}|${foldName(candidate.city)}` : null;
  for (const candidate of ordered) {
    let existing = (candidate.oib && byOib.get(candidate.oib)) || null;
    if (!existing && candidate.oib && nameKey(candidate)) {
      existing = unnumbered.get(nameKey(candidate)) ?? null;
      if (existing) {
        unnumbered.delete(nameKey(candidate));
        existing.oib = candidate.oib;
        byOib.set(candidate.oib, existing);
      }
    }
    if (existing) {
      absorb(existing, candidate);
      continue;
    }
    const key = keyOf(candidate);
    if (byKey.has(key)) continue;
    const row = {
      id: key,
      oib: candidate.oib ?? null,
      name: candidate.name,
      short_name: candidate.short_name ?? null,
      legal_form: candidate.legal_form,
      primary_register: candidate.register,
      register_number: candidate.number,
      status: "active",
      registered_on: candidate.registered_on ?? null,
      address: candidate.address ?? null,
      city: candidate.city ?? null,
      county: candidate.county ?? null,
      postcode: candidate.postcode ?? null,
      email: null,
      email_source: null,
      website: candidate.website ?? null,
      phone: candidate.phone ?? null,
      social_provider: Boolean(candidate.social_provider),
      registers: [{ register: candidate.register, number: candidate.number }],
      _emails: {},
      _search: [candidate.extra_search].filter(Boolean),
    };
    if (candidate.email) row._emails[candidate.email_source] = candidate.email;
    byKey.set(key, row);
    if (row.oib) byOib.set(row.oib, row);
    else if (nameKey(candidate) && !unnumbered.has(nameKey(candidate))) {
      unnumbered.set(nameKey(candidate), row);
    }
  }

  for (const row of byKey.values()) {
    const entry = row.oib ? rno.get(row.oib) : null;
    if (entry) {
      if (entry.number) row.registers.push({ register: "rno", number: entry.number });
      if (entry.email) row._emails.rno = entry.email;
      row.website ??= entry.website;
      row.phone ??= entry.phone;
      row.county ??= entry.county;
      row.postcode ??= entry.postcode;
      if (!row.address && entry.address) {
        row.address = entry.address;
        row.city = entry.city ?? row.city;
      }
    }
    // The address a register publishes for its mailbox, most trusted first:
    // RNO's is what the organisation reports to the Ministry of Finance.
    for (const source of ["rno", "mrosp", "zaklade"]) {
      if (row._emails[source]) {
        row.email = row._emails[source];
        row.email_source = source;
        break;
      }
    }
    row.search_text = [
      row.name,
      row.short_name,
      row.oib,
      ...row.registers.map((entry) => entry.number),
      row.city,
      ...row._search,
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 2000);
    delete row._emails;
    delete row._search;
  }
  return [...byKey.values()];
}

function absorb(row, candidate) {
  if (!row.registers.some((entry) => entry.register === candidate.register)) {
    row.registers.push({ register: candidate.register, number: candidate.number });
  }
  if (candidate.email && !row._emails[candidate.email_source]) {
    row._emails[candidate.email_source] = candidate.email;
  }
  // MROSP writes the seat in mixed case with its county; the ministry
  // registers do not name a county at all.
  if (candidate.register === "mrosp") {
    row.social_provider = true;
    if (candidate.address) row.address = candidate.address;
    if (candidate.city) row.city = candidate.city;
    row.county = candidate.county ?? row.county;
    row.postcode = candidate.postcode ?? row.postcode;
  }
  row.short_name ??= candidate.short_name ?? null;
  row.website ??= candidate.website ?? null;
  row.phone ??= candidate.phone ?? null;
  if (candidate.extra_search) row._search.push(candidate.extra_search);
}
