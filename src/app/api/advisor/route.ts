import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { chooseAdvisorModel } from "@/lib/model-policy";

function hasAny(text: string, hints: string[]) {
  const value = text.toLocaleLowerCase("ru-RU");
  return hints.some((hint) => value.includes(hint));
}

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

    const needsGoals = hasAny(question, ["цель", "мечт", "b1", "экзам", "обуч", "немец"]);
    const needsCalendar = hasAny(question, ["когда", "недел", "сегодня", "завтра", "календар", "трениров", "врач", "сроч", "время"]);
    const needsTasks = needsGoals || needsCalendar || hasAny(question, ["задач", "дел", "работ", "сроч", "план"]);
    const needsFinance = hasAny(question, ["расход", "потрат", "деньг", "бюджет", "финанс"]);
    const needsWeb = body?.use_web === true || hasAny(question, [
      "сейчас", "сегодня", "актуаль", "новост", "цена", "расписан", "билет", "погода", "курс валют", "найди в интернете"
    ]);

    const tasksPromise = needsTasks
      ? supabase.from("tasks").select("title,area,due_date,due_time,status,priority,goal_id").eq("user_id", user.id).neq("status", "done").order("due_date").limit(20)
      : Promise.resolve({ data: [], error: null });
    const goalsPromise = needsGoals
      ? supabase.from("goals").select("id,title,description,target_date,status,kind").eq("user_id", user.id).eq("status", "active").limit(15)
      : Promise.resolve({ data: [], error: null });
    const eventsPromise = needsCalendar
      ? supabase.from("calendar_events").select("title,kind,area,start_at,end_at").eq("user_id", user.id).gte("start_at", new Date().toISOString()).order("start_at").limit(20)
      : Promise.resolve({ data: [], error: null });
    const expensesPromise = needsFinance
      ? supabase.from("expenses").select("amount,currency,occurred_at,merchant,note").eq("user_id", user.id).order("occurred_at", { ascending: false }).limit(40)
      : Promise.resolve({ data: [], error: null });

    const [taskRes, goalRes, eventRes, expenseRes] = await Promise.all([
      tasksPromise, goalsPromise, eventsPromise, expensesPromise
    ]);
    const error = taskRes.error || goalRes.error || eventRes.error || expenseRes.error;
    if (error) throw error;

    const contextItems =
      (taskRes.data?.length || 0) +
      (goalRes.data?.length || 0) +
      (eventRes.data?.length || 0) +
      (expenseRes.data?.length || 0);

    const selection = chooseAdvisorModel({
      question,
      explicitDeep: body?.mode === "deep",
      useWeb: needsWeb,
      contextItems
    });

    const context = [
      taskRes.data?.length ? "Открытые задачи:\n" + JSON.stringify(taskRes.data) : null,
      goalRes.data?.length ? "Активные цели:\n" + JSON.stringify(goalRes.data) : null,
      eventRes.data?.length ? "Ближайшие события:\n" + JSON.stringify(eventRes.data) : null,
      expenseRes.data?.length ? "Последние расходы:\n" + JSON.stringify(expenseRes.data) : null
    ].filter(Boolean).join("\n\n");

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.responses.create({
      model: selection.model,
      store: false,
      reasoning: { effort: selection.reasoning },
      ...(needsWeb ? { tools: [{ type: "web_search" as const }] } : {}),
      instructions:
        "Ты — советчик внутри личного помощника Глаша. Отвечай по-русски, практично и без лишней воды. " +
        "Используй только переданный релевантный личный контекст. Не придумывай отсутствующие факты. " +
        "Для цели предлагай конкретные ближайшие шаги. Если используешь web search, отделяй актуальные внешние данные от личных данных пользователя. " +
        "Не утверждай, что внешнее действие выполнено, если оно не было реально выполнено. " +
        "Для высокорисковых медицинских, юридических и финансовых вопросов не подменяй профессиональную консультацию.",
      input:
        "Вопрос пользователя:\n" + question +
        (context ? "\n\nРелевантный личный контекст:\n" + context : "\n\nЛичный контекст для этого вопроса не нужен.")
    });

    return NextResponse.json({
      ok: true,
      answer: response.output_text,
      model_tier: selection.tier,
      used_web: needsWeb,
      context_items: contextItems
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "advisor_failed" }, { status: 500 });
  }
}
