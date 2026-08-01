import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { hashBearerToken } from "@/lib/security/runtime";

type Confirmation = {
  verification_id: string;
  company_id: string;
  company_slug: string;
  company_name: string;
  confirmed_at: string;
};

export async function POST(req: NextRequest) {
  let token = "";
  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const body = (await req.json()) as { token?: unknown };
      token = typeof body.token === "string" ? body.token.trim() : "";
    } else {
      const form = await req.formData();
      const value = form.get("token");
      token = typeof value === "string" ? value.trim() : "";
    }
  } catch {
    return redirectResult(req, "failed");
  }

  if (!/^[0-9a-f]{64}$/i.test(token)) {
    return redirectResult(req, "failed");
  }

  // The RPC locks the verification row and stamps both records in one DB
  // transaction. A second POST is rejected as already consumed.
  const { data, error } = await supabaseAdmin
    .rpc("confirm_company_verification", { p_token_hash: hashBearerToken(token) })
    .single();

  if (error || !data) {
    console.warn("[verification/confirm] rejected", error?.message ?? "no result");
    return redirectResult(req, "failed");
  }

  const confirmation = data as Confirmation;
  return redirectResult(req, "success", confirmation.company_slug);
}

function redirectResult(req: NextRequest, result: "success" | "failed", slug?: string) {
  const url = new URL("/verify-company", req.url);
  url.searchParams.set("result", result);
  if (slug) url.searchParams.set("slug", slug);
  return NextResponse.redirect(url, 303);
}
