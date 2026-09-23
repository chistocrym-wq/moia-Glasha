import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { transcriptionModel } from "@/lib/model-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Pragma": "no-cache",
    },
  });
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  let userId: string | null = null;
  let modelUsed: string | null = null;

  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
      return privateJson({ error: "supabase_not_configured" }, 503);
    }
    if (!process.env.OPENAI_API_KEY) {
      return privateJson({ error: "openai_not_configured" }, 503);
    }

    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) return privateJson({ error: "auth_required" }, 401);
    userId = data.user.id;

    const form = await request.formData();
    const file = form.get("audio");
    if (!(file instanceof File)) return privateJson({ error: "audio_required" }, 400);
    if (file.size > 25 * 1024 * 1024) return privateJson({ error: "audio_too_large" }, 413);

    modelUsed = transcriptionModel();
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const transcript = await openai.audio.transcriptions.create({
      file,
      model: modelUsed,
      language: "ru",
      prompt: "Русская речь о личных делах, работе, финансах, здоровье, календаре, поездках, документах и целях.",
    });

    await supabase.from("request_telemetry").insert({
      user_id: userId,
      route_type: "AI_FAST",
      intent: "voice_transcription",
      latency_ms: Math.max(0, Date.now() - startedAt),
      openai_calls_count: 1,
      web_search_used: false,
      model_used: modelUsed,
      supabase_queries_count: 0,
    }).then(({ error }) => {
      if (error) console.error("voice_telemetry_insert_failed", { code: error.code, message: error.message });
    });

    return privateJson({ ok: true, text: transcript.text });
  } catch (error) {
    console.error("transcription_failed", {
      message: error instanceof Error ? error.message : String(error),
      userId,
      modelUsed,
    });
    return privateJson({ error: "transcription_failed" }, 500);
  }
}
