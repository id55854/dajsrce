/**
 * The operating association's own registration details.
 *
 * Croatian associations must identify themselves by their registered name on
 * their public surfaces, so this is rendered in the footer of every ordinary
 * page and, in a compact one-line form, along the bottom of the map — which is
 * a full-viewport surface with no room for a footer. It is also the source for
 * the `/o-nama` page and its `Organization` structured data.
 *
 * One module so the three renderings can never drift apart. These are public
 * register facts, not secrets: `OIB` and `MB` are published in the official
 * register of associations.
 */
export const ORGANISATION = {
  /** Registered name, exactly as recorded in the register of associations. */
  legalName: "UDRUGA ZA DIGITALNU SOLIDARNOST DAJSRCE",
  /** The name the product is known by. */
  shortName: "DajSrce",
  address: {
    street: "Rebro 38/16",
    postalCode: "10360",
    city: "Sesvete",
    countryCode: "HR",
    country: { hr: "Hrvatska", en: "Croatia" },
  },
  /** Osobni identifikacijski broj — the Croatian tax identification number. */
  oib: "34669315869",
  /** Matični broj — the register of associations entry number. */
  registrationNumber: "06301436",
  /**
   * Public contact mailbox. Was deliberately `null` until a real, monitored
   * address existed — publishing an address nobody reads is worse than
   * publishing none. Now live; every surface that renders contact details
   * still checks for null so it fails closed again if this is ever unset.
   */
  contactEmail: "kontakt@dajsrce.hr" as string | null,
} as const;

export function organisationAddressLine(locale: "hr" | "en"): string {
  const { street, postalCode, city, country } = ORGANISATION.address;
  return `${street}, ${postalCode} ${city}, ${country[locale] ?? country.hr}`;
}

/**
 * `Organization` structured data for `/o-nama`.
 *
 * `taxID` carries the OIB because that is the identifier a Croatian reader
 * verifies against the public register; `identifier` carries the register
 * entry number.
 */
export function organisationJsonLd(locale: "hr" | "en", url: string) {
  const { street, postalCode, city, countryCode } = ORGANISATION.address;
  return {
    "@context": "https://schema.org",
    "@type": "NGO",
    name: ORGANISATION.legalName,
    alternateName: ORGANISATION.shortName,
    url,
    address: {
      "@type": "PostalAddress",
      streetAddress: street,
      postalCode,
      addressLocality: city,
      addressCountry: countryCode,
    },
    taxID: ORGANISATION.oib,
    identifier: ORGANISATION.registrationNumber,
    inLanguage: locale,
  };
}
