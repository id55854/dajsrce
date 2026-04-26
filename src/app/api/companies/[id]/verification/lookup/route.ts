import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/companies";
import { isValidOib } from "@/lib/oib";
import {
  lookupCompany,
  SudregError,
  SudregNotFoundError,
  SudregRateLimitError,
} from "@/lib/sudreg/client";

// Looks up an OIB in the SudReg court registry without persisting anything.
// Used by the verification UI's "Look up" button to preview the snapshot
// before the user commits to sending an email.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const check = await requireMembership(supabase, id, user?.id ?? null, ["owner", "admin"]);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  let body: { oib?: unknown };
  try {
    body = (await req.json()) as { oib?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const oib = typeof body.oib === "string" ? body.oib.replace(/\s+/g, "") : "";
  if (!isValidOib(oib)) {
    return NextResponse.json(
      { error: "OIB has an invalid format or checksum" },
      { status: 400 }
    );
  }

  try {
    const company = await lookupCompany(oib);
    return NextResponse.json({ company });
  } catch (e) {
    if (e instanceof SudregNotFoundError) {
      return NextResponse.json(
        { error: "OIB nije pronađen u Sudskom registru / OIB not found in court registry" },
        { status: 404 }
      );
    }
    if (e instanceof SudregRateLimitError) {
      return NextResponse.json(
        { error: "SudReg rate limit reached. Wait a minute and retry." },
        { status: 429 }
      );
    }
    if (e instanceof SudregError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    const msg = e instanceof Error ? e.message : "Lookup failed";
    console.error("[verification/lookup]", msg, e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
