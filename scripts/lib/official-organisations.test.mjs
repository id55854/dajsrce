import { describe, expect, it } from "vitest";
import {
  firstEmail,
  fromCatholicRegister,
  fromFoundations,
  fromReligiousCommunities,
  fromSocialProviders,
  mergeOrganisations,
  normaliseOib,
  parseCsvObjects,
  parseRegisterDate,
  parseRnoExport,
  parseSeat,
} from "./official-organisations.mjs";

const CARITAS_OIB = "58633897145";
const SPLIT_OIB = "03089709484";

const CATHOLIC_CSV = `OIB,NAZIV,SBT_ID,STATUS,SJEDISTE,DATUM_UPISA,SLUZBA_OSOBE,DATUM_STATUSA,EVIDENCIJSKI_BROJ,BISKUPIJA_NADBISKUPIJA
${CARITAS_OIB},CARITAS ZAGREBAČKE NADBISKUPIJE,700945,AKTIVAN,"Zagreb, Babonićeva 121",7/19/2004 12:00:00 AM,Predsjednik ili ravnatelj Caritasa,,1.379,ZAGREBAČKA NADBISKUPIJA
,CARITAS SPLITSKO - MAKARSKE NADBISKUPIJE,700001,AKTIVAN,"Split, Poljana kneza Trpimira 7",1/1/2004 12:00:00 AM,Ravnatelj,,1.47,SPLITSKO-MAKARSKA NADBISKUPIJA
,ŽUPA SV. PETRA,700002,BRISAN,"Zagreb, Vlaška 93",1/1/2004 12:00:00 AM,Župnik,,1.500,ZAGREBAČKA NADBISKUPIJA`;

const FOUNDATIONS_CSV = `MAIL,NAZIV,SVRHA,SBT_ID,STATUS,SJEDISTE,DATUM_UPISA,OIB_ZAKLADE,WEB_STRANICA,DATUM_STATUSA,SKRACENI_NAZIV,REGISTARSKI_BROJ,TRAJANJE_ZAKLADE_MJESECI
info@zaklada.hr,ZAKLADA ČUJEM VJERUJEM VIDIM,"Svrha zaklade je pomoć,
u više redaka, ""s navodnicima"".",1011,AKTIVAN,"Zagreb, Ilica 1",9/25/2020 12:00:00 AM,93691731093,www.zaklada.hr,,ČVV,21000076,`;

const COMMUNITIES_CSV = `OIB,NAZIV,SBT_ID,STATUS,SJEDISTE,DATUM_UPISA,DATUM_STATUSA,EVIDENCIJSKI_BROJ,SLUZBA_OSOBE_OVLASTENE_ZA_ZASTUPANJE
36059542709,KRŠĆANSKA ADVENTISTIČKA CRKVA,700015,AKTIVNA,"Zagreb, Prilaz Gjure Deželića 77",9/25/2003 12:00:00 AM,,3,Predsjednik`;
const UNITS_CSV = `SBT_ID,STATUS,SJEDISTE,DATUM_UPISA,DATUM_STATUSA,EVIDENCIJSKI_BROJ,VJERSKA_ZAJEDNICA,OIB_ORGANIZACIJSKOG_OBLIKA,NAZIV_ORGANIZACIJSKOG_OBLIKA,SLUZBA_OSOBE_OVLASTENE_ZA_ZASTUPANJE
700251,AKTIVNA,"Lug, Crkvena ulica 4",2/20/2004 12:00:00 AM,,6.10,REFORMIRANA KRŠĆANSKA KALVINSKA CRKVA U HRVATSKOJ,79341976789,CRKVENA OPĆINA LUG,Župnik`;

const provider = (overrides) => ({
  isActive: true,
  name: "DOM ZA STARIJE OSOBE TRNJE",
  oib: "56787155320",
  regNo: 2,
  entryDate: "2001-09-17T00:00:00",
  headOfficeStreet: "Poljička ulica 12",
  number: null,
  city: { name: "Zagreb", postNumber: "10000", countyName: "Grad Zagreb" },
  serviceProviderType: { name: "Ustanova socijalne skrbi" },
  serviceProviderLegalStatus: { name: "Dom socijalne skrbi - Dom za starije osobe" },
  serviceProviderContact: [
    { contactType: "Telefon", value: "016151300" },
    { contactType: "E-mail", value: "dom@trnje.hr" },
  ],
  ...overrides,
});

const PROVIDERS = [
  provider({}),
  provider({
    name: "CARITAS ZAGREBAČKE NADBISKUPIJE",
    oib: CARITAS_OIB,
    regNo: 999,
    headOfficeStreet: "Babonićeva 121",
    serviceProviderType: { name: "Udruga, vjerska zajednica i druga pravna osoba" },
    serviceProviderLegalStatus: { name: "Pravna osoba Katoličke Crkve" },
    serviceProviderContact: [{ contactType: "E-mail", value: "socijalne.usluge@czn.hr" }],
  }),
  provider({
    name: "CARITAS SPLITSKO-MAKARSKE NADBISKUPIJE",
    oib: SPLIT_OIB,
    headOfficeStreet: "Poljana kneza Trpimira 7",
    city: { name: "Split", postNumber: "21000", countyName: "Splitsko-dalmatinska" },
    serviceProviderLegalStatus: { name: "Pravna osoba Katoličke Crkve" },
    serviceProviderContact: [],
  }),
  provider({ name: "DOM d.o.o.", oib: "12345678903", serviceProviderLegalStatus: { name: "Trgovačko društvo" } }),
  provider({
    name: "Ivana Horvat",
    oib: "69435151530",
    serviceProviderType: { name: "Fizička osoba kao profesionalna djelatnost" },
    serviceProviderLegalStatus: { name: "Fizička osoba" },
  }),
  provider({ name: "UDRUGA X", oib: "11111111119", serviceProviderLegalStatus: { name: "Udruga" } }),
  provider({ name: "ZATVORENI DOM", oib: "22222222226", isActive: false }),
];

// The real export is UTF-16LE with `$` between fields, and it also lists
// named people and bank accounts.
function rnoExport(rows) {
  const header = [
    "01. RNO broj", "02. Datum upisa u registar", "03. Datum brisanja iz registra", "07. OIB",
    "09. Pravno ustrojbeni oblik", "13. Adresa sjedišta", "14. Poštanski broj", "15. Mjesto",
    "20. Županija", "21. Telefon", "23. Email", "24. Web stranica", "25. Osoba za kontakt", "26. IBAN",
  ];
  const text = [header, ...rows].map((cells) => cells.join("$")).join("\r\n");
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
}

const RNO = rnoExport([
  ["0053015", "31.08.2009.", "", CARITAS_OIB, "PRAVNA OSOBA KATOLIČKE CRKVE", "BABONIĆEVA 121", "10000", "ZAGREB",
    "GRAD ZAGREB", "01 4817 716", "czn@czn.hr", "www.czn.hr", "Ivan Ivić", "HR1210010051863000160"],
  ["0099999", "01.01.2010.", "01.01.2020.", "56787155320", "USTANOVA", "X 1", "10000", "ZAGREB", "GRAD ZAGREB",
    "", "stari@dom.hr", "", "", ""],
]);

function allCandidates() {
  return [
    ...fromCatholicRegister(parseCsvObjects(CATHOLIC_CSV)),
    ...fromReligiousCommunities(parseCsvObjects(COMMUNITIES_CSV), parseCsvObjects(UNITS_CSV)),
    ...fromFoundations(parseCsvObjects(FOUNDATIONS_CSV)),
    ...fromSocialProviders(PROVIDERS),
  ];
}

describe("source parsing", () => {
  it("reads quoted fields that span lines", () => {
    const [row] = parseCsvObjects(FOUNDATIONS_CSV);
    expect(row.SVRHA).toBe('Svrha zaklade je pomoć,\nu više redaka, "s navodnicima".');
    expect(row.REGISTARSKI_BROJ).toBe("21000076");
  });

  it("splits the ministry registers' seat into place and street", () => {
    expect(parseSeat("Zagreb, Babonićeva 121")).toEqual({ city: "Zagreb", address: "Babonićeva 121" });
    expect(parseSeat("Lug")).toEqual({ city: "Lug", address: null });
  });

  it("reads both register date formats and rejects impossible dates", () => {
    expect(parseRegisterDate("7/19/2004 12:00:00 AM")).toBe("2004-07-19");
    expect(parseRegisterDate("31.08.2009.")).toBe("2009-08-31");
    expect(parseRegisterDate("2/30/2004")).toBeNull();
  });

  it("keeps valid OIBs and the first well-formed e-mail only", () => {
    expect(normaliseOib(CARITAS_OIB)).toBe(CARITAS_OIB);
    expect(normaliseOib("58633897146")).toBeNull();
    expect(firstEmail("nije adresa; Info@Caritas.hr, drugi@x.hr")).toBe("info@caritas.hr");
  });

  it("skips inactive Church bodies", () => {
    const rows = fromCatholicRegister(parseCsvObjects(CATHOLIC_CSV));
    expect(rows.map((row) => row.number)).toEqual(["1.379", "1.47"]);
    expect(rows[0].legal_form).toBe("Pravna osoba Katoličke Crkve (Zagrebačka nadbiskupija)");
  });

  it("takes only non-profit legal persons from the social-provider register", () => {
    const names = fromSocialProviders(PROVIDERS).map((row) => row.name);
    expect(names).toEqual([
      "DOM ZA STARIJE OSOBE TRNJE",
      "CARITAS ZAGREBAČKE NADBISKUPIJE",
      "CARITAS SPLITSKO-MAKARSKE NADBISKUPIJE",
    ]);
  });

  it("reads RNO's number and contacts but never its people or accounts", () => {
    const rno = parseRnoExport(RNO, new Set([CARITAS_OIB, "56787155320"]));
    expect([...rno.keys()]).toEqual([CARITAS_OIB]);
    const entry = rno.get(CARITAS_OIB);
    expect(entry).toEqual({
      number: "0053015",
      legal_form: "PRAVNA OSOBA KATOLIČKE CRKVE",
      address: "Babonićeva 121",
      postcode: "10000",
      city: "Zagreb",
      county: "Grad Zagreb",
      phone: "01 4817 716",
      email: "czn@czn.hr",
      website: "www.czn.hr",
    });
    expect(JSON.stringify(entry)).not.toMatch(/Ivić|HR12/);
  });
});

describe("mergeOrganisations", () => {
  const rows = mergeOrganisations(allCandidates(), parseRnoExport(RNO, null));
  const byId = new Map(rows.map((row) => [row.id, row]));

  it("keeps one Caritas row keyed by its Church register number with every register", () => {
    const caritas = byId.get("epokc:1.379");
    expect(caritas).toMatchObject({
      oib: CARITAS_OIB,
      name: "CARITAS ZAGREBAČKE NADBISKUPIJE",
      primary_register: "epokc",
      register_number: "1.379",
      address: "Babonićeva 121",
      city: "Zagreb",
      county: "Grad Zagreb",
      email: "czn@czn.hr",
      email_source: "rno",
      social_provider: true,
    });
    expect(caritas.registers).toEqual([
      { register: "epokc", number: "1.379" },
      { register: "mrosp", number: "999" },
      { register: "rno", number: "0053015" },
    ]);
    expect(rows.filter((row) => row.oib === CARITAS_OIB)).toHaveLength(1);
  });

  it("joins a Church body without an OIB to the provider row that has one", () => {
    const split = byId.get("epokc:1.47");
    expect(split.oib).toBe(SPLIT_OIB);
    expect(split.registers.map((entry) => entry.register)).toEqual(["epokc", "mrosp"]);
    expect(byId.has(`oib:${SPLIT_OIB}`)).toBe(false);
  });

  it("keys a provider found only in MROSP by its OIB", () => {
    expect(byId.get("oib:56787155320")).toMatchObject({
      primary_register: "mrosp",
      email: "dom@trnje.hr",
      email_source: "mrosp",
    });
  });

  it("keys organisational units by their dotted evidence number", () => {
    expect(byId.get("evz:6.10")).toMatchObject({
      name: "CRKVENA OPĆINA LUG",
      legal_form: "Organizacijski oblik vjerske zajednice (REFORMIRANA KRŠĆANSKA KALVINSKA CRKVA U HRVATSKOJ)",
    });
    expect(byId.get("evz:3").email).toBeNull();
  });

  it("makes every row searchable by name, OIB and register numbers", () => {
    expect(byId.get("epokc:1.379").search_text).toContain("0053015");
    expect(byId.get("zaklade:21000076").search_text).toContain("ČVV");
    for (const row of rows) {
      expect(row.id).toMatch(/^(epokc|evz|zaklade):[0-9][0-9.]{0,19}$|^oib:[0-9]{11}$/);
    }
  });
});
