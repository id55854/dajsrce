import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: pledgeId } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let notes: string | undefined;
  try {
    const body = (await req.json()) as { notes?: string };
    notes = body.notes;
  } catch {
    notes = undefined;
  }

  if (notes != null && (typeof notes !== "string" || notes.length > 2000)) {
    return NextResponse.json({ error: "notes must be at most 2000 characters" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.rpc("acknowledge_pledge_transaction", {
    p_actor_id: user.id,
    p_pledge_id: pledgeId,
    p_notes: notes?.trim() || null,
  });

  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 409;
    return NextResponse.json({ error: "Pledge could not be acknowledged" }, { status });
  }

  return NextResponse.json({ acknowledgement: data });
}
