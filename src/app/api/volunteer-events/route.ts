import { NextRequest, NextResponse } from "next/server";
import { getLocalVolunteerEvents } from "@/lib/local-data";

export async function GET(_req: NextRequest) {
  try {
    const { createServerSupabaseClient } = await import(
      "@/lib/supabase/server"
    );
    const supabase = await createServerSupabaseClient();

    const { data, error } = await supabase
      .from("volunteer_events")
      .select(
        "*, institution:institutions(id, name, category, address, city)"
      )
      .gte("event_date", new Date().toISOString().split("T")[0])
      .order("event_date", { ascending: true })
      .limit(30);

    if (error) throw error;
    if (data) {
      return NextResponse.json({ events: data });
    }
  } catch {
    // Fall back to local data
  }

  return NextResponse.json({ events: getLocalVolunteerEvents() });
}
