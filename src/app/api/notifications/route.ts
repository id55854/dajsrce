import { NextRequest, NextResponse } from "next/server";
import { getRequestId, logError } from "@/lib/observability";

export async function GET(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const json = (body: unknown, status = 200) =>
    NextResponse.json(body, { status, headers: { "x-request-id": requestId } });

  try {
    const { createServerSupabaseClient } = await import("@/lib/supabase/server");
    const supabase = await createServerSupabaseClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return json({ notifications: [] });
    }

    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) throw error;
    return json({ notifications: data ?? [] });
  } catch (error) {
    logError("notifications.list_failed", error, { request_id: requestId });
    return json({ error: "Failed to load notifications" }, 500);
  }
}

export async function PATCH(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const json = (body: unknown, status = 200) =>
    NextResponse.json(body, { status, headers: { "x-request-id": requestId } });

  try {
    const { createServerSupabaseClient } = await import("@/lib/supabase/server");
    const supabase = await createServerSupabaseClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return json({ error: "Not authenticated" }, 401);
    }

    const body = await req.json();
    const { id, mark_all_read } = body;

    if (mark_all_read) {
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", user.id)
        .eq("is_read", false);
      if (error) throw error;
    } else if (id) {
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", id)
        .eq("user_id", user.id);
      if (error) throw error;
    } else {
      return json({ error: "Notification id or mark_all_read is required" }, 400);
    }

    return json({ ok: true });
  } catch (error) {
    logError("notifications.update_failed", error, { request_id: requestId });
    return json({ error: "Failed to update notifications" }, 500);
  }
}
