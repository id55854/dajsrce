import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Donor or recipient NGO marks a pledge as physically delivered. */
export async function PATCH(
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

  let body: { status?: string };
  try {
    body = (await req.json()) as { status?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.status !== "delivered") {
    return NextResponse.json({ error: "Only status=delivered is supported" }, { status: 400 });
  }

  const { data: deliveredAt, error } = await supabaseAdmin.rpc(
    "mark_pledge_delivered_transaction",
    { p_actor_id: user.id, p_pledge_id: pledgeId }
  );

  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 409;
    return NextResponse.json({ error: "Pledge could not be marked delivered" }, { status });
  }

  return NextResponse.json({ ok: true, delivered_at: deliveredAt });
}

/**
 * The donor withdraws a pledge that is still only a promise. Ownership and the
 * delivered/confirmed refusal both live inside the transaction — a delivered or
 * acknowledged pledge is evidence and is never withdrawn.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: pledgeId } = await params;
  if (!UUID.test(pledgeId)) {
    return NextResponse.json({ error: "Invalid pledge id" }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin.rpc("cancel_pledge_transaction", {
    p_actor_id: user.id,
    p_pledge_id: pledgeId,
  });

  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 409;
    return NextResponse.json({ error: "Pledge could not be cancelled" }, { status });
  }

  return NextResponse.json({ ok: true, cancelled: data });
}
