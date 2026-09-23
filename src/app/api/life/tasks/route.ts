import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { localDate } from "@/lib/life-os-server";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  try {
    const db = await createSupabaseServerClient();
    const { data } = await db.auth.getUser();
    if (!data.user) return NextResponse.json({ error: "auth_required" }, { status: 401 });

    const body = await request.json();
    const id = String(body?.id || "").trim();
    const action = String(body?.action || "");
    if (!id || !["cancel","move_tomorrow","move_personal","move_work"].includes(action)) {
      return NextResponse.json({ error: "bad_task_action" }, { status: 400 });
    }

    let patch: Record<string, unknown>;
    if (action === "cancel") patch = { status: "cancelled", updated_at: new Date().toISOString() };
    else if (action === "move_personal") patch = { area: "personal", updated_at: new Date().toISOString() };
    else if (action === "move_work") patch = { area: "work", updated_at: new Date().toISOString() };
    else {
      const { data: profile, error: profileError } = await db.from("profiles").select("timezone").eq("id", data.user.id).maybeSingle();
      if (profileError) throw profileError;
      patch = { due_date: localDate(profile?.timezone || "Europe/Berlin", 1), updated_at: new Date().toISOString() };
    }

    const { data: task, error } = await db
      .from("tasks")
      .update(patch)
      .eq("user_id", data.user.id)
      .eq("id", id)
      .select("id,title,area,status,due_date,due_time,priority,parent_task_id,is_project")
      .single();
    if (error) throw error;
    return NextResponse.json({ ok: true, task }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    console.error("life_task_action_failed", error);
    return NextResponse.json({ error: "life_task_action_failed" }, { status: 500 });
  }
}
