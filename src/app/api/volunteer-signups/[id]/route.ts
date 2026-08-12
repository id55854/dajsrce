import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The volunteer withdraws from an event they have not attended yet.
 *
 * The row is soft-cancelled, never deleted: volunteer_hours references it
 * ON DELETE CASCADE, so deleting would erase ESG evidence. Ownership and the
 * checked-in refusal are decided inside the transaction.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: signupId } = await params;
  if (!UUID.test(signupId)) {
    return NextResponse.json({ error: "Invalid signup id" }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin.rpc(
    "cancel_volunteer_signup_transaction",
    { p_actor_id: user.id, p_signup_id: signupId }
  );

  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 409;
    return NextResponse.json({ error: "Signup could not be cancelled" }, { status });
  }

  return NextResponse.json({ ok: true, cancelled: data });
}
