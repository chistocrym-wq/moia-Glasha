import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Parsed = {
  action:
    | "create_expense"
    | "create_task"
    | "create_event"
    | "log_health"
    | "create_goal"
    | "save_note"
    | "query_tasks"
    | "query_expenses"
    | "advice";
  title: string | null;
  description: string | null;
  amount: number | null;
  currency: string | null;
  category_slug: string | null;
  merchant: string | null;
  area: "personal" | "work" | null;
  due_date: string | null;
  due_time: string | null;
  event_kind: "event" | "birthday" | "deadline" | "reminder" | "appointment" | "trip" | "health" | "cycle" | null;
  start_at: string | null;
  end_at: string | null;
  all_day: boolean | null;
  health_kind: "cycle_start" | "cycle_end" | "symptom" | "medication" | "appointment" | "measurement" | "note" | null;
  goal_kind: "dream" | "goal" | null;
  target_date: string | null;
  query_range: "today" | "tomorrow" | "week" | "month" | "all" | null;
  tags: string[];
  confidence: number;
  needs_clarification: boolean;
  clarification_question: string | null;
};

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: {
      type: "string",
      enum: ["create_expense","create_task","create_event","log_health","create_goal","save_note","query_tasks","query_expenses","advice"],
    },
    title: { type: ["string","null"] },
    description: { type: ["string","null"] },
    amount: { type: ["number","null"] },
    currency: { type: ["string","null"] },
    category_slug: { type: ["string","null"] },
    merchant: { type: ["string","null"] },
    area: { type: ["string","null"], enum: ["personal","work",null] },
    due_date: { type: ["string","null"] },
    due_time: { type: ["string","null"] },
    event_kind: { type: ["string","null"], enum: ["event","birthday","deadline","reminder","appointment","trip","health","cycle",null] },
    start_at: { type: ["string","null"] },
    end_at: { type: ["string","null"] },
    all_day: { type: ["boolean","null"] },
    health_kind: { type: ["string","null"], enum: ["cycle_start","cycle_end","symptom","medication","appointment","measurement","note",null] },
    goal_kind: { type: ["string","null"], enum: ["dream","goal",null] },
    target_date: { type: ["string","null"] },
    query_range: { type: ["string","null"], enum: ["today","tomorrow","week","month","all",null] },
    tags: { type: "array", items: { type: "string" } },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    needs_clarification: { type: "boolean" },
    clarification_question: { type: ["string","null"] },
  },
  required: [
    "action","title","description","amount","currency","category_slug","merchant","area",
    "due_date","due_time","event_kind","start_at","end_at","all_day","health_kind",
    "goal_kind","target_date","query_range","tags","confidence","needs_clarification","clarification_question"
  ],
} as const;

function dateForRange(range: Parsed["query_range"], timezone: string) {
  const now = new Date();
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(now);
  const base = new Date(local + "T12:00:00Z");
  if (range === "tomorrow") base.setUTCDate(base.getUTCDate() + 1);
  return base.toISOString().slice(0, 10);
}

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    const user = authData.user;
    if (!user) return NextResponse.json({ error: "auth_required" }, { status: 401 });

    const body = await request.json();
    const text = String(body?.text ?? "").trim();
    if (!text) return NextResponse.json({ error: "empty_text" }, { status: 400 });

    const [{ data: profile }, { data: categories }] = await Promise.all([
      supabase.from("profiles").select("timezone,default_currency").eq("id", user.id).single(),
      supabase.from("expense_categories").select("id,name,slug,keywords").eq("user_id", user.id).order("sort_order"),
    ]);

    const timezone = profile?.timezone || "Europe/Berlin";
    const defaultCurrency = profile?.default_currency || "RUB";
    const now = new Date().toISOString();
    const categoryText = (categories ?? []).map((c) =>
      `${c.slug} = ${c.name}; keywords: ${(c.keywords ?? []).join(", ")}`
    ).join("\n");

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
      store: false,
      reasoning: { effort: "low" },
      instructions:
        "Ты — маршрутизатор личного помощника Глаша. Превращай русскую естественную речь в одно структурированное действие. " +
        "Не придумывай сумму, дату, человека или категорию. Если данных не хватает для записи, поставь needs_clarification=true. " +
        "Для расходов выбирай одну категорию из списка пользователя. Кофе должен попадать в coffee_cafes, расходы на внешность/одежду/уход — self_care, " +
        "аренда и коммунальные — housing, обучение — education, расходы на сына — child. " +
        "Если пользователь спрашивает список или итог, используй query_tasks/query_expenses, а не создание записи. " +
        "Если пользователь сообщает начало менструации, используй log_health с health_kind=cycle_start и event_kind=cycle. " +
        "Если фраза про работу, task.area=work. Отвечай только по JSON-схеме.",
      input:
        `Текущее время UTC: ${now}\nЧасовой пояс пользователя: ${timezone}\nВалюта по умолчанию: ${defaultCurrency}\n` +
        `Категории расходов:\n${categoryText}\n\nФраза пользователя: ${text}`,
      text: {
        format: {
          type: "json_schema",
          name: "glasha_action",
          schema,
          strict: true,
        },
      },
    });

    const parsed = JSON.parse(response.output_text) as Parsed;

    await supabase.from("inbox_entries").insert({
      user_id: user.id,
      text,
      source: body?.source === "voice" ? "voice" : "text",
      intent: parsed.action,
      structured: parsed,
      processed: !parsed.needs_clarification,
    });

    if (parsed.needs_clarification) {
      return NextResponse.json({
        ok: true,
        action: parsed.action,
        needs_clarification: true,
        reply: parsed.clarification_question || "Уточни, пожалуйста, недостающую деталь.",
      });
    }

    if (parsed.action === "create_expense") {
      if (parsed.amount == null) {
        return NextResponse.json({ ok: true, needs_clarification: true, reply: "Сколько именно ты потратила?" });
      }
      const category = (categories ?? []).find((c) => c.slug === parsed.category_slug)
        ?? (categories ?? []).find((c) => c.slug === "other");
      const { data, error } = await supabase.from("expenses").insert({
        user_id: user.id,
        category_id: category?.id ?? null,
        amount: parsed.amount,
        currency: parsed.currency || defaultCurrency,
        merchant: parsed.merchant,
        note: parsed.description,
        raw_text: text,
        source: body?.source === "voice" ? "voice" : "text",
        tags: parsed.tags,
      }).select("id,amount,currency").single();
      if (error) throw error;
      return NextResponse.json({
        ok: true, action: parsed.action, data,
        reply: `Записала: ${parsed.amount} ${parsed.currency || defaultCurrency} — ${category?.name || "Другое"}.`
      });
    }

    if (parsed.action === "create_task") {
      const { data, error } = await supabase.from("tasks").insert({
        user_id: user.id,
        area: parsed.area || "personal",
        title: parsed.title || text,
        description: parsed.description,
        due_date: parsed.due_date,
        due_time: parsed.due_time,
        raw_text: text,
        source: body?.source === "voice" ? "voice" : "text",
      }).select("id,title,area,due_date,due_time").single();
      if (error) throw error;
      return NextResponse.json({
        ok: true, action: parsed.action, data,
        reply: `Записала в ${data.area === "work" ? "рабочие" : "личные"} дела${data.due_date ? ` на ${data.due_date}` : ""}.`
      });
    }

    if (parsed.action === "create_event") {
      if (!parsed.start_at) {
        return NextResponse.json({ ok: true, needs_clarification: true, reply: "На какую дату и время поставить событие?" });
      }
      const { data, error } = await supabase.from("calendar_events").insert({
        user_id: user.id,
        kind: parsed.event_kind || "event",
        title: parsed.title || text,
        description: parsed.description,
        start_at: parsed.start_at,
        end_at: parsed.end_at,
        all_day: parsed.all_day ?? false,
        raw_text: text,
        source: body?.source === "voice" ? "voice" : "text",
      }).select("id,title,start_at").single();
      if (error) throw error;
      return NextResponse.json({ ok: true, action: parsed.action, data, reply: "Добавила событие в календарь." });
    }

    if (parsed.action === "log_health") {
      const kind = parsed.health_kind || "note";
      const occurredAt = parsed.start_at || new Date().toISOString();
      const { data, error } = await supabase.from("health_events").insert({
        user_id: user.id,
        kind,
        occurred_at: occurredAt,
        title: parsed.title,
        details: { description: parsed.description, tags: parsed.tags },
        raw_text: text,
        source: body?.source === "voice" ? "voice" : "text",
      }).select("id,kind,occurred_at").single();
      if (error) throw error;

      if (kind === "cycle_start" || kind === "cycle_end") {
        await supabase.from("calendar_events").insert({
          user_id: user.id,
          kind: "cycle",
          title: kind === "cycle_start" ? "Начало цикла" : "Окончание цикла",
          start_at: occurredAt,
          all_day: true,
          raw_text: text,
          source: body?.source === "voice" ? "voice" : "text",
        });
      }

      return NextResponse.json({ ok: true, action: parsed.action, data, reply: "Записала в здоровье и календарь." });
    }

    if (parsed.action === "create_goal") {
      const { data, error } = await supabase.from("goals").insert({
        user_id: user.id,
        kind: parsed.goal_kind || "goal",
        title: parsed.title || text,
        description: parsed.description,
        target_date: parsed.target_date,
      }).select("id,title,kind,target_date").single();
      if (error) throw error;
      return NextResponse.json({ ok: true, action: parsed.action, data, reply: "Сохранила цель. Дальше сможем разложить её на шаги." });
    }

    if (parsed.action === "save_note") {
      return NextResponse.json({ ok: true, action: parsed.action, reply: "Сохранила мысль во входящие." });
    }

    if (parsed.action === "query_tasks") {
      const range = parsed.query_range || "today";
      let query = supabase.from("tasks").select("id,title,area,due_date,due_time,status").eq("user_id", user.id).neq("status", "done").order("due_date");
      if (range === "today" || range === "tomorrow") query = query.eq("due_date", dateForRange(range, timezone));
      const { data, error } = await query;
      if (error) throw error;
      return NextResponse.json({
        ok: true, action: parsed.action, data,
        reply: data?.length ? `Нашла задач: ${data.length}.` : "На этот период задач нет."
      });
    }

    if (parsed.action === "query_expenses") {
      let query = supabase.from("expenses")
        .select("id,amount,currency,occurred_at,tags,expense_categories(name,slug)")
        .eq("user_id", user.id)
        .order("occurred_at", { ascending: false })
        .limit(200);
      const { data, error } = await query;
      if (error) throw error;
      return NextResponse.json({ ok: true, action: parsed.action, data, reply: "Собрала расходы." });
    }

    return NextResponse.json({
      ok: true,
      action: "advice",
      reply: "Советчик подключим к отдельному режиму с поиском и контекстом твоих данных.",
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "assistant_failed" }, { status: 500 });
  }
}
