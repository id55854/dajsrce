import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getLocale } from "@/i18n/server";
import {
  Code,
  DocLink,
  LegalDocument,
  LegalSection,
  LegalTable,
  MailLink,
  legalMetadata,
  type LegalTocEntry,
} from "@/components/legal/LegalDocument";

// Why there is no consent banner: every item below is either strictly
// necessary or remembers a choice the visitor made themselves (ZEK čl. 43.
// st. 4.). Adding analytics, a CAPTCHA, embedded media or any other
// third-party script changes that, and this page, the privacy policy and
// possibly a consent prompt have to change with it.

export const metadata: Metadata = legalMetadata({
  title: "Kolačići",
  description:
    "Koje kolačiće i lokalnu pohranu DajSrce koristi, zašto su nužni i kako njima upravljati. Ne koristimo kolačiće za oglašavanje, praćenje ni analitiku.",
  path: "/kolacici",
});

const SECTIONS = {
  storage: { id: "sto-se-pohranjuje", title: "Što se pohranjuje na vašem uređaju" },
  requests: {
    id: "drugi-posluzitelji",
    title: "Zahtjevi prema drugim poslužiteljima (bez kolačića)",
  },
  control: { id: "upravljanje-kolacicima", title: "Kako upravljati kolačićima" },
} satisfies Record<string, LegalTocEntry>;

// Names match the code: the Supabase project ref, `LOCALE_COOKIE`,
// ThemeToggle, AccessibilityMenu, use-map-start, the login page and
// chunk-reload. Rename one there and this table is wrong.
const STORAGE: readonly {
  name: ReactNode;
  kind: string;
  setWhen: string;
  purpose: string;
  lifetime: string;
}[] = [
  {
    name: (
      <>
        <Code>sb-wbxvpdbhddespdsscsnw-auth-token</Code> (može biti podijeljen u dijelove{" "}
        <Code>.0</Code>, <Code>.1</Code> …)
      </>
    ),
    kind: "kolačić (naš)",
    setWhen: "kad se prijavite",
    purpose: "održava vašu prijavu (sesiju)",
    lifetime: "do odjave, najdulje 400 dana",
  },
  {
    name: <Code>sb-wbxvpdbhddespdsscsnw-auth-token-code-verifier</Code>,
    kind: "kolačić (naš)",
    setWhen: "tijekom prijave Google računom ili potvrde e-adrese",
    purpose: "sigurnosna provjera postupka prijave",
    lifetime: "kratkotrajno; briše se po završetku prijave",
  },
  {
    name: <Code>locale</Code>,
    kind: "kolačić (naš)",
    setWhen: "kad promijenite jezik",
    purpose: "pamti odabrani jezik",
    lifetime: "1 godina",
  },
  {
    name: <Code>theme</Code>,
    kind: "lokalna pohrana",
    setWhen: "kad promijenite temu",
    purpose: "pamti svijetlu ili tamnu temu",
    lifetime: "dok ga ne obrišete",
  },
  {
    name: <Code>dajsrce-a11y</Code>,
    kind: "lokalna pohrana",
    setWhen: "kad promijenite postavke pristupačnosti",
    purpose: "pamti veličinu slova, kontrast i slične postavke",
    lifetime: "dok ga ne obrišete",
  },
  {
    name: <Code>dajsrce-map-start</Code>,
    kind: "lokalna pohrana",
    setWhen: "kad odaberete kako karta počinje",
    purpose: "da vas ne pitamo ponovno",
    lifetime: "dok ga ne obrišete",
  },
  {
    name: <Code>password-recovery-email</Code>,
    kind: "privremena pohrana (sessionStorage)",
    setWhen: "kad kliknete „Zaboravili ste lozinku?”",
    purpose: "prenosi upisanu e-adresu na obrazac za obnovu lozinke",
    lifetime: "briše se odmah nakon upotrebe ili zatvaranjem kartice",
  },
  {
    name: <Code>dajsrce:chunk-reload-at</Code>,
    kind: "privremena pohrana (sessionStorage)",
    setWhen: "nakon objave nove verzije stranice",
    purpose: "sprječava beskonačno ponovno učitavanje",
    lifetime: "do zatvaranja kartice",
  },
];

export default async function CookiesPage() {
  const locale = await getLocale();

  return (
    <LegalDocument
      locale={locale}
      title="Kolačići i slične tehnologije"
      effectiveFrom="primjenjuje se od"
      summary={
        <>
          <p>
            DajSrce koristi samo kolačiće i lokalnu pohranu u pregledniku koji su{" "}
            <strong>nužni za rad stranice</strong> ili pamte{" "}
            <strong>postavku koju ste sami odabrali</strong>. Ne koristimo kolačiće za
            oglašavanje, praćenje ni analitiku i ne postavljamo kolačiće trećih strana.
          </p>
          <p>
            Zato vas pri dolasku ne pitamo za privolu. Zakon o elektroničkim komunikacijama
            (članak 43. stavak 4.) dopušta pohranu koja je nužna za uslugu koju ste izričito
            zatražili.
          </p>
        </>
      }
    >
      <LegalSection entry={SECTIONS.storage}>
        <LegalTable
          label="Kolačići i lokalna pohrana na vašem uređaju"
          columns={["Naziv", "Vrsta", "Kada se postavlja", "Svrha", "Trajanje"]}
          rows={STORAGE.map((row) => [row.name, row.kind, row.setWhen, row.purpose, row.lifetime])}
          minWidthClass="min-w-[44rem]"
        />
      </LegalSection>

      <LegalSection entry={SECTIONS.requests}>
        <p>Da bi stranica radila, vaš preglednik se izravno povezuje i s ovim poslužiteljima:</p>
        <ul>
          <li>
            <strong>CARTO</strong>, a iznimno OpenStreetMap: slike karte;
          </li>
          <li>
            <strong>OpenStreetMap Nominatim</strong>: samo u alatu „Istraži mogućnosti”, kad
            dopustite lokaciju ili upišete adresu;
          </li>
          <li>
            <strong>Supabase</strong>: prijava;
          </li>
          <li>
            <strong>Neon</strong>: baza podataka, za prijavljene korisnike.
          </li>
        </ul>
        <p>
          Pritom tim poslužiteljima šalje vašu IP adresu i podatke o pregledniku. Oni ne postavljaju
          kolačiće. Više o tome pročitajte u{" "}
          <DocLink href="/pravila-privatnosti">Pravilima privatnosti</DocLink>.
        </p>
      </LegalSection>

      <LegalSection entry={SECTIONS.control}>
        <p>
          Kolačiće i lokalnu pohranu možete u svakom trenutku obrisati u postavkama preglednika.
          Ako obrišete kolačić za prijavu, bit ćete odjavljeni. Ako obrišete postavke, stranica će
          se vratiti na zadani jezik, temu i prikaz.
        </p>
      </LegalSection>

      <footer className="max-w-prose border-t border-border-subtle pt-6 text-base leading-7 text-ink-secondary">
        <p>
          Pitanja: <MailLink /> · UDRUGA ZA DIGITALNU SOLIDARNOST DAJSRCE, Rebro 38/16, 10360
          Sesvete, OIB 34669315869
        </p>
      </footer>
    </LegalDocument>
  );
}
