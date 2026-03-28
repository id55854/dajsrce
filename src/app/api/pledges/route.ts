import { NextRequest, NextResponse } from "next/server";

export async function GET(_req: NextRequest) {
  try {
    const { createServerSupabaseClient } = await import(
      "@/lib/supabase/server"
    );
    const supabase = await createServerSupabaseClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ pledges: [] });
    }

    const { data, error } = await supabase
      .from("pledges")
      .select(
        "*, need:needs(*, institution:institutions(id, name, category))"
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return NextResponse.json({ pledges: data ?? [] });
  } catch {
    return NextResponse.json({ pledges: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { createServerSupabaseClient } = await import(
      "@/lib/supabase/server"
    );
    const supabase = await createServerSupabaseClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({
        pledge: { id: "demo", status: "pledged" },
      });
    }

    const body = await req.json();
    const { need_id, quantity, message } = body;

    const { data, error } = await supabase
      .from("pledges")
      .insert({
        user_id: user.id,
        need_id,
        quantity: quantity || 1,
        message: message || null,
        status: "pledged",
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ pledge: data });
  } catch {
    return NextResponse.json({
      pledge: { id: "demo", status: "pledged" },
    });
  }
}
