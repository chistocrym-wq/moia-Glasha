import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function PATCH(request: Request) {
  try {
    const db = await createSupabaseServerClient();
    const { data } = await db.auth.getUser();
    if (!data.user) return reply({ error: "auth_required" }, 401);

    const body = await request.json();
    const id = String(body?.id || "").trim();
    const action = String(body?.action || "");
    if (!id || action !== "processed") return reply({ error: "bad_inbox_action" }, 400);

    const { data: item, error } = await db.from("inbox_entries")
      .update({ processed: true })
      .eq("user_id", data.user.id)
      .eq("id", id)
      .select("id,processed")
      .single();
    if (error) throw error;
    return reply({ ok: true, item });
  } catch (error) {
    console.error("life_inbox_action_failed", error);
    return reply({ error: "life_inbox_action_failed" }, 500);
  }
}
