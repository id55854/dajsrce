import { NextResponse } from "next/server";
import { INSTITUTIONS } from "@/lib/institutions-seed";
import {
  buildSampleNeeds,
  buildSampleVolunteerEvents,
} from "@/lib/seed-sample-content";
import type { InstitutionCategory } from "@/lib/types";

export async function POST() {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");

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

  let needsCount = 0;
  let eventsCount = 0;

  if (institutions.data?.length) {
    const refs = institutions.data.map((row) => ({
      id: row.id,
      category: row.category as InstitutionCategory,
    }));

    const sampleNeeds = buildSampleNeeds(refs);
    if (sampleNeeds.length > 0) {
      const { error: needsErr } = await supabaseAdmin.from("needs").insert(sampleNeeds);
      if (needsErr) {
        return NextResponse.json({ error: needsErr.message }, { status: 500 });
      }
      needsCount = sampleNeeds.length;
    }

    const sampleEvents = buildSampleVolunteerEvents(refs, new Date());
    if (sampleEvents.length > 0) {
      const { error: eventsErr } = await supabaseAdmin
        .from("volunteer_events")
        .insert(sampleEvents);
      if (eventsErr) {
        return NextResponse.json({ error: eventsErr.message }, { status: 500 });
      }
      eventsCount = sampleEvents.length;
    }
  }

  return NextResponse.json({
    success: true,
    institutionsCount: INSTITUTIONS.length,
    needsCount,
    volunteerEventsCount: eventsCount,
    message: "Database seeded successfully",
  });
}
