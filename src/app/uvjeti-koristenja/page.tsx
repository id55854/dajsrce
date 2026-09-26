import type { Metadata } from "next";
import { getLocale } from "@/i18n/server";
import {
  DocLink,
  LegalDocument,
  LegalSection,
  MailLink,
  legalMetadata,
  type LegalTocEntry,
} from "@/components/legal/LegalDocument";

// The terms carry the Digital Services Act duties that apply to a micro
// platform (Arts. 11, 12, 14, 16, 17 and 18). Change the moderation and notice
// sections together with the process in docs/PRIVACY_OPERATIONS.md.

export const metadata: Metadata = legalMetadata({
  title: "Uvjeti korištenja",
  description:
    "Uvjeti korištenja platforme DajSrce: pravila za pojedince i udruge, zabranjeni sadržaj, prijava nezakonitog sadržaja, obrazloženje odluka i pravna zaštita.",
  path: "/uvjeti-koristenja",
});

const SECTIONS = {
  about: { id: "o-nama-i-uvjetima", title: "1. O nama i ovim uvjetima" },
  scope: { id: "sto-dajsrce-jest", title: "2. Što DajSrce jest, a što nije" },
  account: { id: "korisnicki-racun", title: "3. Korisnički račun" },
  individuals: {
    id: "pravila-za-pojedince",
    title: "4. Pravila za pojedince (donatore i volontere)",
  },
  associations: { id: "pravila-za-udruge", title: "5. Pravila za udruge" },
  prohibited: { id: "zabranjeni-sadrzaji", title: "6. Zabranjeni sadržaji i ponašanje" },
  moderation: { id: "moderiranje", title: "7. Kako moderiramo sadržaj" },
  notices: { id: "prijava-sadrzaja", title: "8. Prijava nezakonitog sadržaja" },
  reasons: {
    id: "obrazlozenje-i-pravna-zastita",
    title: "9. Obrazloženje odluka i pravna zaštita",
  },
  authorities: { id: "obavjescivanje-tijela", title: "10. Obavješćivanje nadležnih tijela" },
  contacts: { id: "kontaktne-tocke", title: "11. Kontaktne točke" },
  content: {
    id: "intelektualno-vlasnistvo",
    title: "12. Sadržaj i prava intelektualnog vlasništva",
  },
  liability: { id: "dostupnost-i-odgovornost", title: "13. Dostupnost i odgovornost" },
  changes: { id: "izmjene-uvjeta", title: "14. Izmjene uvjeta" },
  termination: { id: "prestanak-koristenja", title: "15. Prestanak korištenja" },
  law: { id: "mjerodavno-pravo", title: "16. Mjerodavno pravo i rješavanje sporova" },
  effect: { id: "stupanje-na-snagu", title: "17. Stupanje na snagu" },
} satisfies Record<string, LegalTocEntry>;

const TOC: readonly LegalTocEntry[] = Object.values(SECTIONS);

/** A numbered clause such as "5.4.", set apart so the numbers scan. */
function Clause({ number }: { number: string }) {
  return <span className="font-semibold text-ink">{number}</span>;
}

export default async function TermsOfUsePage() {
  const locale = await getLocale();

  return (
    <LegalDocument
      locale={locale}
      title="Uvjeti korištenja platforme DajSrce"
      effectiveFrom="primjenjuju se od"
      toc={TOC}
      summary={
        <>
          <ul>
            <li>
              DajSrce je besplatna posrednička platforma. Udruge na njoj objavljuju potrebe i
              volonterske događaje, a pojedinci im se javljaju.
            </li>
            <li>
              DajSrce ne prima novac ni stvari i nije organizator volontiranja. Predaju pomoći i
              volontiranje dogovarate izravno s udrugom.
            </li>
            <li>
              Obećanje vas pravno ne obvezuje. Ako ga ne možete ispuniti, povucite ga na
              Platformi.
            </li>
            <li>Za točnost objava odgovaraju udruge. One su i organizatori volontiranja.</li>
            <li>Račun mogu otvoriti osobe koje imaju najmanje 16 godina.</li>
            <li>
              Nezakonit sadržaj prijavite putem poveznice „Prijavi sadržaj” ili na <MailLink />.
            </li>
          </ul>
          <p>Sažetak vam pomaže da se lakše snađete i ne zamjenjuje uvjete u nastavku.</p>
        </>
      }
    >
      <LegalSection entry={SECTIONS.about}>
        <p>
          <Clause number="1.1." /> Platformu DajSrce na adresi dajsrce.hr (u daljnjem tekstu:
          Platforma) vodi <strong>UDRUGA ZA DIGITALNU SOLIDARNOST DAJSRCE</strong>, Rebro 38/16,
          10360 Sesvete, Hrvatska, OIB 34669315869. Udruga je upisana u Registar udruga Republike
          Hrvatske pod registarskim brojem 21015617, a njezin je matični broj 06301436 (u daljnjem
          tekstu: DajSrce ili mi). Kontakt: <MailLink />.
        </p>
        <p>
          <Clause number="1.2." /> Ovi uvjeti uređuju korištenje Platforme. Otvaranjem računa ili
          korištenjem Platforme prihvaćate ih. Ako se s njima ne slažete, nemojte koristiti
          Platformu.
        </p>
        <p>
          <Clause number="1.3." /> Platforma je besplatna. Na njoj ne prikupljamo novac, ne
          naplaćujemo usluge i ne prikazujemo oglase.
        </p>
        <p>
          <Clause number="1.4." /> Pojmovi:
        </p>
        <ul>
          <li>
            <strong>Korisnik</strong>: svatko tko koristi Platformu, s računom ili bez njega;
          </li>
          <li>
            <strong>Pojedinac</strong>: korisnik s osobnim računom koji obećava pomoć ili se
            prijavljuje za volontiranje;
          </li>
          <li>
            <strong>Udruga</strong>: neprofitna pravna osoba upisana u Registar udruga Republike
            Hrvatske čiji smo zahtjev za preuzimanje profila odobrili, zajedno s osobom koja u
            njezino ime koristi račun udruge;
          </li>
          <li>
            <strong>Potreba</strong>: objava udruge o tome što joj je potrebno;
          </li>
          <li>
            <strong>Volonterski događaj</strong>: objava udruge kojom traži volontere za određeni
            termin;
          </li>
          <li>
            <strong>Obećanje</strong>: izjava pojedinca da namjerava pomoći u zadovoljavanju
            potrebe;
          </li>
          <li>
            <strong>Prijava</strong>: prijava pojedinca na volonterski događaj;
          </li>
          <li>
            <strong>Sadržaj</strong>: sve što korisnik objavi ili pošalje putem Platforme.
          </li>
        </ul>
      </LegalSection>

      <LegalSection entry={SECTIONS.scope}>
        <p>
          <Clause number="2.1." /> DajSrce je posrednička platforma. Udrugama omogućuje da objave
          što im treba i kada trebaju volontere, a pojedincima da im se jave.
        </p>
        <p>
          <Clause number="2.2." /> DajSrce nije strana u dogovoru između pojedinca i udruge. Ne
          prima, ne skladišti, ne prevozi i ne raspodjeljuje donacije te ne prikuplja novac. Nije
          organizator humanitarnih akcija ni organizator volontiranja. Organizator volontiranja u
          smislu Zakona o volonterstvu uvijek je udruga koja je objavila događaj.
        </p>
        <p>
          <Clause number="2.3." /> Ne jamčimo da će obećana pomoć biti predana, da je objavljena
          potreba stvarna i još aktualna ni da će udruga prihvatiti predanu stvar. Za točnost
          svojih objava odgovaraju udruge.
        </p>
        <p>
          <Clause number="2.4." /> Karta i imenik udruga prikazuju podatke iz službenog Registra
          udruga Republike Hrvatske. Izvor je Ministarstvo pravosuđa, uprave i digitalne
          transformacije (data.gov.hr), a podaci se ponovno koriste pod Otvorenom dozvolom. To što
          je udruga na karti ne znači da je provjerena na DajSrcu, da prima donacije ni da surađuje
          s nama. Kategorije udruga automatski predlaže model umjetne inteligencije i mogu biti
          netočne. Za potpunost i točnost podataka iz registra ne jamčimo; netočnosti nam možete
          prijaviti.
        </p>
      </LegalSection>

      <LegalSection entry={SECTIONS.account}>
        <p>
          <Clause number="3.1." /> Račun smije otvoriti osoba koja ima najmanje 16 godina.
        </p>
        <p>
          <Clause number="3.2." /> Pri otvaranju računa navedite točne podatke. Svaka osoba smije
          imati samo jedan osobni račun i ne smije otvoriti račun u tuđe ime. Lozinku čuvajte kao
          tajnu. Ako posumnjate da netko drugi koristi vaš račun, odmah nam javite.
        </p>
        <p>
          <Clause number="3.3." /> Ako se prijavite Google računom, za tu prijavu vrijede i
          Googleovi uvjeti.
        </p>
        <p>
          <Clause number="3.4." /> Račun u svakom trenutku možete zatvoriti tako da to zatražite
          na <MailLink />. Što se s podacima događa nakon zatvaranja računa, opisano je u{" "}
          <DocLink href="/pravila-privatnosti">Pravilima privatnosti</DocLink>.
        </p>
      </LegalSection>

      <LegalSection entry={SECTIONS.individuals}>
        <p>
          <Clause number="4.1." /> <strong>Obećanje</strong> izražava vašu namjeru da predate
          određenu pomoć. Ono nije ugovor o darovanju i pravno vas ne obvezuje. Predaju dogovarate
          izravno s udrugom. Ako obećanje ne možete ispuniti, što prije ga povucite na Platformi
          kako bi udruga mogla računati na druge.
        </p>
        <p>
          <Clause number="4.2." /> Predajte samo stvari koje udruga traži i koje su ispravne,
          čiste i sigurne. Ne nudite stvari iz točke 6.3.
        </p>
        <p>
          <Clause number="4.3." /> Kad se sastajete radi predaje ili volontiranja, postupajte
          razborito. DajSrce ne provjerava osobe koje sudjeluju u dogovoru.
        </p>
        <p>
          <Clause number="4.4." /> <strong>Volontiranje.</strong> Volontirate za udrugu, koja je
          organizator volontiranja. U skladu sa Zakonom o volonterstvu udruga od vas može tražiti
          da sklopite ugovor o volontiranju. Kad volontiranje uključuje rad s djecom, osobama s
          invaliditetom, starijim i nemoćnim ili bolesnim osobama, može tražiti i izjavu da ne
          postoje zapreke iz članka 10. toga zakona te druge dokaze koje zakon propisuje. Potvrdu
          o volontiranju izdaje udruga.
        </p>
        <p>
          <Clause number="4.5." /> <strong>Maloljetni volonteri.</strong> Ako imate od 15 do 18
          godina, smijete volontirati samo uz pisanu suglasnost roditelja ili drugog zakonskog
          zastupnika, koju predajete udruzi. Mlađi od 15 godina ne mogu se prijavljivati na
          događaje putem Platforme jer im zakon dopušta volontiranje samo u odgojno-obrazovnim
          programima.
        </p>
        <p>
          <Clause number="4.6." /> Kad se javite udruzi, ona vidi vaše ime i e-adresu.
          Pojedinosti su u <DocLink href="/pravila-privatnosti">Pravilima privatnosti</DocLink>.
        </p>
      </LegalSection>

      <LegalSection entry={SECTIONS.associations}>
        <p>
          <Clause number="5.1." /> <strong>Račun udruge.</strong> Zahtjev za preuzimanje profila
          udruge smije podnijeti samo osoba ovlaštena za zastupanje udruge ili osoba koju je udruga
          za to ovlastila. Zahtjev odobrava administrator nakon provjere i pritom može tražiti
          dodatne dokaze. Zahtjev možemo odbiti, a odobrenje opozvati, ako posumnjamo u zlouporabu.
          U tom slučaju dobit ćete obrazloženje (točka 9.).
        </p>
        <p>
          <Clause number="5.2." /> <strong>Točnost objava.</strong> Objavljujte samo stvarne i
          aktualne potrebe i događaje. Ispunjene potrebe uklonite ili ih označite ispunjenima. Ne
          objavljujte potrebe ni događaje drugih organizacija.
        </p>
        <p>
          <Clause number="5.3." /> <strong>Humanitarna pomoć.</strong> Ako objavom potrebe
          prikupljate humanitarnu pomoć u smislu Zakona o humanitarnoj pomoći (Narodne novine, br.
          156/23), izjavljujete i jamčite sljedeće. Humanitarna pomoć su, primjerice, materijalna
          dobra ili novčana sredstva za socijalno osjetljive skupine ili žrtve katastrofa.
        </p>
        <ol>
          <li>
            (a) Imate priznat status stalnog prikupljača humanitarne pomoći ili izvršno rješenje
            kojim je odobrena humanitarna akcija za to prikupljanje.
          </li>
          <li>
            (b) Prikupljenu pomoć koristite samo za navedenu svrhu i navedene korisnike te je
            dodjeljujete u rokovima i na način koji zakon propisuje.
          </li>
          <li>
            (c) Ispunjavate zakonske obveze isticanja logotipa i QR koda te izvješćivanja
            nadležnog tijela.
          </li>
          <li>
            (d) Humanitarnu akciju ne organizirate radi podmirenja troškova redovnog poslovanja.
          </li>
        </ol>
        <p>
          Za donacije hrane vrijede propisi o doniranju hrane (Pravilnik o doniranju hrane i hrane
          za životinje), uključujući upis u registar posrednika u lancu doniranja hrane kad se taj
          propis na vas primjenjuje. Na naš zahtjev dostavit ćete broj rješenja ili evidencijsku
          oznaku. Ako to ne učinite, objavu možemo ukloniti.
        </p>
        <p>
          <Clause number="5.4." /> <strong>Novac.</strong> DajSrce ne prima novac i ne posreduje u
          plaćanjima. Potrebe za novčanim sredstvima trenutačno nije moguće objavljivati na
          Platformi.
        </p>
        <p>
          <Clause number="5.5." /> <strong>Volontiranje.</strong> Udruga je organizator
          volontiranja i odgovara za obveze iz Zakona o volonterstvu, osobito:
        </p>
        <ul>
          <li>
            sklapa pisani ugovor o volontiranju kad je obvezan, primjerice kod volontiranja s
            djecom, osobama s invaliditetom, starijim i nemoćnim ili bolesnim osobama, kod
            dugotrajnog volontiranja ili kad to volonter zatraži;
          </li>
          <li>provjerava zapreke iz članka 10. i pribavlja izjave i uvjerenja iz članka 27.;</li>
          <li>osigurava volontera kad je to obvezno;</li>
          <li>osigurava primjerene uvjete, nadzor i sigurnost;</li>
          <li>
            za maloljetne volontere pribavlja pisanu suglasnost zakonskog zastupnika, a djecu
            mlađu od 15 godina ne uključuje izvan odgojno-obrazovnih programa;
          </li>
          <li>na zahtjev volontera izdaje potvrdu o volontiranju;</li>
          <li>izvješćuje nadležno ministarstvo.</li>
        </ul>
        <p>Volonterima udruga ne smije plaćati rad niti njima zamjenjivati rad zaposlenika.</p>
        <p>
          <Clause number="5.6." /> <strong>Zaštita podataka koje primate.</strong> Kad vam se
          pojedinac javi, dobivate njegovo ime, e-adresu i podatke o obećanju ili prijavi. Te
          podatke obrađujete kao zaseban voditelj obrade, u skladu s Općom uredbom o zaštiti
          podataka, i to samo radi dogovora o toj pomoći ili volontiranju te ispunjavanja
          zakonskih obveza. Bez zasebne pravne osnove, primjerice privole, ne smijete ih koristiti
          za promidžbu, prikupljanje sredstava ni druge svrhe. Ne smijete ih prosljeđivati
          trećima, a dužni ste ih izbrisati kad vam više ne trebaju. Ime i telefon kontakt osobe
          objavljujte samo uz njezino znanje i suglasnost, po mogućnosti službeni broj. Ne
          objavljujte osobne podatke osoba kojima pomažete, kao što su imena, fotografije ili
          podaci o zdravlju, osobito ako je riječ o djeci.
        </p>
        <p>
          <Clause number="5.7." /> Ne smijete diskriminirati volontere ni donatore. Uvjeti koje
          postavljate volonterima moraju biti opravdani naravi posla.
        </p>
      </LegalSection>

      <LegalSection entry={SECTIONS.prohibited}>
        <p>
          <Clause number="6.1." /> Na Platformi je zabranjeno objavljivati nezakonit sadržaj i
          sadržaj protivan ovim uvjetima, osobito:
        </p>
        <ul>
          <li>govor mržnje, poticanje na nasilje ili diskriminaciju, prijetnje i uznemiravanje;</li>
          <li>
            prijevare te lažna ili obmanjujuća prikupljanja pomoći, kao i prikupljanja protivna
            Zakonu o humanitarnoj pomoći;
          </li>
          <li>lažno predstavljanje u ime udruge ili druge osobe;</li>
          <li>
            tuđe osobne podatke bez pravne osnove, osobito podatke djece i korisnika socijalnih
            usluga;
          </li>
          <li>sadržaj koji povređuje autorska ili druga prava;</li>
          <li>komercijalno oglašavanje i neželjenu promidžbu.</li>
        </ul>
        <p>
          <Clause number="6.2." /> Zabranjeno je i:
        </p>
        <ul>
          <li>
            automatizirano prikupljanje podataka s Platforme izvan javno dokumentiranih sučelja i
            njihovih ograničenja;
          </li>
          <li>napadi na sigurnost Platforme i zaobilaženje tehničkih ograničenja;</li>
          <li>korištenje podataka drugih korisnika protivno točki 5.6.</li>
        </ul>
        <p>
          <Clause number="6.3." /> Ne smiju se tražiti ni nuditi:
        </p>
        <ul>
          <li>oružje, streljivo i pirotehnika;</li>
          <li>droge;</li>
          <li>
            lijekovi i medicinski proizvodi, osim ako ih prima i njima raspolaže osoba ovlaštena
            prema posebnim propisima;
          </li>
          <li>alkohol i duhanski proizvodi;</li>
          <li>opasne tvari;</li>
          <li>krivotvorene, ukradene ili s tržišta povučene stvari;</li>
          <li>hrana protivna propisima o sigurnosti hrane;</li>
          <li>sve drugo čije je davanje zabranjeno zakonom.</li>
        </ul>
      </LegalSection>

      <LegalSection entry={SECTIONS.moderation}>
        <p>
          <Clause number="7.1." /> Sadržaj pregledavaju članovi tima DajSrca, na temelju prijava
          ili na vlastitu inicijativu. Zahtjeve za preuzimanje profila udruge pregledava
          administrator.
        </p>
        <p>
          <Clause number="7.2." /> Od automatiziranih alata koristimo ograničenje broja zahtjeva i
          tehničku provjeru unosa, primjerice duljine i oblika. Umjetnu inteligenciju ne koristimo
          za odlučivanje o sadržaju korisnika ni o računima. Koristimo je samo za predlaganje
          kategorija udruga iz registra.
        </p>
        <p>
          <Clause number="7.3." /> Mjere koje možemo poduzeti:
        </p>
        <ul>
          <li>uklanjanje sadržaja ili onemogućavanje pristupa sadržaju;</li>
          <li>ograničavanje vidljivosti;</li>
          <li>privremena zabrana objavljivanja;</li>
          <li>suspenzija ili zatvaranje računa;</li>
          <li>odbijanje ili opoziv odobrenja udruge.</li>
        </ul>
        <p>
          Postupamo pažljivo, objektivno i razmjerno i uzimamo u obzir prava i legitimne interese
          svih uključenih, uključujući slobodu izražavanja.
        </p>
        <p>
          <Clause number="7.4." /> Kod ozbiljnih ili ponovljenih povreda račun možemo suspendirati
          na razumno razdoblje. Kad je to moguće, prethodno ćemo vas upozoriti.
        </p>
      </LegalSection>

      <LegalSection entry={SECTIONS.notices}>
        <p>
          <Clause number="8.1." /> Sadržaj za koji smatrate da je nezakonit prijavite e-poštom na{" "}
          <MailLink />, s naslovom „Prijava sadržaja”, ili putem poveznice „Prijavi sadržaj” uz
          potrebe i volonterske događaje. Prijava treba sadržavati:
        </p>
        <ol>
          <li>(a) obrazloženje zašto smatrate da je sadržaj nezakonit;</li>
          <li>
            (b) točnu poveznicu (URL) na sadržaj i, po potrebi, druge podatke potrebne da ga
            pronađemo;
          </li>
          <li>
            (c) svoje ime i e-adresu. Ne morate ih navesti ako prijavljujete sadržaj povezan s
            kaznenim djelima spolnog zlostavljanja ili iskorištavanja djece;
          </li>
          <li>
            (d) izjavu da ste u dobroj vjeri uvjereni da su podaci i navodi u prijavi točni i
            potpuni.
          </li>
        </ol>
        <p>
          <Clause number="8.2." /> Ako ste naveli e-adresu, bez odgađanja ćemo potvrditi primitak
          prijave. O prijavi ćemo odlučiti pravodobno, pažljivo, nearbitrarno i objektivno te vas
          obavijestiti o odluci i o mogućnostima pravne zaštite.
        </p>
        <p>
          <Clause number="8.3." /> Ako netko učestalo podnosi očito neosnovane prijave, njegove
          prijave možemo privremeno prestati obrađivati, nakon prethodnog upozorenja.
        </p>
        <p>
          <Clause number="8.4." /> Na istu adresu možete nam javiti i druge probleme, primjerice
          netočne podatke iz registra ili pitanja o osobnim podacima.
        </p>
      </LegalSection>

      <LegalSection entry={SECTIONS.reasons}>
        <p>
          <Clause number="9.1." /> Obrazloženje dobivate ako zbog nezakonitog sadržaja ili povrede
          ovih uvjeta poduzmemo neku od ovih mjera:
        </p>
        <ul>
          <li>uklonimo ili ograničimo vaš sadržaj;</li>
          <li>suspendiramo ili zatvorimo vaš račun;</li>
          <li>odbijemo ili opozovemo odobrenje udruge.</li>
        </ul>
        <p>Jasno i konkretno obrazloženje šaljemo na e-adresu računa. U njemu navodimo:</p>
        <ul>
          <li>koja je mjera poduzeta te u kojem opsegu i trajanju;</li>
          <li>
            činjenice i okolnosti na kojima se odluka temelji, uključujući podatak je li donesena
            na temelju prijave;
          </li>
          <li>jesu li korišteni automatizirani alati;</li>
          <li>
            pravnu osnovu, ako je sadržaj nezakonit, ili odredbu ovih uvjeta, ako je sadržaj
            protivan uvjetima;
          </li>
          <li>mogućnosti pravne zaštite.</li>
        </ul>
        <p>
          <Clause number="9.2." /> <strong>Prigovor.</strong> Protiv odluke možete podnijeti
          prigovor na <MailLink /> u roku od šest mjeseci. Prigovor razmatra čovjek, i to kad je
          moguće osoba koja nije sudjelovala u prvotnoj odluci. O ishodu vas obavještavamo bez
          nepotrebnog odgađanja.
        </p>
        <p>
          <Clause number="9.3." /> Možete se obratiti i tijelu za izvansudsko rješavanje sporova
          certificiranom prema članku 21. Akta o digitalnim uslugama ili nadležnom sudu. Pritužbu
          prema članku 53. Akta možete podnijeti Hrvatskoj regulatornoj agenciji za mrežne
          djelatnosti (HAKOM), kao koordinatoru za digitalne usluge.
        </p>
      </LegalSection>

      <LegalSection entry={SECTIONS.authorities}>
        <p>
          Ako saznamo za informacije koje upućuju na sumnju da je počinjeno, da se čini ili da bi
          se moglo počiniti kazneno djelo koje ugrožava nečiji život ili sigurnost, odmah ćemo
          obavijestiti policiju ili državno odvjetništvo i dostaviti im sve dostupne relevantne
          informacije (članak 18. Akta o digitalnim uslugama). Postupamo i po nalozima nadležnih
          tijela (članci 9. i 10. Akta).
        </p>
      </LegalSection>

      <LegalSection entry={SECTIONS.contacts}>
        <ul>
          <li>
            <strong>
              Za tijela država članica, Europsku komisiju i Europski odbor za digitalne usluge:
            </strong>{" "}
            <MailLink />. Jezici komunikacije: hrvatski i engleski.
          </li>
          <li>
            <strong>Za korisnike:</strong> <MailLink />. Odgovara čovjek, a ne automatizirani
            sustav. Jezici komunikacije: hrvatski i engleski. Poštom nam možete pisati na adresu
            sjedišta iz točke 1.1.
          </li>
        </ul>
      </LegalSection>

      <LegalSection entry={SECTIONS.content}>
        <p>
          <Clause number="12.1." /> Sadržaj koji objavite ostaje vaš. Objavom nam dajete
          neisključivo i besplatno pravo da ga prikazujemo, pohranjujemo, prilagođavamo prikazu i
          dijelimo na Platformi i u povezanim kanalima DajSrca. To pravo traje dok je sadržaj
          objavljen te razumno vrijeme nakon toga, radi arhive i zaštite prava.
        </p>
        <p>
          <Clause number="12.2." /> Jamčite da imate prava na sadržaj koji objavljujete,
          primjerice na fotografije, i da njime ne povređujete prava drugih.
        </p>
        <p>
          <Clause number="12.3." /> Podaci iz Registra udruga ponovno se koriste pod Otvorenom
          dozvolom Republike Hrvatske. Kartografski podaci su © suradnici OpenStreetMapa (ODbL) i
          CARTO, a adresni podaci potječu od Državne geodetske uprave.
        </p>
      </LegalSection>

      <LegalSection entry={SECTIONS.liability}>
        <p>
          <Clause number="13.1." /> Platformu pružamo besplatno i u stanju u kojem jest. Trudimo
          se da bude dostupna i točna, ali ne jamčimo neprekinut rad. Dijelove Platforme možemo
          mijenjati, privremeno obustaviti ili ukinuti.
        </p>
        <p>
          <Clause number="13.2." /> U najvećoj mjeri koju zakon dopušta ne odgovaramo za štetu koja
          proizlazi iz:
        </p>
        <ul>
          <li>dogovora, predaje, volontiranja ili drugih odnosa između korisnika;</li>
          <li>sadržaja koji objavljuju korisnici;</li>
          <li>podataka preuzetih iz Registra udruga.</li>
        </ul>
        <p>
          Time se ne ograničava naša odgovornost za štetu prouzročenu namjerno ili iz krajnje
          nepažnje, za povredu života, tijela ili zdravlja, ni druga prava koja vam pripadaju prema
          prisilnim propisima.
        </p>
        <p>
          <Clause number="13.3." /> Kao pružatelj usluge smještaja informacija na poslužitelju ne
          odgovaramo za sadržaj korisnika dok stvarno ne saznamo da je nezakonit. Nakon što to
          saznamo, žurno postupamo.
        </p>
      </LegalSection>

      <LegalSection entry={SECTIONS.changes}>
        <p>
          Bitne izmjene objavljujemo najmanje 15 dana prije nego što stupe na snagu. Korisnike s
          računom o njima obavještavamo obavijesti u aplikaciji ili e-poštom. Iznimka su izmjene
          koje zahtijeva propis ili hitna zaštita korisnika. Ako nastavite koristiti Platformu
          nakon što izmjene stupe na snagu, smatra se da ste ih prihvatili. Ako se s izmjenama ne
          slažete, račun možete zatvoriti.
        </p>
      </LegalSection>

      <LegalSection entry={SECTIONS.termination}>
        <p>
          <Clause number="15.1." /> Račun možete zatvoriti u svakom trenutku (točka 3.4.).
        </p>
        <p>
          <Clause number="15.2." /> Zbog povrede ovih uvjeta račun možemo suspendirati ili
          zatvoriti, uz obrazloženje iz točke 9.
        </p>
      </LegalSection>

      <LegalSection entry={SECTIONS.law}>
        <p>
          Na ove uvjete primjenjuje se pravo Republike Hrvatske. Sporove nastojimo riješiti
          sporazumno. Ako to ne uspije, nadležan je stvarno nadležni sud u Zagrebu, osim ako
          prisilni propisi određuju drugačije.
        </p>
      </LegalSection>

      <LegalSection entry={SECTIONS.effect}>
        <p>Ovi uvjeti primjenjuju se od 27. rujna 2026.</p>
      </LegalSection>
    </LegalDocument>
  );
}
