import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("ru-RU");
}

function privateJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("Pragma", "no-cache");
  return NextResponse.json(body, { ...init, headers });
}

export async function GET(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    const user = auth.user;
    if (!user) return privateJson({ error: "auth_required" }, { status: 401 });

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
      if (!data) return privateJson({ error: "not_found" }, { status: 404 });

      const { data: signed, error: signError } = await supabase.storage
        .from("glasha-private")
        .createSignedUrl(data.storage_path, 60 * 10);
      if (signError) throw signError;

      return privateJson({
        ok: true,
        document: {
          id: data.id,
          title: data.title,
          owner_person: data.owner_person,
          document_type: data.document_type,
          expiry_date: data.expiry_date,
          tags: data.tags,
          mime_type: data.mime_type,
          size_bytes: data.size_bytes,
          created_at: data.created_at,
          signed_url: signed.signedUrl,
        },
      });
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

    return privateJson({ ok: true, documents: rows });
  } catch (error) {
    console.error("documents_get_failed", error);
    return privateJson({ error: "documents_failed" }, { status: 500 });
  }
}

export async function POST() {
  return privateJson(
    {
      error: "direct_upload_required",
      message: "Document binaries must be uploaded directly from the authenticated browser to Supabase Storage.",
    },
    { status: 405, headers: { Allow: "GET" } },
  );
}
