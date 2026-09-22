import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "openai_not_configured" }, { status: 503 });
    }

    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    const user = auth.user;
    if (!user) return NextResponse.json({ error: "auth_required" }, { status: 401 });

    const body = await request.json();
    const question = String(body?.question ?? "").trim();
    if (!question) return NextResponse.json({ error: "question_required" }, { status: 400 });

    const [{ data: tasks }, { data: goals }, { data: events }] = await Promise.all([
      supabase.from("tasks").select("title,area,due_date,due_time,status,priority").eq("user_id", user.id).neq("status", "done").limit(30),
      supabase.from("goals").select("title,description,target_date,status,kind").eq("user_id", user.id).eq("status", "active").limit(20),
      supabase.from("calendar_events").select("title,kind,start_at").eq("user_id", user.id).gte("start_at", new Date().toISOString()).order("start_at").limit(20),
    ]);

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.responses.create({
      model: process.env.OPENAI_ADVISOR_MODEL || "gpt-5.6-terra",
      store: false,
      reasoning: { effort: "medium" },
      instructions:
        "Ты — советчик внутри личного помощника Глаша. Отвечай по-русски, практично и без лишней воды. " +
        "Используй личный контекст только когда он относится к вопросу. Не придумывай отсутствующие факты. " +
        "Для цели предлагай конкретные ближайшие шаги. Для высокорисковых медицинских, юридических и финансовых вопросов " +
        "не подменяй профессиональную консультацию.",
      input:
        "Вопрос пользователя:\n" + question +
        "\n\nОткрытые задачи:\n" + JSON.stringify(tasks ?? []) +
        "\n\nАктивные цели:\n" + JSON.stringify(goals ?? []) +
        "\n\nБлижайшие события:\n" + JSON.stringify(events ?? []),
    });

    return NextResponse.json({ ok: true, answer: response.output_text });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "advisor_failed" }, { status: 500 });
  }
}
