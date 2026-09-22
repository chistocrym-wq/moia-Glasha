import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fastModel } from "@/lib/model-policy";

type Action =
  | "create_expense"
  | "create_task"
  | "create_event"
  | "log_health"
  | "create_goal"
  | "save_note"
  | "query_schedule"
  | "query_expenses"
  | "check_availability"
  | "find_document"
  | "open_service"
  | "contact_action"
  | "search_tickets"
  | "advice";

type Parsed = {
  action: Action;
  title: string | null;
  description: string | null;
  amount: number | null;
  currency: string | null;
  category_slug: string | null;
  merchant: string | null;
  occurred_at: string | null;
  area: "personal" | "work" | "health" | "goals" | "travel" | null;
  due_date: string | null;
  due_time: string | null;
  event_kind: "event" | "birthday" | "deadline" | "reminder" | "appointment" | "trip" | "health" | "cycle" | null;
  start_at: string | null;
  end_at: string | null;
  all_day: boolean | null;
  health_kind: "cycle_start" | "cycle_end" | "symptom" | "medication" | "appointment" | "measurement" | "note" | "fitness" | "achievement" | null;
  goal_kind: "dream" | "goal" | null;
  goal_title: string | null;
  target_date: string | null;
  query_range: "today" | "tomorrow" | "week" | "month" | "all" | null;
  query_start_date: string | null;
  query_end_date: string | null;
  duration_minutes: number | null;
  document_query: string | null;
  service_name: string | null;
  contact_name: string | null;
  contact_method: "call" | "telegram" | "email" | null;
  message_text: string | null;
  route_from: string | null;
  route_to: string | null;
  travel_date: string | null;
  after_time: string | null;
  tags: string[];
  confidence: number;
  needs_clarification: boolean;
  clarification_question: string | null;
};

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: { type: "string", enum: [
      "create_expense","create_task","create_event","log_health","create_goal","save_note",
      "query_schedule","query_expenses","check_availability","find_document","open_service",
      "contact_action","search_tickets","advice"
    ] },
    title: { type: ["string","null"] },
    description: { type: ["string","null"] },
    amount: { type: ["number","null"] },
    currency: { type: ["string","null"] },
    category_slug: { type: ["string","null"] },
    merchant: { type: ["string","null"] },
    occurred_at: { type: ["string","null"] },
    area: { type: ["string","null"], enum: ["personal","work","health","goals","travel",null] },
    due_date: { type: ["string","null"] },
    due_time: { type: ["string","null"] },
    event_kind: { type: ["string","null"], enum: ["event","birthday","deadline","reminder","appointment","trip","health","cycle",null] },
    start_at: { type: ["string","null"] },
    end_at: { type: ["string","null"] },
    all_day: { type: ["boolean","null"] },
    health_kind: { type: ["string","null"], enum: ["cycle_start","cycle_end","symptom","medication","appointment","measurement","note","fitness","achievement",null] },
    goal_kind: { type: ["string","null"], enum: ["dream","goal",null] },
    goal_title: { type: ["string","null"] },
    target_date: { type: ["string","null"] },
    query_range: { type: ["string","null"], enum: ["today","tomorrow","week","month","all",null] },
    query_start_date: { type: ["string","null"] },
    query_end_date: { type: ["string","null"] },
    duration_minutes: { type: ["number","null"] },
    document_query: { type: ["string","null"] },
    service_name: { type: ["string","null"] },
    contact_name: { type: ["string","null"] },
    contact_method: { type: ["string","null"], enum: ["call","telegram","email",null] },
    message_text: { type: ["string","null"] },
    route_from: { type: ["string","null"] },
    route_to: { type: ["string","null"] },
    travel_date: { type: ["string","null"] },
    after_time: { type: ["string","null"] },
    tags: { type: "array", items: { type: "string" } },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    needs_clarification: { type: "boolean" },
    clarification_question: { type: ["string","null"] }
  },
  required: [
    "action","title","description","amount","currency","category_slug","merchant","occurred_at","area",
    "due_date","due_time","event_kind","start_at","end_at","all_day","health_kind","goal_kind","goal_title",
    "target_date","query_range","query_start_date","query_end_date","duration_minutes","document_query",
    "service_name","contact_name","contact_method","message_text","route_from","route_to","travel_date",
    "after_time","tags","confidence","needs_clarification","clarification_question"
  ]
} as const;

type Context = {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  userId: string;
  timezone: string;
  defaultCurrency: string;
  categories: Array<{ id: string; name: string; slug: string; keywords: string[] | null }>;
  goals: Array<{ id: string; title: string }>;
  connections: Array<{ id: string; service: string; display_name: string; open_url: string | null; deep_link: string | null; capability: string }>;
  contacts: Array<{ id: string; name: string; relation: string | null; phone: string | null; email: string | null; telegram_username: string | null }>;
  openai: OpenAI;
};

function normalize(value?: string | null) {
  return String(value || "").trim().toLocaleLowerCase("ru-RU");
}

function localDate(timezone: string, offsetDays = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
  const d = new Date(parts + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function dateBounds(range: Parsed["query_range"], timezone: string) {
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

function zonedDateTimeToUtc(date: string, time: string, timezone: string) {
  const [hour, minute] = time.split(":").map((n) => Number(n) || 0);
  const guess = new Date(date + "T" + String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0") + ":00Z");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(guess);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
  const viewedAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  const offset = viewedAsUtc - guess.getTime();
  return new Date(guess.getTime() - offset);
}

function dayUtcBounds(date: string, timezone: string) {
  return {
    start: zonedDateTimeToUtc(date, "00:00", timezone).toISOString(),
    end: zonedDateTimeToUtc(date, "23:59", timezone).toISOString()
  };
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

function splitBrainDump(text: string) {
  const normalized = text
    .replace(/\s+(?:и\s+)?(?:ещ[её]|еще)\s+/gi, ". ")
    .replace(/\n+/g, ". ");
  const parts = normalized
    .split(/(?<=[.!?;])\s+/)
    .map((part) => part.replace(/[.;]+$/g, "").trim())
    .filter(Boolean);
  if (parts.length <= 1 || text.length < 60) return [text];
  return parts.slice(0, 8);
}

function resolveGoal(goals: Context["goals"], title?: string | null) {
  const wanted = normalize(title);
  if (!wanted) return null;
  return goals.find((goal) => normalize(goal.title) === wanted)
    ?? goals.find((goal) => normalize(goal.title).includes(wanted) || wanted.includes(normalize(goal.title)))
    ?? null;
}

async function parseOne(ctx: Context, text: string): Promise<Parsed> {
  const categoryText = ctx.categories.map((c) =>
    `${c.slug} = ${c.name}; keywords: ${(c.keywords ?? []).join(", ")}`
  ).join("\n");
  const goalText = ctx.goals.map((g) => g.title).join(", ");
  const serviceText = ctx.connections.map((c) => `${c.service}=${c.display_name}`).join(", ");
  const contactText = ctx.contacts.map((c) => c.name).join(", ");

  const response = await ctx.openai.responses.create({
    model: fastModel(),
    store: false,
    reasoning: { effort: "low" },
    instructions:
      "Ты — центральный маршрутизатор личного помощника Глаша. Превращай одну русскую фразу в одно структурированное действие. " +
      "Не придумывай дату, время, человека, сумму, маршрут, документ или другие отсутствующие факты. Если обязательных данных не хватает, needs_clarification=true и задай ОДИН короткий вопрос. " +
      "Личная задача -> create_task area=personal. Фраза 'по работе' -> create_task area=work. " +
      "Врач с датой/временем -> create_event event_kind=appointment area=health. Тренировка -> log_health health_kind=fitness; если есть время, start_at обязателен. " +
      "Если задача относится к существующей цели, заполни goal_title. Расход -> create_expense и подходящая category_slug. " +
      "Вопрос 'что у меня/какие дела' -> query_schedule, ничего не создавать. Вопрос 'могу ли я в это время' -> check_availability. " +
      "Поиск личного документа -> find_document. 'Открой Telegram/Tutu/карты/почту/переводчик/Госуслуги' -> open_service. " +
      "'Позвони/напиши человеку' -> contact_action; не утверждай, что звонок или сообщение уже выполнены. " +
      "Поиск билетов с маршрутом и датой -> search_tickets; просто 'открой Tutu' не является поиском билетов. " +
      "Для текущих дат используй локальную дату пользователя. start_at/end_at возвращай ISO 8601 с часовым смещением, когда указано время. " +
      "Для query_expenses заполни query_start_date/query_end_date в YYYY-MM-DD. Отвечай только по JSON-схеме.",
    input:
      `Текущее UTC: ${new Date().toISOString()}\nЛокальная дата: ${localDate(ctx.timezone)}\nЧасовой пояс: ${ctx.timezone}\nВалюта: ${ctx.defaultCurrency}\n` +
      `Категории расходов:\n${categoryText}\nАктивные цели: ${goalText || "нет"}\nСервисы: ${serviceText || "нет"}\nКонтакты: ${contactText || "нет"}\n\nФраза: ${text}`,
    text: {
      format: {
        type: "json_schema",
        name: "glasha_action",
        schema,
        strict: true
      }
    }
  });
  return JSON.parse(response.output_text) as Parsed;
}

async function searchTickets(ctx: Context, parsed: Parsed) {
  if (!parsed.route_from || !parsed.route_to || !parsed.travel_date) {
    return {
      needs_clarification: true,
      reply: !parsed.route_from || !parsed.route_to
        ? "Откуда и куда ищем билет?"
        : "На какую дату ищем билет?"
    };
  }

  const ticketSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string" },
      options: {
        type: "array",
        maxItems: 6,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            departure: { type: ["string","null"] },
            arrival: { type: ["string","null"] },
            price: { type: ["string","null"] },
            carrier: { type: ["string","null"] },
            source: { type: ["string","null"] },
            url: { type: ["string","null"] }
          },
          required: ["title","departure","arrival","price","carrier","source","url"]
        }
      }
    },
    required: ["summary","options"]
  } as const;

  const response = await ctx.openai.responses.create({
    model: process.env.OPENAI_WEB_MODEL || fastModel(),
    store: false,
    reasoning: { effort: "low" },
    tools: [{ type: "web_search" }],
    instructions:
      "Найди актуальные варианты билетов. Не покупай и не бронируй. Покажи только найденные варианты с источником и ссылкой. " +
      "Если точная цена недоступна, price=null. Не выдумывай расписание или стоимость.",
    input:
      `Маршрут: ${parsed.route_from} — ${parsed.route_to}. Дата: ${parsed.travel_date}. ` +
      `После времени: ${parsed.after_time || "без ограничения"}. Ищи транспорт, подходящий по смыслу маршрута.`,
    text: {
      format: {
        type: "json_schema",
        name: "ticket_options",
        schema: ticketSchema,
        strict: true
      }
    }
  });
  const data = JSON.parse(response.output_text) as { summary: string; options: Array<Record<string, unknown>> };
  return { reply: data.summary, data: data.options };
}

async function executeAction(ctx: Context, parsed: Parsed, rawText: string, source: "text" | "voice") {
  const supabase = ctx.supabase;

  if (parsed.action === "create_expense") {
    if (parsed.amount == null) return { needs_clarification: true, reply: "Сколько именно ты потратила?" };
    const category = ctx.categories.find((c) => c.slug === parsed.category_slug)
      ?? ctx.categories.find((c) => c.slug === "other");
    const { data, error } = await supabase.from("expenses").insert({
      user_id: ctx.userId,
      category_id: category?.id ?? null,
      amount: parsed.amount,
      currency: parsed.currency || ctx.defaultCurrency,
      merchant: parsed.merchant,
      note: parsed.description,
      raw_text: rawText,
      source,
      occurred_at: parsed.occurred_at || new Date().toISOString(),
      tags: parsed.tags
    }).select("id,amount,currency,occurred_at").single();
    if (error) throw error;
    return { data, reply: `Записала: ${parsed.amount} ${parsed.currency || ctx.defaultCurrency} — ${category?.name || "Другое"}.` };
  }

  if (parsed.action === "create_task") {
    const goal = resolveGoal(ctx.goals, parsed.goal_title);
    const area = parsed.area === "work" ? "work" : "personal";
    const { data, error } = await supabase.from("tasks").insert({
      user_id: ctx.userId,
      area,
      title: parsed.title || rawText,
      description: parsed.description,
      due_date: parsed.due_date,
      due_time: parsed.due_time,
      goal_id: goal?.id ?? null,
      raw_text: rawText,
      source
    }).select("id,title,area,due_date,due_time,status,goal_id").single();
    if (error) throw error;
    return {
      data,
      reply: `Записала в ${area === "work" ? "рабочие" : "личные"} дела${parsed.due_date ? ` на ${parsed.due_date}` : ""}${goal ? ` · цель «${goal.title}»` : ""}.`
    };
  }

  if (parsed.action === "create_event") {
    if (!parsed.start_at) return { needs_clarification: true, reply: "На какую дату и время поставить событие?" };
    const area = parsed.area || (
      parsed.event_kind === "appointment" || parsed.event_kind === "health" || parsed.event_kind === "cycle"
        ? "health"
        : parsed.event_kind === "trip" ? "travel"
        : parsed.event_kind === "deadline" ? "work"
        : "personal"
    );
    const { data, error } = await supabase.from("calendar_events").insert({
      user_id: ctx.userId,
      kind: parsed.event_kind || "event",
      area,
      title: parsed.title || rawText,
      description: parsed.description,
      start_at: parsed.start_at,
      end_at: parsed.end_at,
      all_day: parsed.all_day ?? false,
      raw_text: rawText,
      source
    }).select("id,title,start_at,end_at,kind,area").single();
    if (error) throw error;

    if (area === "health" || parsed.event_kind === "appointment") {
      const { error: healthError } = await supabase.from("health_events").insert({
        user_id: ctx.userId,
        kind: "appointment",
        occurred_at: parsed.start_at,
        title: parsed.title || "Врач",
        details: { description: parsed.description },
        raw_text: rawText,
        source
      });
      if (healthError) throw healthError;
    }
    return { data, reply: "Добавила в общий календарь." };
  }

  if (parsed.action === "log_health") {
    const kind = parsed.health_kind || "note";
    const occurredAt = parsed.start_at || parsed.occurred_at || new Date().toISOString();
    const { data, error } = await supabase.from("health_events").insert({
      user_id: ctx.userId,
      kind,
      occurred_at: occurredAt,
      title: parsed.title,
      details: { description: parsed.description, tags: parsed.tags },
      raw_text: rawText,
      source
    }).select("id,kind,occurred_at,title").single();
    if (error) throw error;

    if (kind === "cycle_start" || kind === "cycle_end" || (kind === "fitness" && parsed.start_at) || kind === "appointment") {
      const { error: eventError } = await supabase.from("calendar_events").insert({
        user_id: ctx.userId,
        kind: kind.startsWith("cycle") ? "cycle" : "health",
        area: "health",
        title: parsed.title || (kind === "fitness" ? "Тренировка" : kind === "cycle_start" ? "Начало цикла" : kind === "cycle_end" ? "Окончание цикла" : "Здоровье"),
        start_at: occurredAt,
        end_at: parsed.end_at,
        all_day: kind.startsWith("cycle") && !parsed.start_at,
        raw_text: rawText,
        source
      });
      if (eventError) throw eventError;
    }
    return { data, reply: kind === "fitness" ? "Записала тренировку." : "Записала в здоровье." };
  }

  if (parsed.action === "create_goal") {
    const { data, error } = await supabase.from("goals").insert({
      user_id: ctx.userId,
      kind: parsed.goal_kind || "goal",
      title: parsed.title || rawText,
      description: parsed.description,
      target_date: parsed.target_date
    }).select("id,title,kind,target_date,status").single();
    if (error) throw error;
    ctx.goals.push({ id: data.id, title: data.title });
    return { data, reply: "Сохранила цель." };
  }

  if (parsed.action === "save_note") {
    return { reply: "Сохранила мысль во входящие." };
  }

  if (parsed.action === "query_schedule") {
    const bounds = dateBounds(parsed.query_range || "today", ctx.timezone)
      ?? {
        start: parsed.query_start_date || localDate(ctx.timezone),
        end: parsed.query_end_date || parsed.query_start_date || localDate(ctx.timezone)
      };
    let taskQuery = supabase.from("tasks")
      .select("id,title,area,due_date,due_time,status,priority,goal_id,goals(title)")
      .eq("user_id", ctx.userId)
      .neq("status", "done")
      .gte("due_date", bounds.start)
      .lte("due_date", bounds.end);
    const startUtc = dayUtcBounds(bounds.start, ctx.timezone).start;
    const endUtc = dayUtcBounds(bounds.end, ctx.timezone).end;
    const eventQuery = supabase.from("calendar_events")
      .select("id,title,start_at,end_at,kind,area")
      .eq("user_id", ctx.userId)
      .gte("start_at", startUtc)
      .lte("start_at", endUtc);
    const [{ data: tasks, error: taskError }, { data: events, error: eventError }] = await Promise.all([taskQuery, eventQuery]);
    if (taskError) throw taskError;
    if (eventError) throw eventError;

    const rows = [
      ...(tasks ?? []).map((task) => ({
        id: task.id,
        type: "task",
        title: task.title,
        area: task.area,
        date: task.due_date,
        time: task.due_time ? String(task.due_time).slice(0, 5) : null,
        start_at: task.due_date && task.due_time ? zonedDateTimeToUtc(task.due_date, String(task.due_time).slice(0, 5), ctx.timezone).toISOString() : null
      })),
      ...(events ?? []).map((event) => ({
        id: event.id,
        type: "event",
        title: event.title,
        area: event.area,
        date: new Intl.DateTimeFormat("en-CA", { timeZone: ctx.timezone }).format(new Date(event.start_at)),
        time: new Intl.DateTimeFormat("ru-RU", { timeZone: ctx.timezone, hour: "2-digit", minute: "2-digit" }).format(new Date(event.start_at)),
        start_at: event.start_at
      }))
    ].sort((a, b) => String(a.start_at || a.date || "").localeCompare(String(b.start_at || b.date || "")));

    return {
      data: rows,
      reply: rows.length ? `На период ${bounds.start} — ${bounds.end}: ${rows.length} дел и событий.` : "На этот период дел и событий нет."
    };
  }

  if (parsed.action === "query_expenses") {
    const start = parsed.query_start_date;
    const end = parsed.query_end_date;
    const select = parsed.category_slug
      ? "id,amount,currency,occurred_at,merchant,note,expense_categories!inner(name,slug)"
      : "id,amount,currency,occurred_at,merchant,note,expense_categories(name,slug)";
    let query = supabase.from("expenses").select(select).eq("user_id", ctx.userId).order("occurred_at", { ascending: false }).limit(1000);
    if (start) query = query.gte("occurred_at", dayUtcBounds(start, ctx.timezone).start);
    if (end) query = query.lte("occurred_at", dayUtcBounds(end, ctx.timezone).end);
    if (parsed.category_slug) query = query.eq("expense_categories.slug", parsed.category_slug);
    const { data, error } = await query;
    if (error) throw error;

    const rows = (data ?? []) as unknown as Array<{ amount: number | string; currency: string; occurred_at: string; merchant?: string | null; expense_categories?: { name?: string; slug?: string } | null }>;
    const summary = sumExpenses(rows);
    const totals = Object.entries(summary.byCurrency).map(([currency, amount]) => `${amount.toFixed(2)} ${currency}`).join(", ");
    const categoryName = parsed.category_slug ? ctx.categories.find((c) => c.slug === parsed.category_slug)?.name : null;
    return {
      data: rows,
      summary,
      reply: rows.length
        ? `Расходы${categoryName ? ` по категории «${categoryName}»` : ""}: ${totals}. Записей: ${rows.length}.`
        : "Подходящих расходов не нашла."
    };
  }

  if (parsed.action === "check_availability") {
    if (!parsed.start_at) return { needs_clarification: true, reply: "На какую дату и время проверить свободное окно?" };
    const targetStart = new Date(parsed.start_at);
    if (Number.isNaN(targetStart.getTime())) return { needs_clarification: true, reply: "Уточни дату и время." };
    const duration = Math.max(15, Math.min(parsed.duration_minutes || 60, 8 * 60));
    const targetEnd = new Date(targetStart.getTime() + duration * 60_000);
    const localDay = new Intl.DateTimeFormat("en-CA", { timeZone: ctx.timezone }).format(targetStart);
    const day = dayUtcBounds(localDay, ctx.timezone);

    const [{ data: events, error: eventError }, { data: tasks, error: taskError }] = await Promise.all([
      supabase.from("calendar_events").select("id,title,start_at,end_at").eq("user_id", ctx.userId).gte("start_at", day.start).lte("start_at", day.end),
      supabase.from("tasks").select("id,title,due_date,due_time,status").eq("user_id", ctx.userId).eq("due_date", localDay).neq("status", "done").not("due_time", "is", null)
    ]);
    if (eventError) throw eventError;
    if (taskError) throw taskError;

    const intervals = [
      ...(events ?? []).map((event) => ({
        title: event.title,
        start: new Date(event.start_at),
        end: event.end_at ? new Date(event.end_at) : new Date(new Date(event.start_at).getTime() + 60 * 60_000)
      })),
      ...(tasks ?? []).map((task) => {
        const start = zonedDateTimeToUtc(task.due_date, String(task.due_time).slice(0, 5), ctx.timezone);
        return { title: task.title, start, end: new Date(start.getTime() + 60 * 60_000) };
      })
    ];
    const conflicts = intervals.filter((item) => item.start < targetEnd && item.end > targetStart);
    if (!conflicts.length) {
      return { data: [], reply: "Да, это время свободно." };
    }
    const nextFree = new Date(Math.max(...conflicts.map((item) => item.end.getTime())));
    const nextText = new Intl.DateTimeFormat("ru-RU", { timeZone: ctx.timezone, hour: "2-digit", minute: "2-digit" }).format(nextFree);
    return {
      data: conflicts.map((item) => ({ title: item.title, start_at: item.start.toISOString(), end_at: item.end.toISOString() })),
      reply: `В это время занято: ${conflicts.map((item) => item.title).join(", ")}. Ближайшее окно после ${nextText}.`
    };
  }

  if (parsed.action === "find_document") {
    const query = normalize(parsed.document_query || parsed.title || rawText.replace(/^.*?найди\s+/i, ""));
    const { data, error } = await supabase.from("documents")
      .select("id,title,owner_person,document_type,expiry_date,tags,storage_path,mime_type,size_bytes,created_at")
      .eq("user_id", ctx.userId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    const matches = (data ?? []).filter((doc) =>
      [doc.title, doc.owner_person, doc.document_type, ...(doc.tags ?? [])]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("ru-RU")
        .includes(query)
    ).slice(0, 10);

    const withUrls = await Promise.all(matches.map(async (doc) => {
      const { data: signed } = await supabase.storage.from("glasha-private").createSignedUrl(doc.storage_path, 60 * 10);
      const { storage_path: _hidden, ...safe } = doc;
      return { ...safe, action_url: signed?.signedUrl || null };
    }));
    return { data: withUrls, reply: withUrls.length ? `Нашла документов: ${withUrls.length}.` : "Такого документа в архиве не нашла." };
  }

  if (parsed.action === "open_service") {
    const wanted = normalize(parsed.service_name || parsed.title || rawText);
    const connection = ctx.connections.find((item) => normalize(item.service) === wanted || normalize(item.display_name).includes(wanted) || wanted.includes(normalize(item.display_name)));
    if (!connection) return { reply: "Такого сервиса в «Подключениях» пока нет." };
    if (connection.capability === "NOT_CONNECTED" && !connection.open_url && !connection.deep_link) {
      return { reply: `${connection.display_name}: интеграция не подключена.` };
    }
    return {
      data: [{
        id: connection.id,
        title: connection.display_name,
        capability: connection.capability,
        action_url: connection.deep_link || connection.open_url,
        fallback_url: connection.open_url
      }],
      reply: `Можно открыть ${connection.display_name}. Это режим ${connection.capability}, не доступ к содержимому аккаунта.`
    };
  }

  if (parsed.action === "contact_action") {
    const wanted = normalize(parsed.contact_name || parsed.title);
    const contact = ctx.contacts.find((item) => normalize(item.name) === wanted)
      ?? ctx.contacts.find((item) => normalize(item.name).includes(wanted) || wanted.includes(normalize(item.name)));
    if (!contact) return { reply: "Контакт не найден. Добавь его в раздел «Контакты»." };

    const method = parsed.contact_method || "call";
    if (method === "call") {
      if (!contact.phone) return { reply: `У ${contact.name} не сохранён телефон.` };
      return {
        data: [{ id: contact.id, title: `Позвонить ${contact.name}`, action_url: `tel:${contact.phone}`, requires_confirmation: true }],
        reply: `Нашла номер ${contact.name}. Нажми «Позвонить», чтобы начать вызов.`
      };
    }
    if (method === "telegram") {
      if (!contact.telegram_username) return { reply: `У ${contact.name} не сохранён Telegram username.` };
      const username = contact.telegram_username.replace(/^@/, "");
      const text = parsed.message_text ? `&text=${encodeURIComponent(parsed.message_text)}` : "";
      return {
        data: [{
          id: contact.id,
          title: `Открыть чат с ${contact.name}`,
          action_url: `tg://resolve?domain=${encodeURIComponent(username)}${text}`,
          fallback_url: `https://t.me/${encodeURIComponent(username)}`,
          prepared_message: parsed.message_text,
          requires_confirmation: true
        }],
        reply: parsed.message_text
          ? "Сообщение подготовлено, но не отправлено. Открой Telegram и подтверди отправку."
          : `Открою чат с ${contact.name} после твоего нажатия.`
      };
    }
    if (!contact.email) return { reply: `У ${contact.name} не сохранён email.` };
    return {
      data: [{
        id: contact.id,
        title: `Написать ${contact.name}`,
        action_url: `mailto:${contact.email}${parsed.message_text ? `?body=${encodeURIComponent(parsed.message_text)}` : ""}`,
        requires_confirmation: true
      }],
      reply: "Письмо подготовлено, но не отправлено."
    };
  }

  if (parsed.action === "search_tickets") {
    return searchTickets(ctx, parsed);
  }

  return {
    reply: "Для глубокого разбора открой «Советчик» — там Глаша использует только релевантный личный контекст."
  };
}

function actionSummary(results: Array<{ parsed: Parsed; result: Record<string, unknown> }>) {
  const counts = {
    tasks: results.filter((x) => x.parsed.action === "create_task").length,
    events: results.filter((x) => x.parsed.action === "create_event").length,
    expenses: results.filter((x) => x.parsed.action === "create_expense").length,
    health: results.filter((x) => x.parsed.action === "log_health").length,
    goals: results.filter((x) => x.parsed.action === "create_goal").length,
    notes: results.filter((x) => x.parsed.action === "save_note").length
  };
  const parts: string[] = [];
  if (counts.tasks) parts.push(`${counts.tasks} задач`);
  if (counts.events) parts.push(`${counts.events} событий`);
  if (counts.expenses) parts.push(`${counts.expenses} расходов`);
  if (counts.health) parts.push(`${counts.health} записей здоровья`);
  if (counts.goals) parts.push(`${counts.goals} целей`);
  if (counts.notes) parts.push(`${counts.notes} заметок`);
  return parts.length ? "Записала: " + parts.join(", ") + "." : null;
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
    const source: "text" | "voice" = body?.source === "voice" ? "voice" : "text";
    if (!text) return NextResponse.json({ error: "empty_text" }, { status: 400 });

    const [profileRes, categoryRes, goalRes, connectionRes, contactRes] = await Promise.all([
      supabase.from("profiles").select("timezone,default_currency").eq("id", user.id).maybeSingle(),
      supabase.from("expense_categories").select("id,name,slug,keywords").eq("user_id", user.id).order("sort_order"),
      supabase.from("goals").select("id,title").eq("user_id", user.id).eq("status", "active").limit(100),
      supabase.from("connections").select("id,service,display_name,open_url,deep_link,capability").eq("user_id", user.id),
      supabase.from("contacts").select("id,name,relation,phone,email,telegram_username").eq("user_id", user.id).limit(200)
    ]);
    if (profileRes.error) throw profileRes.error;
    if (categoryRes.error) throw categoryRes.error;
    if (goalRes.error) throw goalRes.error;
    if (connectionRes.error) throw connectionRes.error;
    if (contactRes.error) throw contactRes.error;

    const ctx: Context = {
      supabase,
      userId: user.id,
      timezone: profileRes.data?.timezone || "Europe/Berlin",
      defaultCurrency: profileRes.data?.default_currency || "RUB",
      categories: categoryRes.data ?? [],
      goals: goalRes.data ?? [],
      connections: connectionRes.data ?? [],
      contacts: contactRes.data ?? [],
      openai: new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    };

    const segments = splitBrainDump(text);
    const parsedItems: Array<{ raw: string; parsed: Parsed }> = [];
    for (const segment of segments) {
      parsedItems.push({ raw: segment, parsed: await parseOne(ctx, segment) });
    }

    const clarifications = parsedItems.filter((item) => item.parsed.needs_clarification);
    const executable = parsedItems.filter((item) => !item.parsed.needs_clarification);
    const executed: Array<{ parsed: Parsed; result: Record<string, unknown> }> = [];

    for (const item of executable) {
      const result = await executeAction(ctx, item.parsed, item.raw, source) as Record<string, unknown>;
      if (result.needs_clarification) {
        clarifications.push({
          raw: item.raw,
          parsed: { ...item.parsed, needs_clarification: true, clarification_question: String(result.reply || "Уточни деталь.") }
        });
      } else {
        executed.push({ parsed: item.parsed, result });
      }
    }

    await supabase.from("inbox_entries").insert({
      user_id: user.id,
      text,
      source,
      intent: parsedItems.length > 1 ? "brain_dump" : parsedItems[0]?.parsed.action,
      structured: { items: parsedItems.map((item) => item.parsed), executed: executed.length },
      processed: clarifications.length === 0
    });

    if (parsedItems.length === 1 && executed.length === 1 && clarifications.length === 0) {
      const single = executed[0];
      return NextResponse.json({
        ok: true,
        action: single.parsed.action,
        ...(single.result as object)
      });
    }

    const summary = actionSummary(executed);
    const firstQuery = executed.find((item) =>
      ["query_schedule","query_expenses","check_availability","find_document","open_service","contact_action","search_tickets"].includes(item.parsed.action)
    );
    const clarification = clarifications[0]?.parsed.clarification_question;
    const reply = [
      summary,
      firstQuery ? String(firstQuery.result.reply || "") : null,
      clarification ? `Уточни только одно: ${clarification}` : null
    ].filter(Boolean).join(" ");

    const mergedData = executed.flatMap((item) => Array.isArray(item.result.data) ? item.result.data as unknown[] : []);
    return NextResponse.json({
      ok: true,
      action: parsedItems.length > 1 ? "brain_dump" : parsedItems[0]?.parsed.action,
      reply: reply || "Готово.",
      needs_clarification: clarifications.length > 0,
      data: mergedData,
      summary: {
        total_items: parsedItems.length,
        executed: executed.length,
        needs_clarification: clarifications.length
      }
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "assistant_failed" }, { status: 500 });
  }
}
