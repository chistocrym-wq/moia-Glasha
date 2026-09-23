import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const allowedEntities = new Set(["task", "goal", "calendar_event", "health_event", "expense", "inbox"]);

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    const user = auth.user;
    if (!user) return NextResponse.json({ error: "auth_required" }, { status: 401 });

    const form = await request.formData();
    const file = form.get("file");
    const entityType = String(form.get("entity_type") ?? "");
    const entityId = String(form.get("entity_id") ?? "");

    if (!(file instanceof File)) return NextResponse.json({ error: "file_required" }, { status: 400 });
    if (!allowedEntities.has(entityType)) return NextResponse.json({ error: "bad_entity_type" }, { status: 400 });
    if (!entityId) return NextResponse.json({ error: "entity_id_required" }, { status: 400 });
    if (file.size > 50 * 1024 * 1024) return NextResponse.json({ error: "file_too_large" }, { status: 413 });

    const safeName = file.name.replace(/[^a-zA-Z0-9а-яА-ЯёЁ._-]+/g, "_");
    const storagePath = [user.id, entityType, entityId, crypto.randomUUID() + "-" + safeName].join("/");
    const bytes = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await supabase.storage
      .from("glasha-private")
      .upload(storagePath, bytes, { contentType: file.type || "application/octet-stream", upsert: false });
    if (uploadError) throw uploadError;

    const { data, error } = await supabase.from("attachments").insert({
      user_id: user.id,
      entity_type: entityType,
      entity_id: entityId,
      file_name: file.name,
      storage_path: storagePath,
      mime_type: file.type,
      size_bytes: file.size,
    }).select("id,file_name,mime_type,size_bytes").single();

    if (error) {
      await supabase.storage.from("glasha-private").remove([storagePath]);
      throw error;
    }

    return NextResponse.json({ ok: true, attachment: data });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "upload_failed" }, { status: 500 });
  }
}
