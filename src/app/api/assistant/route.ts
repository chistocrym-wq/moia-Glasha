import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fastModel } from "@/lib/model-policy";

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
  occurred_at: string | null;
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
  query_start_date: string | null;
  query_end_date: string | null;
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
    occurred_at: { type: ["string","null"] },
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
    query_start_date: { type: ["string","null"] },
    query_end_date: { type: ["string","null"] },
    tags: { type: "array", items: { type: "string" } },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    needs_clarification: { type: "boolean" },
    clarification_question: { type: ["string","null"] },
  },
  required: [
    "action","title","description","amount","currency","category_slug","merchant","occurred_at","area",
    "due_date","due_time","event_kind","start_at","end_at","all_day","health_kind","goal_kind",
    "target_date","query_range","query_start_date","query_end_date","tags","confidence",
    "needs_clarification","clarification_question"
  ],
} as const;

function localDate(timezone: string, offsetDays = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
  const d = new Date(parts + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function taskBounds(range: Parsed["query_range"], timezone: string) {
  const today = localDate(timezone);
  if (range === "today") return { start: today, end: today };
  if (range === "tomorrow") {
    const t = localDate(timezone, 1);
    return { start: t, end: t };
  }
  if (range === "week") return { start: today, end: localDate(timezone, 7) };
  if (range === "month") {
    const start = today.slice(0, 8) + "01";
    const d = new Date(start + "T12:00:00Z");
    d.setUTCMonth(d.getUTCMonth() + 1);
    d.setUTCDate(0);
    return { start, end: d.toISOString().slice(0, 10) };
  }
  return null;
}

function sumExpenses(rows: Array<{ amount: number | string; currency: string; expense_categories?: { name?: string; slug?: string } | null }>) {
  const byCurrency: Record<string, number> = {};
  const byCategory: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    const amount = Number(row.amount) || 0;
    const currency = row.currency || "RUB";
    const category = row.expense_categories?.name || "Другое";
    byCurrency[currency] = (byCurrency[currency] || 0) + amount;
    byCategory[category] ||= {};
    byCategory[category][currency] = (byCategory[category][currency] || 0) + amount;
  }
  return { byCurrency, byCategory, count: rows.length };
}

export async function POST(request: Request) {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
      return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
    }
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "openai_not_configured" }, { status: 503 });
    }

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
      model: fastModel(),
      store: false,
      reasoning: { effort: "low" },
      instructions:
        "Ты — маршрутизатор личного помощника Глаша. Превращай русскую естественную речь в одно структурированное действие. " +
        "Не придумывай сумму, дату, человека или категорию. Если обязательных данных для записи не хватает, needs_clarification=true. " +
        "Для расходов выбирай одну категорию из списка пользователя. Кофе/кафе -> coffee_cafes; внешность, одежда, уход -> self_care; " +
        "аренда/ЖКХ -> housing; обучение -> education; расходы на сына -> child. " +
        "Если пользователь спрашивает список или сумму, используй query_tasks/query_expenses, а не создание записи. " +
        "Для query_expenses заполни query_start_date и query_end_date в YYYY-MM-DD по смыслу запроса. query_end_date включительна. " +
        "Если указан месяц без года, используй текущий год. Если спрашивают конкретную категорию, заполни category_slug. " +
        "Если пользователь сообщает начало менструации, используй log_health с health_kind=cycle_start. " +
        "Если фраза про работу, area=work. Даты задач возвращай в due_date YYYY-MM-DD, время отдельно HH:MM. " +
        "occurred_at используй только если пользователь явно указал дату/время расхода; иначе null. Отвечай только по JSON-схеме.",
      input:
        `Текущее время UTC: ${now}\nЛокальная дата пользователя: ${localDate(timezone)}\nЧасовой пояс: ${timezone}\nВалюта по умолчанию: ${defaultCurrency}\n` +
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

    const { data: inboxRow } = await supabase.from("inbox_entries").insert({
      user_id: user.id,
      text,
      source: body?.source === "voice" ? "voice" : "text",
      intent: parsed.action,
      structured: parsed,
      processed: !parsed.needs_clarification,
    }).select("id").single();

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
        occurred_at: parsed.occurred_at || new Date().toISOString(),
        tags: parsed.tags,
      }).select("id,amount,currency,occurred_at").single();
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
      }).select("id,title,area,due_date,due_time,status").single();
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
      }).select("id,title,start_at,kind").single();
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
      }).select("id,title,kind,target_date,status").single();
      if (error) throw error;
      return NextResponse.json({ ok: true, action: parsed.action, data, reply: "Сохранила цель. Её можно разложить на шаги в Советчике." });
    }

    if (parsed.action === "save_note") {
      return NextResponse.json({ ok: true, action: parsed.action, data: inboxRow, reply: "Сохранила мысль во входящие." });
    }

    if (parsed.action === "query_tasks") {
      const bounds = taskBounds(parsed.query_range || "today", timezone);
      let query = supabase.from("tasks")
        .select("id,title,area,due_date,due_time,status,priority")
        .eq("user_id", user.id)
        .neq("status", "done")
        .order("due_date", { ascending: true })
        .order("due_time", { ascending: true });
      if (bounds) {
        query = query.gte("due_date", bounds.start).lte("due_date", bounds.end);
      }
      if (parsed.area) query = query.eq("area", parsed.area);
      const { data, error } = await query;
      if (error) throw error;
      return NextResponse.json({
        ok: true, action: parsed.action, data,
        reply: data?.length ? `Нашла задач: ${data.length}.` : "На этот период задач нет."
      });
    }

    if (parsed.action === "query_expenses") {
      const start = parsed.query_start_date;
      const end = parsed.query_end_date;
      const select = parsed.category_slug
        ? "id,amount,currency,occurred_at,merchant,note,expense_categories!inner(name,slug)"
        : "id,amount,currency,occurred_at,merchant,note,expense_categories(name,slug)";
      let query = supabase.from("expenses")
        .select(select)
        .eq("user_id", user.id)
        .order("occurred_at", { ascending: false })
        .limit(1000);

      if (start) query = query.gte("occurred_at", start + "T00:00:00");
      if (end) {
        const exclusive = new Date(end + "T00:00:00Z");
        exclusive.setUTCDate(exclusive.getUTCDate() + 1);
        query = query.lt("occurred_at", exclusive.toISOString());
      }
      if (parsed.category_slug) query = query.eq("expense_categories.slug", parsed.category_slug);

      const { data, error } = await query;
      if (error) throw error;
      const rows = (data ?? []) as unknown as Array<{
        amount: number | string;
        currency: string;
        occurred_at: string;
        merchant?: string | null;
        expense_categories?: { name?: string; slug?: string } | null;
      }>;
      const summary = sumExpenses(rows);
      const totals = Object.entries(summary.byCurrency)
        .map(([currency, amount]) => `${amount.toFixed(2)} ${currency}`)
        .join(", ");
      const categoryName = parsed.category_slug
        ? (categories ?? []).find((c) => c.slug === parsed.category_slug)?.name
        : null;
      const period = start || end ? ` за период ${start || "…"} — ${end || "…"}` : "";
      const label = categoryName ? ` по категории «${categoryName}»` : "";
      return NextResponse.json({
        ok: true,
        action: parsed.action,
        data: rows,
        summary,
        reply: rows.length
          ? `Расходы${label}${period}: ${totals}. Записей: ${rows.length}.`
          : `Расходов${label}${period} не нашла.`,
      });
    }

    return NextResponse.json({
      ok: true,
      action: "advice",
      reply: "Для этого открой раздел «Советчик» — он использует отдельный режим с твоими задачами, целями и календарём.",
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "assistant_failed" }, { status: 500 });
  }
}
