import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getNow } from "@/lib/life-os-server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = await createSupabaseServerClient();
    const { data } = await db.auth.getUser();
    if (!data.user) return NextResponse.json({ error: "auth_required" }, { status: 401 });
    const now = await getNow(db, data.user.id);
    return NextResponse.json({ ok: true, now }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    console.error("life_now_failed", error);
    return NextResponse.json({ error: "life_now_failed" }, { status: 500 });
  }
}
