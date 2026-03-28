import { NextRequest, NextResponse } from "next/server";
import { getLocalInstitutions } from "@/lib/local-data";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  try {
    const { createServerSupabaseClient } = await import(
      "@/lib/supabase/server"
    );
    const supabase = await createServerSupabaseClient();

    let query = supabase.from("institutions").select("*");

    const category = searchParams.get("category");
    if (category) query = query.eq("category", category);

    const city = searchParams.get("city");
    if (city) query = query.eq("city", city);

    const donationType = searchParams.get("donation_type");
    if (donationType)
      query = query.contains("accepts_donations", [donationType]);

    const { data, error } = await query.order("name");

    if (error) throw error;
    if (data && data.length > 0) {
      return NextResponse.json({ institutions: data });
    }
  } catch {
    // Supabase unavailable or tables not created — fall back to local data
  }

  let institutions = getLocalInstitutions();

  const category = searchParams.get("category");
  if (category) {
    institutions = institutions.filter((i) => i.category === category);
  }

  const city = searchParams.get("city");
  if (city) {
    institutions = institutions.filter((i) => i.city === city);
  }

  const donationType = searchParams.get("donation_type");
  if (donationType) {
    institutions = institutions.filter((i) =>
      i.accepts_donations.includes(donationType as never)
    );
  }

  institutions.sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ institutions });
}
