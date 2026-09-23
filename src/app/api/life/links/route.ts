import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createEntityLink } from "@/lib/life-os-server";

export const dynamic = "force-dynamic";

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function GET(request: Request) {
  try {
    const db = await createSupabaseServerClient();
    const { data } = await db.auth.getUser();
    if (!data.user) return reply({ error: "auth_required" }, 401);
    const url = new URL(request.url);
    const type = url.searchParams.get("type");
    const id = url.searchParams.get("id");
    if (!type || !id) return reply({ error: "type_and_id_required" }, 400);
    const { data: links, error } = await db
      .from("entity_links")
      .select("id,source_type,source_id,target_type,target_id,relation_type,note,created_at")
      .eq("user_id", data.user.id)
      .or(`and(source_type.eq.${type},source_id.eq.${id}),and(target_type.eq.${type},target_id.eq.${id})`)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return reply({ ok: true, links: links ?? [] });
  } catch (error) {
    console.error("life_links_get_failed", error);
    return reply({ error: "life_links_get_failed" }, 500);
  }
}

export async function POST(request: Request) {
  try {
    const db = await createSupabaseServerClient();
    const { data } = await db.auth.getUser();
    if (!data.user) return reply({ error: "auth_required" }, 401);
    const body = await request.json();
    const required = ["source_type","source_id","target_type","target_id","relation_type"] as const;
    if (required.some((key) => !String(body?.[key] || "").trim())) return reply({ error: "link_fields_required" }, 400);
    const link = await createEntityLink(db, data.user.id, {
      sourceType: String(body.source_type),
      sourceId: String(body.source_id),
      targetType: String(body.target_type),
      targetId: String(body.target_id),
      relationType: String(body.relation_type),
      note: body.note ? String(body.note) : null,
    });
    return reply({ ok: true, link }, 201);
  } catch (error) {
    console.error("life_link_create_failed", error);
    return reply({ error: "life_link_create_failed" }, 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const db = await createSupabaseServerClient();
    const { data } = await db.auth.getUser();
    if (!data.user) return reply({ error: "auth_required" }, 401);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return reply({ error: "id_required" }, 400);
    const { error } = await db.from("entity_links").delete().eq("user_id", data.user.id).eq("id", id);
    if (error) throw error;
    return reply({ ok: true });
  } catch (error) {
    console.error("life_link_delete_failed", error);
    return reply({ error: "life_link_delete_failed" }, 500);
  }
}
