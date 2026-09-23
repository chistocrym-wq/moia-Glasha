import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getReview } from "@/lib/life-os-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const db = await createSupabaseServerClient();
    const { data } = await db.auth.getUser();
    if (!data.user) return NextResponse.json({ error: "auth_required" }, { status: 401 });
    const kind = new URL(request.url).searchParams.get("kind");
    if (kind !== "morning" && kind !== "evening" && kind !== "weekly") {
      return NextResponse.json({ error: "bad_review_kind" }, { status: 400 });
    }
    return NextResponse.json(
      { ok: true, review: await getReview(db, data.user.id, kind) },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    console.error("life_review_failed", error);
    return NextResponse.json({ error: "life_review_failed" }, { status: 500 });
  }
}
