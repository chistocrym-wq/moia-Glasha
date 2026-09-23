import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    supabase: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
    transcribe: Boolean(process.env.OPENAI_API_KEY),
  });
}
