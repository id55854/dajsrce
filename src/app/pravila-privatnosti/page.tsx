import type { Metadata } from "next";
import { getLocale } from "@/i18n/server";
import {
  DocLink,
  ExternalLink,
  LegalDocument,
  LegalSection,
  LegalSubsection,
  LegalTable,
  MailLink,
  legalMetadata,
  type LegalTocEntry,
} from "@/components/legal/LegalDocument";

// The invitation e-mail to associations links here, so this page has to be
// true as published. Every statement below describes processing that exists;
// change the text in the same commit as the processing it describes.

export const metadata: Metadata = legalMetadata({
  title: "Pravila privatnosti",
  description:
    "Kako DajSrce obrađuje osobne podatke: koje podatke prikupljamo i zašto, tko ih prima, koliko ih dugo čuvamo i kako ostvariti svoja prava.",
  path: "/pravila-privatnosti",
});

const PROCESSING = {
  visit: { id: "posjet-stranici", title: "2.1. Posjet stranici" },
  map: { id: "karta-i-lokacija", title: "2.2. Karta, lokacija i pretraživanje" },
  account: { id: "korisnicki-racun", title: "2.3. Registracija i korisnički račun" },
  associations: { id: "racuni-udruga", title: "2.4. Računi udruga i potvrda udruge" },
  pledges: { id: "obecanja-i-prijave", title: "2.5. Obećanja pomoći i volonterske prijave" },
  notices: { id: "obavijesti-i-e-poruke", title: "2.6. Obavijesti i e-poruke" },
  publicContent: { id: "javni-sadrzaj-udruga", title: "2.7. Javno objavljeni sadržaj udruga" },
  registry: {
    id: "registar-udruga",
    title: "2.8. Podaci iz Registra udruga (obavijest prema članku 14. Opće uredbe)",
  },
  outreach: { id: "poziv-udrugama", title: "2.9. Poziv udrugama da preuzmu profil" },
  reports: { id: "prijave-sadrzaja", title: "2.10. Prijave sadržaja, upiti i zahtjevi" },
  security: { id: "sigurnost", title: "2.11. Sigurnost i evidencija radnji" },
  nearby: { id: "obavijesti-u-blizini", title: "2.12. Obavijesti o potrebama u blizini" },
} satisfies Record<string, LegalTocEntry>;

const SECTIONS = {
  controller: { id: "voditelj-obrade", title: "1. Tko obrađuje vaše podatke" },
  processing: {
    id: "podaci-i-svrhe",
    title: "2. Koje podatke obrađujemo, zašto i na kojoj osnovi",
    children: Object.values(PROCESSING),
  },
  recipients: { id: "primatelji", title: "3. Tko prima vaše podatke" },
  transfers: {
    id: "prijenos-izvan-egp",
    title: "4. Prijenos podataka izvan Europskoga gospodarskog prostora",
  },
  retention: { id: "rokovi-cuvanja", title: "5. Koliko dugo čuvamo podatke" },
  rights: { id: "vasa-prava", title: "6. Vaša prava" },
  minors: { id: "djeca", title: "7. Djeca i maloljetnici" },
  automated: { id: "automatizirano-odlucivanje", title: "8. Automatizirano odlučivanje" },
  protection: { id: "zastita-podataka", title: "9. Kako štitimo podatke" },
  cookies: { id: "kolacici", title: "10. Kolačići" },
  changes: { id: "izmjene", title: "11. Izmjene ovih pravila" },
} satisfies Record<string, LegalTocEntry>;

const TOC: readonly LegalTocEntry[] = Object.values(SECTIONS);

const RECIPIENTS = [
  [
    "Udruga kojoj ste se javili",
    "zaseban voditelj obrade",
    "ime, e-adresa i podaci o obećanju ili prijavi, radi dogovora",
    "Hrvatska",
  ],
  [
    "Supabase, Inc.",
    "izvršitelj obrade",
    "prijava i račun, e-poruke za potvrdu adrese i obnovu lozinke",
    "podaci su pohranjeni u EU (Irska); tvrtka je iz SAD-a, prijenos je zaštićen standardnim ugovornim klauzulama",
  ],
  [
    "Neon (Databricks, Inc.)",
    "izvršitelj obrade",
    "baza podataka platforme",
    "EU (Frankfurt); Okvir EU-a i SAD-a za privatnost podataka i standardne ugovorne klauzule; pojedini podizvršitelji su u SAD-u",
  ],
  [
    "Vercel Inc.",
    "izvršitelj obrade",
    "hosting, isporuka stranica i tehnički zapisi",
    "aplikacija radi u EU (Frankfurt), a mreža za isporuku sadržaja i u drugim državama; Okvir EU-a i SAD-a i standardne ugovorne klauzule",
  ],
  [
    "Resend",
    "izvršitelj obrade",
    "slanje e-poruka za potvrdu udruge, potvrde volonterske prijave i podsjetnika",
    "SAD; Okvir EU-a i SAD-a",
  ],
  [
    "Google (Google Workspace)",
    "izvršitelj obrade",
    "e-pošta na kontakt@dajsrce.hr: vaši upiti i zahtjevi te naši odgovori i pozivi udrugama",
    "EU i SAD; Okvir EU-a i SAD-a i standardne ugovorne klauzule",
  ],
  [
    "CARTO (CartoDB Inc.)",
    "izvršitelj obrade",
    "prikaz slika karte; IP adresa se skraćuje, a zapisi se čuvaju 30 dana",
    "SAD; standardne ugovorne klauzule i Okvir EU-a i SAD-a",
  ],
  [
    "GitHub, Inc.",
    "izvršitelj obrade",
    "izvršavanje zakazanih zadataka, uključujući usklađivanje s Registrom udruga",
    "SAD; Okvir EU-a i SAD-a",
  ],
  [
    "TypeSafe AI",
    "pružatelj usluge razvrstavanja",
    "naziv i opis djelatnosti udruge iz javnog Registra udruga, bez e-adresa, adresa i podataka o korisnicima DajSrca",
    "Podaci o korisnicima DajSrca ovom se pružatelju ne šalju.",
  ],
  ["Google", "zaseban voditelj obrade", "prijava Google računom", "Okvir EU-a i SAD-a"],
  [
    "OpenStreetMap Foundation",
    "zaseban voditelj obrade",
    "Nominatim (pretvaranje adrese i lokacije) te rezervne slike karte",
    "Ujedinjena Kraljevina; odluka Europske komisije o primjerenosti vrijedi do 27. 12. 2031.",
  ],
  [
    "Nadležna tijela",
    "nije primjenjivo",
    "kad to zakon zahtijeva, npr. na temelju sudskog naloga ili kad policiji dojavljujemo sumnju na kazneno djelo koje ugrožava život ili sigurnost (članak 18. Akta o digitalnim uslugama)",
    "Hrvatska",
  ],
] as const;

const RETENTION = [
  [
    "Račun i profil",
    "dok postoji račun; nakon zahtjeva za brisanje brišemo ih u roku od 30 dana, a iz sigurnosnih kopija nestaju istekom razdoblja čuvanja kopija, koje traje najviše 30 dana",
  ],
  [
    "Obećanja i volonterske prijave",
    "povučena obećanja i odjavljene prijave 12 mjeseci od povlačenja, a ostala 24 mjeseca nakon zatvaranja potrebe ili završetka događaja",
  ],
  ["Obavijesti u aplikaciji", "12 mjeseci"],
  [
    "Zahtjevi za preuzimanje udruge",
    "odobreni: dok je račun povezan s udrugom i još 3 godine; odbijeni i povučeni: 12 mjeseci",
  ],
  ["Evidencija radnji", "3 godine; identifikator računa uklanja se brisanjem računa"],
  ["Tehnički zapisi hostinga", "najviše nekoliko dana"],
  ["Zapisi pružatelja karte CARTO", "30 dana (prema uvjetima CARTO-a)"],
  ["Prijave sadržaja, upiti i prepiska", "3 godine od zatvaranja predmeta"],
  ["Popis adresa za odjavu", "dok je potreban da bismo poštovali vaš zahtjev"],
  ["Podaci iz Registra udruga", "dok je udruga u registru upisana kao aktivna"],
] as const;

export default async function PrivacyPolicyPage() {
  const locale = await getLocale();

  return (
    <LegalDocument
      locale={locale}
      title="Pravila privatnosti"
      subtitle="DajSrce: platforma za povezivanje donatora, volontera i udruga"
      effectiveFrom="primjenjuje se od"
      toc={TOC}
      summary={
        <ul>
          <li>
            Vaše podatke ne prodajemo. Ne prikazujemo oglase i ne koristimo kolačiće za
            praćenje.
          </li>
          <li>
            Za račun su nam potrebni samo ime i prezime te e-adresa. Vašu lozinku ne vidimo.
          </li>
          <li>
            Kad obećate pomoć ili se prijavite za volontiranje, udruga kojoj ste se javili vidi
            vaše ime i e-adresu kako bi se s vama mogla dogovoriti. Drugi korisnici ih ne vide.
          </li>
          <li>
            Vašu lokaciju koristimo samo kad to sami zatražite, za prikaz karte ili udruga u
            blizini, i ne spremamo je.
          </li>
          <li>
            Brisanje računa, kopiju svojih podataka ili ispravak možete zatražiti na{" "}
            <MailLink />.
          </li>
        </ul>
      }
    >
      <LegalSection entry={SECTIONS.controller}>
        <p>Voditelj obrade je:</p>
        <address className="not-italic">
          <strong>UDRUGA ZA DIGITALNU SOLIDARNOST DAJSRCE</strong> (u daljnjem tekstu: DajSrce
          ili mi)
          <br />
          Rebro 38/16, 10360 Sesvete, Hrvatska
          <br />
          OIB: 34669315869
          <br />
          Upisana u Registar udruga Republike Hrvatske, registarski broj 21015617 · matični broj
          06301436
          <br />
          E-adresa za sva pitanja o osobnim podacima: <MailLink />
        </address>
        <p>
          DajSrce je neprofitna udruga koju vode volonteri. Službenika za zaštitu podataka nismo
          imenovali jer za nas to nije obvezno (članak 37. Opće uredbe o zaštiti podataka). Na
          svaki upit o osobnim podacima odgovaramo s gore navedene adrese.
        </p>
        <p>
          Ova pravila vrijede za stranicu dajsrce.hr i sve njezine dijelove. „Opća uredba” znači
          Uredba (EU) 2016/679 (GDPR).
        </p>
      </LegalSection>

      <LegalSection entry={SECTIONS.processing}>
        <LegalSubsection entry={PROCESSING.visit}>
          <p>
            <strong>Podaci:</strong> IP adresa, datum i vrijeme, zatražena stranica, podaci o
            pregledniku i uređaju te stranica s koje dolazite. Vaš preglednik te podatke
            automatski šalje pri svakom posjetu.
          </p>
          <p>
            <strong>Svrha:</strong> isporuka stranice, zaštita od zlouporabe i otklanjanje
            pogrešaka. Primjerice, broj zahtjeva s iste IP adrese ograničavamo samo u radnoj
            memoriji poslužitelja. Naši zapisi o pogreškama ne sadrže IP adrese, e-adrese ni
            imena, nego samo nasumični identifikator zahtjeva.
          </p>
          <p>
            <strong>Osnova:</strong> legitimni interes za siguran i dostupan rad usluge (članak 6.
            stavak 1. točka (f) Opće uredbe).
          </p>
          <p>
            <strong>Tko ih obrađuje:</strong> naš pružatelj hostinga Vercel, u kratkotrajnim
            tehničkim zapisima, koji se čuvaju najviše nekoliko dana.
          </p>
        </LegalSubsection>

        <LegalSubsection entry={PROCESSING.map}>
          <ul>
            <li>
              <strong>„Pronađi me” i „Prikaži udruge blizu mene”:</strong> preglednik vas najprije
              pita za dopuštenje. Ako ga date, koordinate se koriste samo u vašem pregledniku,
              kako bi se karta pomaknula na vaše područje. Ne šaljemo ih na naše poslužitelje i ne
              pohranjujemo ih.
            </li>
            <li>
              Karta zatim od našeg poslužitelja traži popis udruga za{" "}
              <strong>prikazano područje</strong> (zaokruženi okvir karte, a ne vaše koordinate).
              Slike karte vaš preglednik dohvaća izravno od tvrtke CARTO, a iznimno od
              OpenStreetMapa. Iz tih se zahtjeva može zaključiti koje područje gledate. Središte i
              povećanje karte upisujemo u adresu stranice kako biste prikaz mogli spremiti ili
              podijeliti. Ako tu adresu nekome pošaljete, iz nje se vidi prikazano područje.
            </li>
            <li>
              <strong>„Istraži mogućnosti” (na stranici Doniraj):</strong> ako dopustite lokaciju,
              vaš preglednik šalje približne koordinate (zaokružene na otprilike jedan kilometar)
              servisu OpenStreetMap Nominatim (OpenStreetMap Foundation, Ujedinjena Kraljevina)
              kako bi vam prikazao približnu adresu. Ako umjesto toga upišete naselje ili adresu,
              preglednik taj upit šalje istom servisu radi pronalaska lokacije. Zatim preglednik
              od našeg poslužitelja traži popis udruga za šire područje oko te lokacije. DajSrce
              te podatke ne pohranjuje.
            </li>
          </ul>
          <p>
            <strong>Osnova:</strong> izvršavanje usluge koju ste zatražili (članak 6. stavak 1.
            točka (b)) i legitimni interes za prikaz karte (točka (f)). Pristup lokaciji na
            uređaju uvijek ovisi o dopuštenju koje date u pregledniku, a u postavkama preglednika
            možete ga i povući.
          </p>
        </LegalSubsection>

        <LegalSubsection entry={PROCESSING.account}>
          <p>
            <strong>Podaci:</strong> ime i prezime, e-adresa, lozinka, uloga koju odaberete
            (pojedinac ili udruga), jezik sučelja te datum otvaranja računa i prihvaćanja Uvjeta
            korištenja. Lozinku ne vidimo i ne pohranjujemo. Obrađuje je naš pružatelj
            autentikacije Supabase, koji je čuva samo kao jednosmjerni kriptografski sažetak
            (bcrypt).
          </p>
          <p>
            <strong>Prijava putem Googlea:</strong> ako se prijavite Google računom, od Googlea
            primamo ime, e-adresu, identifikator računa i poveznicu na profilnu sliku (profilnu
            sliku ne prikazujemo). Za samu prijavu Google je zaseban voditelj obrade i primjenjuju
            se njegova pravila privatnosti.
          </p>
          <p>
            <strong>Svrha:</strong> otvaranje i vođenje računa, prijava, obnova lozinke i zaštita
            računa.
          </p>
          <p>
            <strong>Osnova:</strong> izvršavanje ugovora, odnosno{" "}
            <DocLink href="/uvjeti-koristenja">Uvjeta korištenja</DocLink> (članak 6. stavak 1.
            točka (b)). Za mjere zaštite računa osnova je legitimni interes (točka (f)).
          </p>
        </LegalSubsection>

        <LegalSubsection entry={PROCESSING.associations}>
          <p>
            Profil udruge može voditi samo osoba koju odobrimo nakon što zahtjev provjerimo prema
            službenom Registru udruga.
          </p>
          <p>
            <strong>Podaci:</strong> odabrana udruga (njezin identifikator UDR_ID iz registra),
            službena e-adresa udruge koju navedete, vaše obrazloženje (neobavezno), stanje
            zahtjeva, podatak je li e-adresa potvrđena te odluka i napomena administratora.
          </p>
          <p>
            <strong>Poruka za potvrdu:</strong> na e-adresu koju Registar udruga objavljuje za tu
            udrugu šaljemo poveznicu za potvrdu. U poruci navodimo vaše ime i naziv udruge kako bi
            udruga mogla prepoznati zahtjev. Samu poveznicu ne pohranjujemo, nego samo njezin
            kriptografski sažetak, i to dok se poveznica ne iskoristi ili ne istekne.
          </p>
          <p>
            <strong>Svrha:</strong> spriječiti lažno predstavljanje u ime udruga te zaštititi
            udruge i donatore.
          </p>
          <p>
            <strong>Osnova:</strong> izvršavanje ugovora (točka (b)) i legitimni interes za
            sprječavanje prijevara (točka (f)).
          </p>
        </LegalSubsection>

        <LegalSubsection entry={PROCESSING.pledges}>
          <p>
            <strong>Podaci o obećanju:</strong> potreba na koju se javljate, količina, neobavezna
            procijenjena vrijednost u eurima, neobavezna poruka i vrijeme. Ako obećanje povučete,
            bilježimo i vrijeme povlačenja.
          </p>
          <p>
            <strong>Podaci o volonterskoj prijavi:</strong> događaj i vrijeme prijave. Ako se
            odjavite, bilježimo i vrijeme odjave.
          </p>
          <p>
            <strong>Što vidi udruga kojoj ste se javili:</strong> vaše ime i prezime, e-adresu,
            što ste obećali ili na koji ste se događaj prijavili i kada. Udruga vidi i poruku koju
            ste napisali uz obećanje. Udruga dobiva i obavijest u aplikaciji u kojoj je navedeno
            vaše ime.
          </p>
          <p>
            <strong>Kako udruga koristi podatke:</strong> udruga ih koristi samostalno, kao
            zaseban voditelj obrade, radi dogovora o predaji pomoći ili o volontiranju. Koristi ih
            i za obveze koje ima kao organizator volontiranja, primjerice za ugovor ili potvrdu o
            volontiranju. <DocLink href="/uvjeti-koristenja">Uvjetima korištenja</DocLink>{" "}
            obvezali smo udruge da vaše podatke ne koriste u druge svrhe.
          </p>
          <p>
            <strong>Osnova:</strong> izvršavanje usluge koju ste zatražili (članak 6. stavak 1.
            točka (b)).
          </p>
          <p>Molimo vas da u poruke ne upisujete zdravstvene ni druge osjetljive podatke.</p>
        </LegalSubsection>

        <LegalSubsection entry={PROCESSING.notices}>
          <ul>
            <li>
              <strong>Obavijesti u aplikaciji.</strong> Pojedinci dobivaju, primjerice, potvrdu
              obećanja ili prijave, podsjetnik dan prije volonterskog događaja i obavijest da je
              udruga uklonila potrebu ili događaj na koji su se javili. Udruge dobivaju obavijest
              o novom ili povučenom obećanju i o novoj ili otkazanoj prijavi. I o zahtjevima za
              preuzimanje udruge obavještavamo u aplikaciji: administratori DajSrca dobivaju
              obavijest o novom zahtjevu, a podnositelj zahtjeva obavijest o tome je li zahtjev
              odobren ili odbijen.
            </li>
            <li>
              <strong>E-poruke.</strong> Putem usluge Resend šaljemo poruku za potvrdu udruge,
              potvrdu nakon prijave na volonterski događaj i podsjetnik dan prije događaja. Poruke
              za obnovu lozinke, kao i poruke za potvrdu e-adrese kad je ta potvrda uključena,
              šalje Supabase putem našeg poslužitelja e-pošte.
            </li>
            <li>
              Korisnicima ne šaljemo promotivne e-poruke. Ako to ikad uvedemo, činit ćemo to samo
              u skladu s propisima: uz privolu ili uz jednostavnu i besplatnu mogućnost odjave u
              svakoj poruci.
            </li>
          </ul>
          <p>
            <strong>Osnova:</strong> izvršavanje ugovora (točka (b)).
          </p>
        </LegalSubsection>

        <LegalSubsection entry={PROCESSING.publicContent}>
          <p>
            Potrebe, volonterski događaji i profil udruge javno su vidljivi svima. Ako udruga uz
            događaj upiše ime kontakt osobe i broj telefona, i ti su podaci javni. Udruga je
            odgovorna za to da te podatke smije objaviti.
          </p>
        </LegalSubsection>

        <LegalSubsection entry={PROCESSING.registry}>
          <p>
            Kartu i imenik udruga gradimo iz otvorenog skupa podataka{" "}
            <strong>„Registar udruga Republike Hrvatske”</strong>. Skup objavljuje Ministarstvo
            pravosuđa, uprave i digitalne transformacije na portalu data.gov.hr, pod Otvorenom
            dozvolom.
          </p>
          <ul>
            <li>
              <strong>Koje podatke preuzimamo:</strong> za aktivne udruge naziv, skraćeni naziv,
              OIB, registarski broj, oblik udruživanja, sjedište (adresu), županiju, e-adresu,
              mrežnu stranicu, ciljeve, djelatnosti, ciljane skupine te datume upisa i promjene
              statusa. Popis osoba ovlaštenih za zastupanje <strong>ne preuzimamo</strong>.
            </li>
            <li>
              <strong>Zašto je to važno za pojedince:</strong> podaci o udruzi uglavnom nisu
              osobni podaci. Međutim, ako je e-adresa ili adresa sjedišta udruge ujedno nečija
              osobna e-adresa ili kućna adresa, ili ako naziv udruge sadrži nečije ime, to su
              osobni podaci te osobe.
            </li>
            <li>
              <strong>Svrha:</strong> pokazati građanima gdje djeluju udruge i čime se bave te im
              omogućiti kontakt, a udrugama omogućiti da preuzmu svoj profil. Adrese pretvaramo u
              koordinate pomoću službenih adresnih podataka Državne geodetske uprave i servisa
              OpenStreetMap Nominatim.
            </li>
            <li>
              <strong>Kategorija udruge:</strong> vrstu udruge (npr. „pomoć beskućnicima”, „osobe
              s invaliditetom”) automatski predlaže model umjetne inteligencije Jev (TypeSafe AI).
              Prijedlog se temelji na nazivu, ciljevima, djelatnostima i ciljanim skupinama iz
              registra, a nesigurne slučajeve pregledavamo ručno. Kategorija opisuje udrugu, a ne
              pojedince, i može biti netočna, pa nam pogrešku javite. To što je udruga na karti ne
              znači da je provjerena na DajSrcu ni da prima donacije.
            </li>
            <li>
              <strong>Osnova:</strong> legitimni interes za transparentnost i povezivanje građana
              s udrugama (točka (f)). Prema Zakonu o udrugama podaci upisani u Registar udruga
              javni su.
            </li>
            <li>
              <strong>Koliko dugo:</strong> dok je udruga u registru upisana kao aktivna. Podatke
              udruga koje više nisu aktivne uklanjamo pri sljedećem usklađivanju s registrom.
            </li>
            <li>
              <strong>Vaša prava:</strong> ako se na DajSrcu kao podatak udruge prikazuje vaša
              osobna e-adresa ili kućna adresa, možete se usprotiviti obradi ili zatražiti ispravak
              na <MailLink />. Netočne podatke u samom registru ispravlja udruga kod nadležnog
              ureda državne uprave.
            </li>
            <li>
              Riječ je o desecima tisuća udruga, pa bi pojedinačno obavještavanje svih osoba na
              koje se ti podaci mogu odnositi zahtijevalo nerazmjeran napor. Zato ovu obavijest
              objavljujemo javno (članak 14. stavak 5. točka (b) Opće uredbe).
            </li>
          </ul>
        </LegalSubsection>

        <LegalSubsection entry={PROCESSING.outreach}>
          <p>
            Udrugama šaljemo jednokratan poziv da besplatno preuzmu svoj profil, uz najviše jedan
            podsjetnik. Pišemo na službene e-adrese iz Registra udruga ili s javnih mrežnih
            stranica udruga.
          </p>
          <p>
            <strong>Osnova:</strong> legitimni interes (točka (f)). Takvim se porukama u svakom
            trenutku možete usprotiviti, odgovorom na poruku ili na <MailLink />. Nakon toga vašu
            adresu čuvamo samo na popisu adresa na koje više ne pišemo.
          </p>
        </LegalSubsection>

        <LegalSubsection entry={PROCESSING.reports}>
          <p>
            <strong>Podaci:</strong> vaše ime i e-adresa, sadržaj prijave ili upita, sadržaj na
            koji se prijava odnosi, naša odluka i prepiska.
          </p>
          <p>
            <strong>Osnova:</strong> pravna obveza (točka (c)) te legitimni interes (točka (f)).
            Pravnu obvezu imamo obrađivati prijave nezakonitog sadržaja prema Aktu o digitalnim
            uslugama (Uredba (EU) 2022/2065) i odgovarati na zahtjeve prema Općoj uredbi. Ako
            prijavite sadržaj neke udruge, vaše ime udruzi ne otkrivamo, osim ako je to nužno ili
            ako na to pristanete.
          </p>
        </LegalSubsection>

        <LegalSubsection entry={PROCESSING.security}>
          <p>
            Ključne radnje bilježimo u zaštićenom dnevniku u kojem su zapisi kriptografski
            ulančani. To su obećanje i njegovo povlačenje, prijava i odjava s volonterskog
            događaja te brisanje potrebe ili događaja. Tako možemo dokazati što se dogodilo i
            otkriti zlouporabe. Zapis sadrži identifikator računa (ne ime ni e-adresu) i podatke o
            radnji.
          </p>
          <p>
            <strong>Osnova:</strong> legitimni interes (točka (f)).
          </p>
        </LegalSubsection>

        <LegalSubsection entry={PROCESSING.nearby}>
          <p>
            Ta mogućnost trenutačno nije dostupna i vašu lokaciju za nju ne pohranjujemo. Ako je
            uvedemo, uključivat će se samo uz vašu izričitu privolu, a ova ćemo pravila prije toga
            dopuniti.
          </p>
        </LegalSubsection>
      </LegalSection>

      <LegalSection entry={SECTIONS.recipients}>
        <LegalTable
          label="Primatelji osobnih podataka"
          columns={["Primatelj", "Uloga", "Što i zašto", "Gdje i kako je zaštićen prijenos"]}
          rows={RECIPIENTS}
          minWidthClass="min-w-[40rem]"
        />
        <p>
          S izvršiteljima obrade imamo ugovore o obradi podataka u skladu s člankom 28. Opće
          uredbe.
        </p>
      </LegalSection>

      <LegalSection entry={SECTIONS.transfers}>
        <p>
          Podatke platforme pohranjujemo u EU: bazu u Frankfurtu, a podatke za prijavu u Irskoj.
          Neki pružatelji usluga američke su tvrtke, pa podacima mogu pristupati i iz SAD-a. U tim
          slučajevima prijenos se temelji na Okviru EU-a i SAD-a za privatnost podataka za
          certificirane tvrtke (Odluka Komisije (EU) 2023/1795) ili na standardnim ugovornim
          klauzulama Europske komisije. Podaci koje dobiva OpenStreetMap Foundation prenose se u
          Ujedinjenu Kraljevinu, za koju je donesena odluka o primjerenosti. Više informacija o
          zaštitnim mjerama možete dobiti na <MailLink />.
        </p>
      </LegalSection>

      <LegalSection entry={SECTIONS.retention}>
        <LegalTable
          label="Rokovi čuvanja podataka"
          columns={["Podaci", "Rok čuvanja"]}
          rows={RETENTION}
        />
      </LegalSection>

      <LegalSection entry={SECTIONS.rights}>
        <p>U svakom trenutku možete zatražiti:</p>
        <ul>
          <li>
            <strong>pristup</strong> svojim podacima i njihovu kopiju (članak 15.);
          </li>
          <li>
            <strong>ispravak</strong> netočnih podataka (članak 16.). Ime i e-adresu računa
            trenutačno mijenjamo na vaš zahtjev;
          </li>
          <li>
            <strong>brisanje</strong> (članak 17.). Brisanjem računa brišu se profil, obećanja,
            prijave, zahtjevi i obavijesti. U evidenciji radnji zapis ostaje, ali bez poveznice s
            vama. Udruge kojima smo vaše podatke proslijedili obavijestit ćemo o brisanju, osim ako
            je to nemoguće ili zahtijeva nerazmjeran napor. Podatke koje je udruga već primila ona
            čuva kao zaseban voditelj obrade;
          </li>
          <li>
            <strong>ograničenje obrade</strong> (članak 18.);
          </li>
          <li>
            <strong>prenosivost</strong> podataka koje ste nam dali, u strojno čitljivom obliku
            (članak 20.);
          </li>
          <li>
            <strong>povlačenje privole</strong>, ako se obrada temelji na privoli. Povlačenje ne
            utječe na zakonitost obrade prije povlačenja.
          </li>
        </ul>
        <p>
          <strong>Pravo na prigovor (članak 21.):</strong> obradi koja se temelji na našem
          legitimnom interesu (točke 2.1 do 2.4 i 2.8 do 2.11) možete se usprotiviti iz razloga
          koji se odnose na vašu posebnu situaciju. Obradi u svrhu izravnog marketinga, kao što je
          poziv udrugama iz točke 2.9, možete se usprotiviti uvijek i bez navođenja razloga.
        </p>
        <p>
          <strong>Kako ostvariti prava:</strong> pišite nam na <MailLink />, po mogućnosti s
          e-adrese povezane s računom. Odgovorit ćemo bez nepotrebnog odgađanja, najkasnije u roku
          od mjesec dana. Taj rok možemo produljiti za još dva mjeseca ako je zahtjev složen, o
          čemu ćemo vas obavijestiti. Ostvarivanje prava je besplatno. Ako sumnjamo u vaš
          identitet, možemo zatražiti dodatnu potvrdu.
        </p>
        <p>
          <strong>Pritužba nadzornom tijelu:</strong> ako smatrate da vaše podatke obrađujemo
          protivno propisima, možete podnijeti pritužbu Agenciji za zaštitu osobnih podataka
          (AZOP), Ulica Metela Ožegovića 16, 10000 Zagreb, <MailLink address="azop@azop.hr" />,{" "}
          <ExternalLink href="https://azop.hr/">www.azop.hr</ExternalLink>.
        </p>
      </LegalSection>

      <LegalSection entry={SECTIONS.minors}>
        <ul>
          <li>Račun mogu otvoriti osobe koje imaju najmanje 16 godina.</li>
          <li>
            Volontiranje maloljetnika uređuje Zakon o volonterstvu. Osobe od navršenih 15 do 18
            godina smiju volontirati samo uz pisanu suglasnost zakonskog zastupnika, koju predaju
            udruzi organizatoru. Djeca mlađa od 15 godina smiju volontirati samo u
            odgojno-obrazovnim programima (npr. putem škole), pa se na događaje ne mogu
            prijavljivati putem DajSrca.
          </li>
          <li>
            Ako saznamo da je račun otvorila osoba mlađa od 16 godina, račun ćemo zatvoriti, a
            podatke izbrisati.
          </li>
        </ul>
      </LegalSection>

      <LegalSection entry={SECTIONS.automated}>
        <p>
          O pojedincima ne donosimo odluke koje se temelje isključivo na automatiziranoj obradi, a
          imaju pravne ili slične značajne učinke (članak 22. Opće uredbe). Umjetnu inteligenciju
          koristimo samo za razvrstavanje udruga iz registra u kategorije (vidi točku 2.8). O
          zahtjevima za preuzimanje udruge odlučuje čovjek, administrator.
        </p>
      </LegalSection>

      <LegalSection entry={SECTIONS.protection}>
        <p>
          Veza sa stranicom uvijek je šifrirana (HTTPS). Baza je zaštićena pravilima pristupa na
          razini svakog retka, a svaka komponenta ima samo nužne ovlasti. Jednokratne poveznice
          čuvamo samo kao kriptografski sažetak. Broj zahtjeva ograničavamo radi zaštite od
          zlouporabe. Zapisi o pogreškama ne sadrže osobne podatke. Lozinke čuva Supabase kao
          jednosmjerni sažetak (bcrypt). Ako dođe do povrede osobnih podataka koja vas izlaže
          riziku, postupit ćemo prema člancima 33. i 34. Opće uredbe: obavijestit ćemo AZOP i,
          kad je to potrebno, vas.
        </p>
      </LegalSection>

      <LegalSection entry={SECTIONS.cookies}>
        <p>
          Koristimo samo kolačiće i lokalnu pohranu koji su nužni za rad stranice ili pamte
          postavke koje sami odaberete. Pojedinosti su u{" "}
          <DocLink href="/kolacici">Obavijesti o kolačićima</DocLink>.
        </p>
      </LegalSection>

      <LegalSection entry={SECTIONS.changes}>
        <p>
          Pravila ćemo mijenjati kad se promijeni način obrade ili propisi. O bitnim izmjenama
          obavijestit ćemo vas na stranici, a ako imate račun, i obavijesti u aplikaciji ili
          e-poštom. Datum primjene uvijek je naveden na vrhu.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
