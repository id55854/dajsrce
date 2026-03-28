import { NextRequest, NextResponse } from "next/server";
import { getLocalNeeds } from "@/lib/local-data";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  try {
    const { createServerSupabaseClient } = await import(
      "@/lib/supabase/server"
    );
    const supabase = await createServerSupabaseClient();

    let query = supabase
      .from("needs")
      .select(
        "*, institution:institutions(id, name, category, address, city, lat, lng)"
      )
      .eq("is_fulfilled", false)
      .order("urgency", { ascending: false })
      .order("created_at", { ascending: false });

    const donationType = searchParams.get("donation_type");
    if (donationType) query = query.eq("donation_type", donationType);

    const urgency = searchParams.get("urgency");
    if (urgency) query = query.eq("urgency", urgency);

    const institutionId = searchParams.get("institution_id");
    if (institutionId) query = query.eq("institution_id", institutionId);

    const limit = parseInt(searchParams.get("limit") || "50");
    query = query.limit(limit);

    const { data, error } = await query;
    if (error) throw error;
    if (data) {
      return NextResponse.json({ needs: data });
    }
  } catch {
    // Fall back to local data
  }

  let needs = getLocalNeeds();

  const donationType = searchParams.get("donation_type");
  if (donationType) {
    needs = needs.filter((n) => n.donation_type === donationType);
  }

  const urgency = searchParams.get("urgency");
  if (urgency) {
    needs = needs.filter((n) => n.urgency === urgency);
  }

  const institutionId = searchParams.get("institution_id");
  if (institutionId) {
    needs = needs.filter((n) => n.institution_id === institutionId);
  }

  const limit = parseInt(searchParams.get("limit") || "50");
  needs = needs.slice(0, limit);

  return NextResponse.json({ needs });
}
