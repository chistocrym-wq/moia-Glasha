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
    if (!id || !["cancel","move_tomorrow","move_personal","move_work","done","restore"].includes(action)) {
      return NextResponse.json({ error: "bad_task_action" }, { status: 400 });
    }

    if (action === "move_personal" || action === "move_work") {
      const { data: moved, error: moveError } = await db.rpc("glasha_move_task_area", {
        p_task_id: id,
        p_area: action === "move_work" ? "work" : "personal",
        p_move_children: true,
      });
      if (moveError) throw moveError;
      return NextResponse.json({ ok: true, task: moved?.[0] ?? null, moved: moved ?? [] }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
    }

    const { data: existing, error: existingError } = await db.from("tasks")
      .select("id,title,status,is_project")
      .eq("user_id", data.user.id)
      .eq("id", id)
      .single();
    if (existingError) throw existingError;

    if (action === "done" && existing.is_project) {
      const { count, error: childrenError } = await db.from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("user_id", data.user.id)
        .eq("parent_task_id", id)
        .neq("status", "cancelled")
        .neq("status", "done");
      if (childrenError) throw childrenError;
      if ((count ?? 0) > 0) return NextResponse.json({ error: "project_has_incomplete_subtasks" }, { status: 409 });
    }

    let patch: Record<string, unknown>;
    if (action === "cancel") patch = { status: "cancelled", updated_at: new Date().toISOString() };
    else if (action === "done") patch = { status: "done", updated_at: new Date().toISOString() };
    else if (action === "restore") patch = { status: existing.is_project ? "doing" : "todo", updated_at: new Date().toISOString() };
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
      .select("id,title,area,status,completed_at,due_date,due_time,priority,parent_task_id,is_project")
      .single();
    if (error) throw error;
    return NextResponse.json({ ok: true, task }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    console.error("life_task_action_failed", error);
    return NextResponse.json({ error: "life_task_action_failed" }, { status: 500 });
  }
}
