import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { actOnNotification, listNotifications } from "@/lib/life-os-server";

export const dynamic = "force-dynamic";

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function GET() {
  try {
    const db = await createSupabaseServerClient();
    const { data } = await db.auth.getUser();
    if (!data.user) return reply({ error: "auth_required" }, 401);
    return reply({ ok: true, notifications: await listNotifications(db, data.user.id) });
  } catch (error) {
    console.error("life_notifications_get_failed", error);
    return reply({ error: "life_notifications_get_failed" }, 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const db = await createSupabaseServerClient();
    const { data } = await db.auth.getUser();
    if (!data.user) return reply({ error: "auth_required" }, 401);
    const body = await request.json();
    const id = String(body?.id || "").trim();
    const action = String(body?.action || "");
    if (!id || !["seen","snooze","skip","done"].includes(action)) return reply({ error: "bad_notification_action" }, 400);
    const result = await actOnNotification(
      db,
      data.user.id,
      id,
      action as "seen" | "snooze" | "skip" | "done",
      Number(body?.snooze_minutes) || 60,
    );
    return reply({ ok: true, result });
  } catch (error) {
    console.error("life_notification_action_failed", error);
    return reply({ error: "life_notification_action_failed" }, 500);
  }
}
