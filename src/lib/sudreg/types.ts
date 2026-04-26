// Normalized response from SudReg's /detalji_subjekta endpoint, flattened
// to only the fields we use for verification.
//
// Source: GET https://sudreg-data.gov.hr/api/javni/detalji_subjekta
// Spec  : https://sudreg-data.gov.hr/api/javni/dokumentacija/open_api

export type SudregCompany = {
  oib: string;
  legalName: string;          // tvrtka.ime
  shortName: string | null;   // skracena_tvrtka.ime
  legalForm: string | null;   // pravni_oblik.vrsta_pravnog_oblika.naziv
  street: string | null;      // sjediste.ulica + kucni_broj
  city: string | null;        // sjediste.naziv_naselja
  county: string | null;      // sjediste.naziv_zupanije
  emails: string[];           // email_adrese[].adresa
  mb: string | null;
  mbs: string | null;
  status: number | null;      // 1 = active
  foundingDate: string | null;
  fetchedAt: string;          // ISO timestamp when we fetched
};

// Raw shape we pluck from. Optional fields throughout — SudReg returns
// different subsets per company.
export type RawDetaljiSubjekta = {
  oib?: string | number;
  potpuni_oib?: string;
  mb?: string | number;
  mbs?: string | number;
  potpuni_mbs?: string;
  status?: number;
  datum_osnivanja?: string;
  tvrtka?: { ime?: string };
  skracena_tvrtka?: { ime?: string };
  pravni_oblik?: { vrsta_pravnog_oblika?: { naziv?: string } };
  sjediste?: {
    ulica?: string;
    kucni_broj?: string | number;
    naziv_naselja?: string;
    naziv_zupanije?: string;
  };
  email_adrese?: Array<{ adresa?: string }>;
};
