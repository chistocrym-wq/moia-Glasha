import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createReminder, zonedDateTimeToUtc } from "@/lib/life-os-server";
import type { Recurrence } from "@/lib/life-os";

export const dynamic = "force-dynamic";

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function GET() {
  try {
    const db = await createSupabaseServerClient();
    const { data } = await db.auth.getUser();
    if (!data.user) return reply({ error: "auth_required" }, 401);
    const { data: reminders, error } = await db
      .from("reminders")
      .select("id,title,details,priority,category,recurrence,recurrence_interval,due_at,next_occurrence_at,active,linked_entity_type,linked_entity_id")
      .eq("user_id", data.user.id)
      .order("next_occurrence_at")
      .limit(200);
    if (error) throw error;
    return reply({ ok: true, reminders: reminders ?? [] });
  } catch (error) {
    console.error("life_reminders_get_failed", error);
    return reply({ error: "life_reminders_get_failed" }, 500);
  }
}

export async function POST(request: Request) {
  try {
    const db = await createSupabaseServerClient();
    const { data } = await db.auth.getUser();
    if (!data.user) return reply({ error: "auth_required" }, 401);
    const body = await request.json();
    const title = String(body?.title || "").trim();
    const recurrence = String(body?.recurrence || "none") as Recurrence;
    let dueAt = String(body?.due_at || "").trim();
    if (body?.local_date && body?.local_time) {
      const { data: profile, error: profileError } = await db.from("profiles").select("timezone").eq("id", data.user.id).maybeSingle();
      if (profileError) throw profileError;
      dueAt = zonedDateTimeToUtc(
        String(body.local_date),
        String(body.local_time).slice(0,5),
        profile?.timezone || "Europe/Berlin",
      ).toISOString();
    }
    if (!title || Number.isNaN(new Date(dueAt).getTime())) return reply({ error: "title_and_due_at_required" }, 400);
    if (!["none","daily","weekly","monthly"].includes(recurrence)) return reply({ error: "bad_recurrence" }, 400);
    const reminder = await createReminder(db, data.user.id, {
      title,
      dueAt,
      recurrence,
      recurrenceInterval: Number(body?.recurrence_interval) || 1,
      priority: body?.priority === "urgent" ? "urgent" : "normal",
      category: ["payment","health"].includes(body?.category) ? body.category : "general",
      details: body?.details ? String(body.details) : null,
      linkedEntityType: body?.linked_entity_type ? String(body.linked_entity_type) : null,
      linkedEntityId: body?.linked_entity_id ? String(body.linked_entity_id) : null,
    });
    return reply({ ok: true, reminder }, 201);
  } catch (error) {
    console.error("life_reminder_create_failed", error);
    return reply({ error: "life_reminder_create_failed" }, 500);
  }
}
