import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function GET() {
  try {
    const db = await createSupabaseServerClient();
    const { data } = await db.auth.getUser();
    if (!data.user) return reply({ error: "auth_required" }, 401);
    const { data: profile, error } = await db.from("profiles")
      .select("timezone,quiet_hours_enabled,quiet_hours_start,quiet_hours_end")
      .eq("id", data.user.id)
      .maybeSingle();
    if (error) throw error;
    return reply({ ok: true, preferences: profile });
  } catch (error) {
    console.error("life_preferences_get_failed", error);
    return reply({ error: "life_preferences_get_failed" }, 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const db = await createSupabaseServerClient();
    const { data } = await db.auth.getUser();
    if (!data.user) return reply({ error: "auth_required" }, 401);
    const body = await request.json();
    const start = String(body?.quiet_hours_start || "22:00").slice(0,5);
    const end = String(body?.quiet_hours_end || "08:00").slice(0,5);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end)) {
      return reply({ error: "bad_quiet_hours" }, 400);
    }
    const { data: profile, error } = await db.from("profiles").update({
      quiet_hours_enabled: Boolean(body?.quiet_hours_enabled),
      quiet_hours_start: start,
      quiet_hours_end: end,
    }).eq("id", data.user.id).select("timezone,quiet_hours_enabled,quiet_hours_start,quiet_hours_end").single();
    if (error) throw error;
    return reply({ ok: true, preferences: profile });
  } catch (error) {
    console.error("life_preferences_patch_failed", error);
    return reply({ error: "life_preferences_patch_failed" }, 500);
  }
}
