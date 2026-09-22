import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { transcriptionModel } from "@/lib/model-policy";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
      return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
    }
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "openai_not_configured" }, { status: 503 });
    }
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) return NextResponse.json({ error: "auth_required" }, { status: 401 });

    const form = await request.formData();
    const file = form.get("audio");
    if (!(file instanceof File)) return NextResponse.json({ error: "audio_required" }, { status: 400 });
    if (file.size > 25 * 1024 * 1024) return NextResponse.json({ error: "audio_too_large" }, { status: 413 });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const transcript = await openai.audio.transcriptions.create({
      file,
      model: transcriptionModel(),
      language: "ru",
      prompt: "Русская речь о личных делах, работе, финансах, здоровье, календаре, поездках, документах и целях.",
    });

    return NextResponse.json({ ok: true, text: transcript.text });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "transcription_failed" }, { status: 500 });
  }
}