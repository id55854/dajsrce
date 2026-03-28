import { INSTITUTIONS, type InstitutionSeed } from "./institutions-seed";
import type { Institution, Need, VolunteerEvent } from "./types";

export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return url.length > 0 && !url.includes("your-project");
}

function seedToInstitution(seed: InstitutionSeed, index: number): Institution {
  const id = `local-${index.toString().padStart(3, "0")}`;
  return {
    id,
    name: seed.name,
    category: seed.category,
    description: seed.description,
    address: seed.address,
    city: seed.city,
    lat: seed.lat,
    lng: seed.lng,
    phone: seed.phone,
    email: seed.email,
    website: seed.website,
    working_hours: seed.working_hours,
    drop_off_hours: seed.drop_off_hours,
    accepts_donations: seed.accepts_donations,
    capacity: seed.capacity,
    served_population: seed.served_population,
    photo_url: null,
    is_verified: true,
    is_location_hidden: seed.is_location_hidden,
    approximate_area: seed.approximate_area,
    nearest_zet_stop: seed.nearest_zet_stop,
    zet_lines: seed.zet_lines,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

let _cachedInstitutions: Institution[] | null = null;

export function getLocalInstitutions(): Institution[] {
  if (!_cachedInstitutions) {
    _cachedInstitutions = INSTITUTIONS.map(seedToInstitution);
  }
  return _cachedInstitutions;
}

let _cachedNeeds: Need[] | null = null;

export function getLocalNeeds(): Need[] {
  if (!_cachedNeeds) {
    const institutions = getLocalInstitutions();
    const needs: Need[] = [];
    let idx = 0;

    for (const inst of institutions) {
      if (inst.category === "homeless_shelter") {
        needs.push({
          id: `need-${idx++}`,
          institution_id: inst.id,
          institution: inst,
          title: "Zimske jakne i topla odjeća",
          description:
            "Hitno trebamo zimske jakne (muške, veličine M-XXL), tople čarape, kape i rukavice za nadolazeće hladne dane.",
          donation_type: "clothes",
          urgency: "urgent",
          quantity_needed: 30,
          quantity_pledged: 8,
          quantity_delivered: 3,
          photo_url: null,
          deadline: null,
          is_fulfilled: false,
          created_at: new Date(Date.now() - 2 * 86400000).toISOString(),
        });
        needs.push({
          id: `need-${idx++}`,
          institution_id: inst.id,
          institution: inst,
          title: "Deke i vreće za spavanje",
          description:
            "Tople deke i vreće za spavanje za korisnike prenoćišta.",
          donation_type: "blankets_bedding",
          urgency: "needed_soon",
          quantity_needed: 20,
          quantity_pledged: 5,
          quantity_delivered: 2,
          photo_url: null,
          deadline: null,
          is_fulfilled: false,
          created_at: new Date(Date.now() - 3 * 86400000).toISOString(),
        });
      }
      if (inst.category === "children_home") {
        needs.push({
          id: `need-${idx++}`,
          institution_id: inst.id,
          institution: inst,
          title: "Školski pribor za novu godinu",
          description:
            "Bilježnice, olovke, boje, torbe i ostali školski pribor za djecu svih uzrasta.",
          donation_type: "school_supplies",
          urgency: "needed_soon",
          quantity_needed: 50,
          quantity_pledged: 12,
          quantity_delivered: 5,
          photo_url: null,
          deadline: null,
          is_fulfilled: false,
          created_at: new Date(Date.now() - 5 * 86400000).toISOString(),
        });
        needs.push({
          id: `need-${idx++}`,
          institution_id: inst.id,
          institution: inst,
          title: "Igračke i društvene igre",
          description:
            "Tražimo igračke, puzzle, društvene igre i slikovnice za djecu od 3 do 14 godina.",
          donation_type: "toys_books",
          urgency: "routine",
          quantity_needed: 25,
          quantity_pledged: 7,
          quantity_delivered: 3,
          photo_url: null,
          deadline: null,
          is_fulfilled: false,
          created_at: new Date(Date.now() - 7 * 86400000).toISOString(),
        });
      }
      if (inst.category === "soup_kitchen") {
        needs.push({
          id: `need-${idx++}`,
          institution_id: inst.id,
          institution: inst,
          title: "Trajna hrana — konzerve i tjestenina",
          description:
            "Konzerve (grah, tune, mesne), tjestenina, riža, ulje, brašno, šećer za pripremu dnevnih obroka.",
          donation_type: "food",
          urgency: "urgent",
          quantity_needed: 100,
          quantity_pledged: 22,
          quantity_delivered: 10,
          photo_url: null,
          deadline: null,
          is_fulfilled: false,
          created_at: new Date(Date.now() - 1 * 86400000).toISOString(),
        });
      }
      if (inst.category === "disability_support") {
        needs.push({
          id: `need-${idx++}`,
          institution_id: inst.id,
          institution: inst,
          title: "Higijenske potrepštine",
          description:
            "Sapuni, šamponi, paste za zube, četkice, pelene za odrasle i sredstva za čišćenje.",
          donation_type: "hygiene",
          urgency: "needed_soon",
          quantity_needed: 40,
          quantity_pledged: 6,
          quantity_delivered: 0,
          photo_url: null,
          deadline: null,
          is_fulfilled: false,
          created_at: new Date(Date.now() - 4 * 86400000).toISOString(),
        });
      }
    }

    _cachedNeeds = needs;
  }
  return _cachedNeeds;
}

export function getLocalVolunteerEvents(): VolunteerEvent[] {
  const institutions = getLocalInstitutions();
  const now = new Date();
  const events: VolunteerEvent[] = [];
  let idx = 0;

  const shelters = institutions.filter(
    (i) => i.category === "homeless_shelter" && i.city === "Zagreb"
  );
  const kitchens = institutions.filter((i) => i.category === "soup_kitchen");
  const homes = institutions.filter(
    (i) => i.category === "children_home" && i.city === "Zagreb"
  );

  if (shelters[0]) {
    const d = new Date(now.getTime() + 3 * 86400000);
    events.push({
      id: `event-${idx++}`,
      institution_id: shelters[0].id,
      institution: shelters[0],
      title: "Sortiranje donirane odjeće",
      description:
        "Pomozite nam sortirati i pripremiti doniranu odjeću za korisnike prihvatilišta. Potrebne su vješte ruke za razvrstavanje po veličinama i sezonama.",
      event_date: d.toISOString().split("T")[0],
      start_time: "09:00",
      end_time: "13:00",
      volunteers_needed: 8,
      volunteers_signed_up: 3,
      requirements: "Udobna odjeća, dobro raspoloženje",
      contact_person: "Ana Horvat",
      contact_phone: shelters[0].phone,
      is_past: false,
      created_at: now.toISOString(),
    });
  }

  if (kitchens[0]) {
    const d = new Date(now.getTime() + 5 * 86400000);
    events.push({
      id: `event-${idx++}`,
      institution_id: kitchens[0].id,
      institution: kitchens[0],
      title: "Pomoć u pripremi obroka",
      description:
        "Pridružite se volonterskom timu u pučkoj kuhinji! Pomagat ćete u pripremi i serviranju toplih obroka za beskućnike i socijalno ugrožene sugrađane.",
      event_date: d.toISOString().split("T")[0],
      start_time: "08:00",
      end_time: "14:00",
      volunteers_needed: 6,
      volunteers_signed_up: 2,
      requirements: "Sanitarna iskaznica (poželjno, ne obavezno)",
      contact_person: "Marko Babić",
      contact_phone: null,
      is_past: false,
      created_at: now.toISOString(),
    });
  }

  if (homes[0]) {
    const d = new Date(now.getTime() + 7 * 86400000);
    events.push({
      id: `event-${idx++}`,
      institution_id: homes[0].id,
      institution: homes[0],
      title: "Kreativna radionica za djecu",
      description:
        "Organiziramo kreativnu radionicu crtanja i slikanja za djecu u domu. Potrebni su volonteri koji vole raditi s djecom i imaju strpljenja.",
      event_date: d.toISOString().split("T")[0],
      start_time: "15:00",
      end_time: "18:00",
      volunteers_needed: 5,
      volunteers_signed_up: 1,
      requirements: "Iskustvo rada s djecom (poželjno)",
      contact_person: "Ivana Kovačević",
      contact_phone: homes[0].phone,
      is_past: false,
      created_at: now.toISOString(),
    });
  }

  if (shelters[1]) {
    const d = new Date(now.getTime() + 10 * 86400000);
    events.push({
      id: `event-${idx++}`,
      institution_id: shelters[1].id,
      institution: shelters[1],
      title: "Uređenje vanjskog prostora",
      description:
        "Proljetno uređenje dvorišta i okoliša prihvatilišta. Sadnja cvijeća, čišćenje i mali popravci.",
      event_date: d.toISOString().split("T")[0],
      start_time: "10:00",
      end_time: "15:00",
      volunteers_needed: 10,
      volunteers_signed_up: 4,
      requirements: "Radna odjeća i rukavice (ako imate)",
      contact_person: "Petar Novak",
      contact_phone: shelters[1].phone,
      is_past: false,
      created_at: now.toISOString(),
    });
  }

  return events;
}
