import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

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

  const { data: pledge, error: pledgeErr } = await supabase
    .from("pledges")
    .select("id, status, need_id")
    .eq("id", pledgeId)
    .maybeSingle();

  if (pledgeErr || !pledge) {
    return NextResponse.json({ error: "Pledge not found" }, { status: 404 });
  }
  if (pledge.status !== "delivered") {
    return NextResponse.json(
      { error: "Pledge must be marked delivered before acknowledgement" },
      { status: 409 }
    );
  }

  const signedAt = new Date().toISOString();
  const signatureHash = createHash("sha256")
    .update([pledgeId, user.id, signedAt, notes ?? ""].join("|"))
    .digest("hex");

  const { data, error } = await supabase
    .from("pledge_acknowledgements")
    .insert({
      pledge_id: pledgeId,
      institution_user_id: user.id,
      kind: "manual",
      notes: notes?.trim() || null,
      signature_hash: signatureHash,
      signed_at: signedAt,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Already acknowledged" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase.from("pledges").update({ status: "confirmed" }).eq("id", pledgeId);

  return NextResponse.json({ acknowledgement: data });
}
