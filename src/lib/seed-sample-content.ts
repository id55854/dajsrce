import type { DonationType, InstitutionCategory, UrgencyLevel } from "./types";

export type SeedInstitutionRef = {
  id: string;
  category: InstitutionCategory;
};

export type SampleNeedInsert = {
  institution_id: string;
  title: string;
  description: string;
  donation_type: DonationType;
  urgency: UrgencyLevel;
  quantity_needed: number;
};

export type SampleVolunteerEventInsert = {
  institution_id: string;
  title: string;
  description: string;
  event_date: string;
  start_time: string;
  end_time: string;
  volunteers_needed: number;
  volunteers_signed_up: number;
  requirements: string | null;
  contact_person: string | null;
  contact_phone: string | null;
};

type NeedTemplate = Omit<SampleNeedInsert, "institution_id">;

type EventTemplate = Omit<
  SampleVolunteerEventInsert,
  "institution_id" | "event_date" | "volunteers_signed_up"
>;

function hashToUint(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function formatLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const NEEDS_BY_CATEGORY: Partial<Record<InstitutionCategory, NeedTemplate[]>> = {
  homeless_shelter: [
    {
      title: "Zimske jakne i topla odjeća",
      description:
        "Hitno trebamo zimske jakne (muške, veličine M-XXL), tople čarape, kape i rukavice za nadolazeće hladne dane.",
      donation_type: "clothes",
      urgency: "urgent",
      quantity_needed: 30,
    },
    {
      title: "Deke i vreće za spavanje",
      description: "Tople deke i vreće za spavanje za korisnike prenoćišta.",
      donation_type: "blankets_bedding",
      urgency: "needed_soon",
      quantity_needed: 20,
    },
  ],
  soup_kitchen: [
    {
      title: "Trajna hrana — konzerve i tjestenina",
      description:
        "Konzerve (grah, tune, mesne), tjestenina, riža, ulje, brašno, šećer za pripremu dnevnih obroka.",
      donation_type: "food",
      urgency: "urgent",
      quantity_needed: 100,
    },
    {
      title: "Higijenski paketi",
      description: "Sapun, šampon, četkice za zube, papirnati ručnici za korisnike.",
      donation_type: "hygiene",
      urgency: "routine",
      quantity_needed: 40,
    },
  ],
  children_home: [
    {
      title: "Školski pribor za novu godinu",
      description:
        "Bilježnice, olovke, boje, torbe i ostali školski pribor za djecu svih uzrasta.",
      donation_type: "school_supplies",
      urgency: "needed_soon",
      quantity_needed: 50,
    },
    {
      title: "Igračke i društvene igre",
      description:
        "Tražimo igračke, puzzle, društvene igre i slikovnice za djecu od 3 do 14 godina.",
      donation_type: "toys_books",
      urgency: "routine",
      quantity_needed: 25,
    },
  ],
  caritas: [
    {
      title: "Paketi za obitelji u potrebi",
      description:
        "Trajna hrana, higijena i dječji program za pakete koje dijelimo obiteljima.",
      donation_type: "food",
      urgency: "needed_soon",
      quantity_needed: 80,
    },
    {
      title: "Odjeća za odrasle i djecu",
      description: "Čista, dobro očuvana odjeća po sezonama — posebno dječje veličine.",
      donation_type: "clothes",
      urgency: "routine",
      quantity_needed: 60,
    },
  ],
  disability_support: [
    {
      title: "Pomagala i potrošni materijal",
      description: "Jednokratni ulošci, rukavice, blagi higijenski program za radionice.",
      donation_type: "medical_supplies",
      urgency: "routine",
      quantity_needed: 35,
    },
    {
      title: "Adaptirane igračke i materijali",
      description: "Senzorne igračke, jednostavni puzzle i materijali za terapijske aktivnosti.",
      donation_type: "toys_books",
      urgency: "needed_soon",
      quantity_needed: 20,
    },
  ],
  domestic_violence: [
    {
      title: "Hitni higijenski i dječji paketi",
      description:
        "Šamponi, pelene, dječja odjeća i mali poklon programi za obitelji u skloništu.",
      donation_type: "hygiene",
      urgency: "urgent",
      quantity_needed: 45,
    },
  ],
  elderly_care: [
    {
      title: "Program za starije — higijena i udobnost",
      description: "Losioni, meke krpice, čarape, deke za korisnike doma.",
      donation_type: "hygiene",
      urgency: "routine",
      quantity_needed: 50,
    },
    {
      title: "Knjige velikog tiska i slušalice",
      description: "Čitanka, audio knjige, jednostavne slagalice za druženje.",
      donation_type: "toys_books",
      urgency: "routine",
      quantity_needed: 15,
    },
  ],
  social_welfare: [
    {
      title: "Namirnice za obiteljske pakete",
      description: "Ulje, brašno, konzerve, mlijeko u trajnosti za socijalne slučajeve.",
      donation_type: "food",
      urgency: "needed_soon",
      quantity_needed: 70,
    },
  ],
  student_housing: [
    {
      title: "Osnovni kuhinjski set za studente",
      description: "Lonci, tanjuri, pribor za jelo, mali aparati za zajedničku kuhinju.",
      donation_type: "furniture",
      urgency: "routine",
      quantity_needed: 25,
    },
    {
      title: "Posteljina i ručnici",
      description: "Čiste posteljine, jastuci, ručnici za studentske sobe.",
      donation_type: "blankets_bedding",
      urgency: "needed_soon",
      quantity_needed: 30,
    },
  ],
};

const DEFAULT_NEEDS: NeedTemplate[] = [
  {
    title: "Opća donacija — namirnice",
    description: "Trajna hrana i osnovne namirnice za korisnike naše ustanove.",
    donation_type: "food",
    urgency: "routine",
    quantity_needed: 40,
  },
];

const EVENTS_BY_CATEGORY: Partial<Record<InstitutionCategory, EventTemplate[]>> = {
  homeless_shelter: [
    {
      title: "Večernji tim — podjela obroka i razgovor",
      description:
        "Pomoć pri posluživanju večere i druženje s korisnicima prenoćišta (kratko uputstvo na licu mjesta).",
      start_time: "17:00",
      end_time: "20:00",
      volunteers_needed: 8,
      requirements: "Empatija i diskrecija; prijavite se barem 24 h ranije.",
      contact_person: null,
      contact_phone: null,
    },
  ],
  soup_kitchen: [
    {
      title: "Jutarnja kuhinja — pripremanje ručka",
      description:
        "Rezanje povrća, pomoć kuhaču i posluživanje u trpezariji za oko 120 obroka.",
      start_time: "08:00",
      end_time: "13:00",
      volunteers_needed: 12,
      requirements: "Zatvorene cipele, prednost iskustvu u kuhinji (nije obavezno).",
      contact_person: null,
      contact_phone: null,
    },
  ],
  children_home: [
    {
      title: "Popodnevna radionica i školska pomoć",
      description:
        "Pomoć djeci uz domaće zadatke i kratka kreativna radionica (crtanje, igra).",
      start_time: "15:00",
      end_time: "18:00",
      volunteers_needed: 6,
      requirements: "Rado s djecom; potrebna prijava i kratki razgovor unaprijed.",
      contact_person: null,
      contact_phone: null,
    },
  ],
  caritas: [
    {
      title: "Pakiranje donacija u skladištu",
      description:
        "Sortiranje donacija, pakiranje paketa za obitelji i označavanje.",
      start_time: "09:00",
      end_time: "13:00",
      volunteers_needed: 10,
      requirements: "Fizički lagani posao; dobrodošli svi uzrasti.",
      contact_person: null,
      contact_phone: null,
    },
  ],
  disability_support: [
    {
      title: "Šetnja i druženje u zajednici",
      description:
        "Pratnja korisnicima na kratkoj šetnji i društvene aktivnosti u centru.",
      start_time: "10:00",
      end_time: "12:30",
      volunteers_needed: 5,
      requirements: "Strpljenje; upute dobivate na licu mjesta.",
      contact_person: null,
      contact_phone: null,
    },
  ],
  domestic_violence: [
    {
      title: "Pomoć u skloništu — administracija i dobrodošlica",
      description:
        "Pomoć pri uređivanju donacija, doček novih korisnica i lagani admin.",
      start_time: "14:00",
      end_time: "17:00",
      volunteers_needed: 4,
      requirements: "Obavezna diskrecija; potpisivanje izjave o povjerljivosti.",
      contact_person: null,
      contact_phone: null,
    },
  ],
  elderly_care: [
    {
      title: "Čitanje naglas i druženje",
      description:
        "Druženje s stanovnicima doma — čitanje, šah, šetnja dvorištem.",
      start_time: "16:00",
      end_time: "18:00",
      volunteers_needed: 7,
      requirements: "Strpljenje i ljubaznost; hrvatski ili engleski.",
      contact_person: null,
      contact_phone: null,
    },
  ],
  social_welfare: [
    {
      title: "Terenski obilazak — dostava paketa",
      description:
        "Pomoć u utovaru i kratkim dostavama paketa obiteljima (vlastito vozilo nije nužno).",
      start_time: "09:30",
      end_time: "14:00",
      volunteers_needed: 6,
      requirements: "Vozačka dozvola B poželjna; javite alergije.",
      contact_person: null,
      contact_phone: null,
    },
  ],
  student_housing: [
    {
      title: "Čišćenje zajedničkih prostora i kuhinje",
      description:
        "Organizirano čišćenje hodnika i zajedničke kuhinje prije semestra.",
      start_time: "10:00",
      end_time: "14:00",
      volunteers_needed: 15,
      requirements: "Radna odjeća; sredstva osigurava ustanova.",
      contact_person: null,
      contact_phone: null,
    },
  ],
};

const DEFAULT_EVENT: EventTemplate[] = [
  {
    title: "Volonterski dan u ustanovi",
    description:
      "Opća pomoć oko logistike, druženje s korisnicima i lagani radovi prema uputama osoblja.",
    start_time: "10:00",
    end_time: "14:00",
    volunteers_needed: 6,
    requirements: "Javite se najmanje dva dana unaprijed.",
    contact_person: null,
    contact_phone: null,
  },
];

/** Sample needs: 1–2 per institution by category (Croatian copy, matches Zagreb seed). */
export function buildSampleNeeds(refs: SeedInstitutionRef[]): SampleNeedInsert[] {
  const out: SampleNeedInsert[] = [];
  for (const inst of refs) {
    const templates = NEEDS_BY_CATEGORY[inst.category] ?? DEFAULT_NEEDS;
    for (const t of templates) {
      out.push({ institution_id: inst.id, ...t });
    }
  }
  return out;
}

/**
 * One upcoming volunteer event per institution; dates spread 3–120 days from `fromDate`.
 */
export function buildSampleVolunteerEvents(
  refs: SeedInstitutionRef[],
  fromDate: Date = new Date()
): SampleVolunteerEventInsert[] {
  const out: SampleVolunteerEventInsert[] = [];
  for (let i = 0; i < refs.length; i++) {
    const inst = refs[i];
    const h = hashToUint(inst.id);
    const dayOffset = 3 + (h % 118);
    const eventDate = formatLocalYmd(addDays(fromDate, dayOffset));
    const templates = EVENTS_BY_CATEGORY[inst.category] ?? DEFAULT_EVENT;
    const tmpl = templates[h % templates.length];
    const signed = Math.min(
      tmpl.volunteers_needed,
      h % (tmpl.volunteers_needed + 1)
    );
    out.push({
      institution_id: inst.id,
      title: tmpl.title,
      description: tmpl.description,
      event_date: eventDate,
      start_time: tmpl.start_time,
      end_time: tmpl.end_time,
      volunteers_needed: tmpl.volunteers_needed,
      volunteers_signed_up: signed,
      requirements: tmpl.requirements,
      contact_person: tmpl.contact_person,
      contact_phone: tmpl.contact_phone,
    });
  }
  return out;
}
