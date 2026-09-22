import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const allowedOwners = new Set(["user", "child", "mother", "work", "other"]);

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("ru-RU");
}

export async function GET(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    const user = auth.user;
    if (!user) return NextResponse.json({ error: "auth_required" }, { status: 401 });

    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const q = normalize(url.searchParams.get("q") || "");

    if (id) {
      const { data, error } = await supabase
        .from("documents")
        .select("id,title,owner_person,document_type,expiry_date,tags,storage_path,mime_type,size_bytes,created_at")
        .eq("user_id", user.id)
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });

      const { data: signed, error: signError } = await supabase.storage
        .from("glasha-private")
        .createSignedUrl(data.storage_path, 60 * 10);
      if (signError) throw signError;
      return NextResponse.json({ ok: true, document: { ...data, signed_url: signed.signedUrl } });
    }

    const { data, error } = await supabase
      .from("documents")
      .select("id,title,owner_person,document_type,expiry_date,tags,mime_type,size_bytes,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;

    const rows = (data ?? []).filter((doc) => {
      if (!q) return true;
      const haystack = [
        doc.title,
        doc.owner_person,
        doc.document_type,
        ...(doc.tags ?? []),
      ].filter(Boolean).join(" ").toLocaleLowerCase("ru-RU");
      return haystack.includes(q);
    });

    return NextResponse.json({ ok: true, documents: rows });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "documents_failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    const user = auth.user;
    if (!user) return NextResponse.json({ error: "auth_required" }, { status: 401 });

    const form = await request.formData();
    const file = form.get("file");
    const ownerPerson = String(form.get("owner_person") || "user");
    const documentType = String(form.get("document_type") || "other").trim() || "other";
    const title = String(form.get("title") || "").trim();
    const expiryDate = String(form.get("expiry_date") || "").trim() || null;
    const tags = String(form.get("tags") || "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 30);

    if (!(file instanceof File)) return NextResponse.json({ error: "file_required" }, { status: 400 });
    if (!title) return NextResponse.json({ error: "title_required" }, { status: 400 });
    if (!allowedOwners.has(ownerPerson)) return NextResponse.json({ error: "bad_owner" }, { status: 400 });
    if (file.size > 50 * 1024 * 1024) return NextResponse.json({ error: "file_too_large" }, { status: 413 });

    const safeName = file.name.replace(/[^a-zA-Z0-9а-яА-ЯёЁ._-]+/g, "_");
    const storagePath = [user.id, "documents", crypto.randomUUID() + "-" + safeName].join("/");
    const bytes = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await supabase.storage
      .from("glasha-private")
      .upload(storagePath, bytes, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
    if (uploadError) throw uploadError;

    const { data, error } = await supabase
      .from("documents")
      .insert({
        user_id: user.id,
        owner_person: ownerPerson,
        document_type: documentType,
        title,
        expiry_date: expiryDate,
        tags,
        storage_path: storagePath,
        mime_type: file.type || null,
        size_bytes: file.size,
      })
      .select("id,title,owner_person,document_type,expiry_date,tags,mime_type,size_bytes,created_at")
      .single();

    if (error) {
      await supabase.storage.from("glasha-private").remove([storagePath]);
      throw error;
    }

    return NextResponse.json({ ok: true, document: data });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "document_upload_failed" }, { status: 500 });
  }
}
