import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { searchLife } from "@/lib/life-os-server";

export const dynamic = "force-dynamic";

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function GET(request: Request) {
  try {
    const db = await createSupabaseServerClient();
    const { data } = await db.auth.getUser();
    if (!data.user) return reply({ error: "auth_required" }, 401);
    const q = new URL(request.url).searchParams.get("q")?.trim() || "";
    if (!q) return reply({ ok: true, results: [] });
    return reply({ ok: true, results: await searchLife(db, data.user.id, q) });
  } catch (error) {
    console.error("life_search_failed", error);
    return reply({ error: "life_search_failed" }, 500);
  }
}
