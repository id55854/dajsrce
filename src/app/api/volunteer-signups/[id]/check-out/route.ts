import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: signupId } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin.rpc("volunteer_checkout_transaction", {
    p_actor_id: user.id,
    p_signup_id: signupId,
  });
  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 409;
    return NextResponse.json({ error: "Could not check out this volunteer" }, { status });
  }

  const result = data as { checked_out_at?: string; hours?: number; already?: boolean } | null;
  return NextResponse.json({ ok: true, ...result });
}
