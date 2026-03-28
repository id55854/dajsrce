import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { INSTITUTIONS } from "@/lib/institutions-seed";

export async function POST() {
  await supabaseAdmin
    .from("institutions")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");

  const { error } = await supabaseAdmin.from("institutions").insert(
    INSTITUTIONS.map((inst) => ({
      name: inst.name,
      category: inst.category,
      description: inst.description,
      address: inst.address,
      city: inst.city,
      lat: inst.lat,
      lng: inst.lng,
      phone: inst.phone,
      email: inst.email,
      website: inst.website,
      working_hours: inst.working_hours,
      drop_off_hours: inst.drop_off_hours,
      accepts_donations: inst.accepts_donations,
      capacity: inst.capacity,
      served_population: inst.served_population,
      is_verified: true,
      is_location_hidden: inst.is_location_hidden,
      approximate_area: inst.approximate_area,
      nearest_zet_stop: inst.nearest_zet_stop,
      zet_lines: inst.zet_lines,
    }))
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const institutions = await supabaseAdmin
    .from("institutions")
    .select("id, name, category");

  if (institutions.data) {
    const sampleNeeds = [];
    for (const inst of institutions.data) {
      if (inst.category === "homeless_shelter") {
        sampleNeeds.push({
          institution_id: inst.id,
          title: "Zimske jakne i topla odjeća",
          description:
            "Hitno trebamo zimske jakne (muške, veličine M-XXL), tople čarape, kape i rukavice za nadolazeće hladne dane.",
          donation_type: "clothes",
          urgency: "urgent",
          quantity_needed: 30,
        });
        sampleNeeds.push({
          institution_id: inst.id,
          title: "Deke i vreće za spavanje",
          description:
            "Tople deke i vreće za spavanje za korisnike prenoćišta.",
          donation_type: "blankets_bedding",
          urgency: "needed_soon",
          quantity_needed: 20,
        });
      }
      if (inst.category === "children_home") {
        sampleNeeds.push({
          institution_id: inst.id,
          title: "Školski pribor za novu godinu",
          description:
            "Bilježnice, olovke, boje, torbe i ostali školski pribor za djecu svih uzrasta.",
          donation_type: "school_supplies",
          urgency: "needed_soon",
          quantity_needed: 50,
        });
        sampleNeeds.push({
          institution_id: inst.id,
          title: "Igračke i društvene igre",
          description:
            "Tražimo igračke, puzzle, društvene igre i slikovnice za djecu od 3 do 14 godina.",
          donation_type: "toys_books",
          urgency: "routine",
          quantity_needed: 25,
        });
      }
      if (inst.category === "soup_kitchen") {
        sampleNeeds.push({
          institution_id: inst.id,
          title: "Trajna hrana — konzerve i tjestenina",
          description:
            "Konzerve (grah, tune, mesne), tjestenina, riža, ulje, brašno, šećer za pripremu dnevnih obroka.",
          donation_type: "food",
          urgency: "urgent",
          quantity_needed: 100,
        });
      }
    }
    if (sampleNeeds.length > 0) {
      await supabaseAdmin.from("needs").insert(sampleNeeds);
    }
  }

  return NextResponse.json({
    success: true,
    institutionsCount: INSTITUTIONS.length,
    message: "Database seeded successfully",
  });
}
