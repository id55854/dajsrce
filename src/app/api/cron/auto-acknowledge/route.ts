import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const vercelCron = req.headers.get("x-vercel-cron");
  if (secret && auth !== `Bearer ${secret}` && vercelCron !== "1") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const days = Math.max(1, Number.parseInt(process.env.AUTO_ACKNOWLEDGE_DAYS ?? "14", 10) || 14);
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);

  const { data: candidates, error: qErr } = await supabaseAdmin
    .from("pledges")
    .select("id, need_id")
    .eq("status", "delivered")
    .not("delivered_at", "is", null)
    .lt("delivered_at", cutoff.toISOString());

  if (qErr) {
    return NextResponse.json({ error: qErr.message }, { status: 500 });
  }

  let inserted = 0;
  for (const row of candidates ?? []) {
    const { data: existing } = await supabaseAdmin
      .from("pledge_acknowledgements")
      .select("id")
      .eq("pledge_id", row.id)
      .maybeSingle();
    if (existing) continue;

    const { data: need } = await supabaseAdmin
      .from("needs")
      .select("institution_id")
      .eq("id", row.need_id)
      .maybeSingle();
    if (!need?.institution_id) continue;

    const { data: instUser } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("institution_id", need.institution_id)
      .eq("role", "ngo")
      .limit(1)
      .maybeSingle();

    const signedAt = new Date().toISOString();
    const signatureHash = createHash("sha256")
      .update(["auto", row.id, signedAt].join("|"))
      .digest("hex");

    const { error: insErr } = await supabaseAdmin.from("pledge_acknowledgements").insert({
      pledge_id: row.id,
      institution_user_id: instUser?.id ?? null,
      kind: "auto",
      notes: `Auto-acknowledged after ${days} days without manual confirmation.`,
      signature_hash: signatureHash,
      signed_at: signedAt,
    });

    if (!insErr) {
      inserted += 1;
      await supabaseAdmin.from("pledges").update({ status: "confirmed" }).eq("id", row.id);
    }
  }

  return NextResponse.json({ ok: true, processed: candidates?.length ?? 0, inserted });
}
