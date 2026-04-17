import { NextRequest, NextResponse } from "next/server";

export async function GET(_req: NextRequest) {
  try {
    const { createServerSupabaseClient } = await import("@/lib/supabase/server");
    const supabase = await createServerSupabaseClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ pledges: [] });
    }

    const { data, error } = await supabase
      .from("pledges")
      .select("*, need:needs(*, institution:institutions(id, name, category))")
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
    const { createServerSupabaseClient } = await import("@/lib/supabase/server");
    const supabase = await createServerSupabaseClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();

    if (!existingProfile) {
      await supabase.from("profiles").insert({
        id: user.id,
        email: user.email!,
        name: user.user_metadata?.name || user.email!.split("@")[0],
        role: user.user_metadata?.role || "individual",
      });
    }

    const body = await req.json();
    const { need_id, quantity, message } = body;
    const qty = quantity || 1;

    const { data, error } = await supabase
      .from("pledges")
      .insert({
        user_id: user.id,
        need_id,
        quantity: qty,
        message: message || null,
        status: "pledged",
      })
      .select()
      .single();

    if (error) throw error;

    const { data: need } = await supabase
      .from("needs")
      .select("quantity_pledged")
      .eq("id", need_id)
      .single();

    if (need) {
      await supabase
        .from("needs")
        .update({ quantity_pledged: (need.quantity_pledged || 0) + qty })
        .eq("id", need_id);
    }

    // Increment total_pledges on user profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("total_pledges")
      .eq("id", user.id)
      .single();

    if (profile) {
      await supabase
        .from("profiles")
        .update({ total_pledges: (profile.total_pledges || 0) + 1 })
        .eq("id", user.id);
    }

    return NextResponse.json({ pledge: data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to create pledge";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
