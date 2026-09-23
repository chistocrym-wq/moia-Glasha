import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { chooseAdvisorModel, fastModel } from "@/lib/model-policy";
import {
  deterministicRoute,
  resolveDateToken,
  resolveMonthBounds,
  type DeterministicRoute,
} from "@/lib/deterministic-router";

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
  | "move_task"
  | "split_task"
  | "advice";

type RouteType = "LOCAL" | "SUPABASE_ONLY" | "AI_FAST" | "AI_DEEP" | "WEB_SEARCH";

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
  task_query: string | null;
  target_area: "personal" | "work" | null;
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
      "contact_action","search_tickets","move_task","split_task","advice"
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
    task_query: { type: ["string","null"] },
    target_area: { type: ["string","null"], enum: ["personal","work",null] },
    tags: { type: "array", items: { type: "string" } },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    needs_clarification: { type: "boolean" },
    clarification_question: { type: ["string","null"] },
  },
  required: [
    "action","title","description","amount","currency","category_slug","merchant","occurred_at","area",
    "due_date","due_time","event_kind","start_at","end_at","all_day","health_kind","goal_kind","goal_title",
    "target_date","query_range","query_start_date","query_end_date","duration_minutes","document_query",
    "service_name","contact_name","contact_method","message_text","route_from","route_to","travel_date",
    "after_time","task_query","target_area","tags","confidence","needs_clarification","clarification_question"
  ],
} as const;

type Profile = { timezone: string; default_currency: string };
type Category = { id: string; name: string; slug: string; keywords: string[] | null };
type Connection = {
  id: string;
  service: string;
  display_name: string;
  platform: string;
  open_url: string | null;
  deep_link: string | null;
  url_scheme: string | null;
  universal_link: string | null;
  web_fallback_url: string | null;
  capability: string;
  enabled: boolean;
  icon: string | null;
  aliases: string[];
};
type Contact = { id: string; name: string; relation: string | null; phone: string | null; email: string | null; telegram_username: string | null };
type Goal = { id: string; title: string };

type Metrics = {
  startedAt: number;
  routeType: RouteType;
  intent: string;
  openaiCalls: number;
  webSearchUsed: boolean;
  modelUsed: string | null;
  supabaseQueries: number;
};

type Runtime = {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  userId: string;
  metrics: Metrics;
  profile?: Profile;
  categories?: Category[];
  connections?: Connection[];
  contacts?: Contact[];
  goals?: Goal[];
  openai?: OpenAI;
  source: "text" | "voice";
};

type CacheEntry<T> = { expiresAt: number; value: T };
const CACHE_TTL_MS = 5 * 60_000;
const profileCache = new Map<string, CacheEntry<Profile>>();
const categoriesCache = new Map<string, CacheEntry<Category[]>>();
const connectionsCache = new Map<string, CacheEntry<Connection[]>>();

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Pragma": "no-cache",
    },
  });
}

function normalize(value?: string | null) {
  return String(value || "").trim().toLocaleLowerCase("ru-RU");
}

async function tracked<T>(rt: Runtime, promise: PromiseLike<T>): Promise<T> {
  rt.metrics.supabaseQueries += 1;
  return await promise;
}

function cacheGet<T>(cache: Map<string, CacheEntry<T>>, key: string) {
  const item = cache.get(key);
  if (!item || item.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return item.value;
}

function cacheSet<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T) {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

async function loadProfile(rt: Runtime) {
  if (rt.profile) return rt.profile;
  const cached = cacheGet(profileCache, rt.userId);
  if (cached) return (rt.profile = cached);

  const { data, error } = await tracked(rt,
    rt.supabase.from("profiles").select("timezone,default_currency").eq("id", rt.userId).maybeSingle()
  );
  if (error) throw error;
  return (rt.profile = cacheSet(profileCache, rt.userId, {
    timezone: data?.timezone || "Europe/Berlin",
    default_currency: data?.default_currency || "RUB",
  }));
}

async function loadCategories(rt: Runtime) {
  if (rt.categories) return rt.categories;
  const cached = cacheGet(categoriesCache, rt.userId);
  if (cached) return (rt.categories = cached);

  const { data, error } = await tracked(rt,
    rt.supabase.from("expense_categories").select("id,name,slug,keywords").eq("user_id", rt.userId).order("sort_order")
  );
  if (error) throw error;
  return (rt.categories = cacheSet(categoriesCache, rt.userId, data ?? []));
}

async function loadConnections(rt: Runtime) {
  if (rt.connections) return rt.connections;
  const cached = cacheGet(connectionsCache, rt.userId);
  if (cached) return (rt.connections = cached);

  const { data, error } = await tracked(rt,
    rt.supabase.from("connections").select("id,service,display_name,platform,open_url,deep_link,url_scheme,universal_link,web_fallback_url,capability,enabled,icon,aliases").eq("user_id", rt.userId)
  );
  if (error) throw error;
  return (rt.connections = cacheSet(connectionsCache, rt.userId, data ?? []));
}

async function loadContacts(rt: Runtime) {
  if (rt.contacts) return rt.contacts;
  const { data, error } = await tracked(rt,
    rt.supabase.from("contacts").select("id,name,relation,phone,email,telegram_username").eq("user_id", rt.userId).limit(200)
  );
  if (error) throw error;
  return (rt.contacts = data ?? []);
}

async function loadGoals(rt: Runtime) {
  if (rt.goals) return rt.goals;
  const { data, error } = await tracked(rt,
    rt.supabase.from("goals").select("id,title").eq("user_id", rt.userId).eq("status", "active").limit(100)
  );
  if (error) throw error;
  return (rt.goals = data ?? []);
}

function getOpenAI(rt: Runtime) {
  if (!process.env.OPENAI_API_KEY) {
    const error = new Error("openai_not_configured");
    error.name = "openai_not_configured";
    throw error;
  }
  return (rt.openai ||= new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));
}

function markAi(rt: Runtime, model: string, tier: "fast" | "deep", web = false) {
  rt.metrics.openaiCalls += 1;
  rt.metrics.modelUsed = model;
  rt.metrics.webSearchUsed ||= web;
  if (web) rt.metrics.routeType = "WEB_SEARCH";
  else if (tier === "deep" && rt.metrics.routeType !== "WEB_SEARCH") rt.metrics.routeType = "AI_DEEP";
  else if (rt.metrics.routeType === "SUPABASE_ONLY" || rt.metrics.routeType === "LOCAL") rt.metrics.routeType = "AI_FAST";
}

async function writeTelemetry(rt: Runtime) {
  const latency = Math.max(0, Date.now() - rt.metrics.startedAt);
  const { error } = await rt.supabase.from("request_telemetry").insert({
    user_id: rt.userId,
    route_type: rt.metrics.routeType,
    intent: rt.metrics.intent || "unknown",
    latency_ms: latency,
    openai_calls_count: rt.metrics.openaiCalls,
    web_search_used: rt.metrics.webSearchUsed,
    model_used: rt.metrics.modelUsed,
    supabase_queries_count: rt.metrics.supabaseQueries,
  });
  if (error) console.error("telemetry_insert_failed", { code: error.code, message: error.message });
}

function localDate(timezone: string, offsetDays = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit"
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
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(guess);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
  const viewedAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  const offset = viewedAsUtc - guess.getTime();
  return new Date(guess.getTime() - offset);
}

function dayUtcBounds(date: string, timezone: string) {
  return {
    start: zonedDateTimeToUtc(date, "00:00", timezone).toISOString(),
    end: zonedDateTimeToUtc(date, "23:59", timezone).toISOString(),
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

async function parseWithAi(rt: Runtime, text: string): Promise<Parsed> {
  const profile = await loadProfile(rt);
  const openai = getOpenAI(rt);
  const model = fastModel();
  markAi(rt, model, "fast");

  const response = await openai.responses.create({
    model,
    store: false,
    reasoning: { effort: "low" },
    instructions:
      "Ты — fallback-маршрутизатор личного помощника Глаша. Используйся только когда deterministic parser не смог уверенно понять фразу. " +
      "Не придумывай дату, время, человека, сумму или другие отсутствующие факты. Если обязательных данных не хватает, needs_clarification=true и задай ОДИН короткий вопрос. " +
      "Личная задача -> create_task area=personal. Очевидный рабочий контекст -> create_task area=work. " +
      "Будущий звонок/сообщение с датой -> create_task, а немедленный звонок/Telegram -> contact_action. " +
      "Врач с датой/временем -> create_event event_kind=appointment area=health. Тренировка -> log_health health_kind=fitness. " +
      "Вопрос про уже сохранённые дела -> query_schedule. Свободное время -> check_availability. Поиск metadata документа -> find_document. " +
      "Открыть сервис -> open_service. Перенести существующую задачу между личным и работой -> move_task; заполни task_query и target_area. " +
      "Разбить существующую задачу на шаги -> split_task; заполни task_query. Не создавай новую родительскую задачу. " +
      "Поиск билетов -> search_tickets. Сложный разбор -> advice. " +
      "Для расходов используй стандартные slug: housing,groceries,coffee_cafes,self_care,entertainment,education,child,transport,health,subscriptions,travel,work,other. " +
      "Отвечай только по JSON-схеме.",
    input:
      `UTC: ${new Date().toISOString()}\nЛокальная дата: ${localDate(profile.timezone)}\nЧасовой пояс: ${profile.timezone}\nФраза: ${text}`,
    text: { format: { type: "json_schema", name: "glasha_action", schema, strict: true } },
  });

  return JSON.parse(response.output_text) as Parsed;
}

async function createExpense(rt: Runtime, input: { amount: number; note: string; categorySlug?: string | null; currency?: string | null; occurredAt?: string | null }) {
  const [profile, categories] = await Promise.all([loadProfile(rt), loadCategories(rt)]);
  const category = categories.find((c) => c.slug === input.categorySlug)
    ?? categories.find((c) => c.slug === "other")
    ?? null;
  const { data, error } = await tracked(rt,
    rt.supabase.from("expenses").insert({
      user_id: rt.userId,
      category_id: category?.id ?? null,
      amount: input.amount,
      currency: input.currency || profile.default_currency,
      note: input.note,
      raw_text: null,
      source: rt.source,
      occurred_at: input.occurredAt || new Date().toISOString(),
      tags: [],
    }).select("id,amount,currency,occurred_at").single()
  );
  if (error) throw error;
  return {
    data,
    reply: `Записала: ${input.amount} ${input.currency || profile.default_currency} — ${category?.name || "Другое"}.`,
  };
}

async function queryExpenses(rt: Runtime, input: { categorySlug?: string | null; start?: string | null; end?: string | null }) {
  const profile = await loadProfile(rt);
  const select = input.categorySlug
    ? "id,amount,currency,occurred_at,merchant,note,expense_categories!inner(name,slug)"
    : "id,amount,currency,occurred_at,merchant,note,expense_categories(name,slug)";
  let query = rt.supabase.from("expenses").select(select).eq("user_id", rt.userId).order("occurred_at", { ascending: false }).limit(1000);
  if (input.start) query = query.gte("occurred_at", dayUtcBounds(input.start, profile.timezone).start);
  if (input.end) query = query.lte("occurred_at", dayUtcBounds(input.end, profile.timezone).end);
  if (input.categorySlug) query = query.eq("expense_categories.slug", input.categorySlug);
  const { data, error } = await tracked(rt, query);
  if (error) throw error;

  const rows = (data ?? []) as unknown as Array<{
    amount: number | string; currency: string; occurred_at: string; merchant?: string | null;
    expense_categories?: { name?: string; slug?: string } | null;
  }>;
  const summary = sumExpenses(rows);
  const totals = Object.entries(summary.byCurrency).map(([currency, amount]) => `${amount.toFixed(2)} ${currency}`).join(", ");
  return {
    data: rows,
    summary,
    reply: rows.length ? `Расходы: ${totals}. Записей: ${rows.length}.` : "Подходящих расходов не нашла.",
  };
}

async function createTask(rt: Runtime, input: { title: string; area: "personal" | "work"; dueDate?: string | null; dueTime?: string | null; goalTitle?: string | null }) {
  let goalId: string | null = null;
  let goalTitle: string | null = null;
  if (input.goalTitle) {
    const goals = await loadGoals(rt);
    const wanted = normalize(input.goalTitle);
    const goal = goals.find((g) => normalize(g.title) === wanted)
      ?? goals.find((g) => normalize(g.title).includes(wanted) || wanted.includes(normalize(g.title)));
    goalId = goal?.id ?? null;
    goalTitle = goal?.title ?? null;
  }

  const { data, error } = await tracked(rt,
    rt.supabase.from("tasks").insert({
      user_id: rt.userId,
      area: input.area,
      title: input.title,
      due_date: input.dueDate || null,
      due_time: input.dueTime || null,
      goal_id: goalId,
      source: rt.source,
    }).select("id,title,area,due_date,due_time,status,goal_id").single()
  );
  if (error) throw error;
  return {
    data,
    reply: `Записала в ${input.area === "work" ? "рабочие" : "личные"} дела${input.dueDate ? ` на ${input.dueDate}` : ""}${goalTitle ? ` · цель «${goalTitle}»` : ""}.`,
  };
}

async function createEvent(rt: Runtime, input: {
  title: string; kind: string; area: string; startAt: string; endAt?: string | null; allDay?: boolean;
  mirrorHealth?: boolean;
}) {
  const { data, error } = await tracked(rt,
    rt.supabase.from("calendar_events").insert({
      user_id: rt.userId,
      kind: input.kind,
      area: input.area,
      title: input.title,
      start_at: input.startAt,
      end_at: input.endAt || null,
      all_day: Boolean(input.allDay),
      source: rt.source,
    }).select("id,title,start_at,end_at,kind,area").single()
  );
  if (error) throw error;

  if (input.mirrorHealth) {
    const { error: healthError } = await tracked(rt,
      rt.supabase.from("health_events").insert({
        user_id: rt.userId,
        kind: "appointment",
        occurred_at: input.startAt,
        title: input.title,
        details: {},
        source: rt.source,
      })
    );
    if (healthError) throw healthError;
  }
  return { data, reply: "Добавила в общий календарь." };
}

async function logHealth(rt: Runtime, input: {
  kind: string; title?: string | null; occurredAt: string; addCalendar?: boolean; endAt?: string | null; allDay?: boolean;
}) {
  const { data, error } = await tracked(rt,
    rt.supabase.from("health_events").insert({
      user_id: rt.userId,
      kind: input.kind,
      occurred_at: input.occurredAt,
      title: input.title || null,
      details: {},
      source: rt.source,
    }).select("id,kind,occurred_at,title").single()
  );
  if (error) throw error;

  if (input.addCalendar) {
    const { error: eventError } = await tracked(rt,
      rt.supabase.from("calendar_events").insert({
        user_id: rt.userId,
        kind: input.kind.startsWith("cycle") ? "cycle" : "health",
        area: "health",
        title: input.title || (input.kind === "fitness" ? "Тренировка" : "Здоровье"),
        start_at: input.occurredAt,
        end_at: input.endAt || null,
        all_day: Boolean(input.allDay),
        source: rt.source,
      })
    );
    if (eventError) throw eventError;
  }
  return { data, reply: input.kind === "fitness" ? "Записала тренировку." : "Записала в здоровье." };
}

async function querySchedule(rt: Runtime, range: "today" | "tomorrow" | "week" | "month" | "all", explicitStart?: string | null, explicitEnd?: string | null) {
  const profile = await loadProfile(rt);
  const bounds = dateBounds(range, profile.timezone) ?? {
    start: explicitStart || localDate(profile.timezone),
    end: explicitEnd || explicitStart || localDate(profile.timezone),
  };

  let taskQuery = rt.supabase.from("tasks")
    .select("id,title,area,due_date,due_time,status,priority,goal_id")
    .eq("user_id", rt.userId)
    .neq("status", "done")
    .order("due_date", { ascending: true })
    .order("due_time", { ascending: true });
  if (range !== "all") taskQuery = taskQuery.gte("due_date", bounds.start).lte("due_date", bounds.end);

  const dayStart = dayUtcBounds(bounds.start, profile.timezone).start;
  const dayEnd = dayUtcBounds(bounds.end, profile.timezone).end;
  let eventQuery = rt.supabase.from("calendar_events")
    .select("id,title,start_at,end_at,kind,area")
    .eq("user_id", rt.userId)
    .order("start_at", { ascending: true });
  if (range !== "all") eventQuery = eventQuery.gte("start_at", dayStart).lte("start_at", dayEnd);

  const [{ data: tasks, error: taskError }, { data: events, error: eventError }] = await Promise.all([
    tracked(rt, taskQuery),
    tracked(rt, eventQuery),
  ]);
  if (taskError) throw taskError;
  if (eventError) throw eventError;

  const rows = [
    ...(tasks ?? []).map((task) => ({
      id: task.id, type: "task", title: task.title, area: task.area,
      date: task.due_date, time: task.due_time ? String(task.due_time).slice(0, 5) : null,
      start_at: task.due_date && task.due_time
        ? zonedDateTimeToUtc(task.due_date, String(task.due_time).slice(0, 5), profile.timezone).toISOString()
        : null,
    })),
    ...(events ?? []).map((event) => ({
      id: event.id, type: "event", title: event.title, area: event.area,
      date: new Intl.DateTimeFormat("en-CA", { timeZone: profile.timezone }).format(new Date(event.start_at)),
      time: new Intl.DateTimeFormat("ru-RU", { timeZone: profile.timezone, hour: "2-digit", minute: "2-digit" }).format(new Date(event.start_at)),
      start_at: event.start_at,
    })),
  ].sort((a, b) => String(a.start_at || a.date || "").localeCompare(String(b.start_at || b.date || "")));

  return {
    data: rows,
    reply: rows.length ? `Нашла дел и событий: ${rows.length}.` : "На этот период дел и событий нет.",
  };
}

async function checkAvailability(rt: Runtime, startAt: string, durationMinutes = 60) {
  const profile = await loadProfile(rt);
  const targetStart = new Date(startAt);
  const targetEnd = new Date(targetStart.getTime() + Math.max(15, Math.min(durationMinutes, 480)) * 60_000);
  const localDay = new Intl.DateTimeFormat("en-CA", { timeZone: profile.timezone }).format(targetStart);
  const day = dayUtcBounds(localDay, profile.timezone);

  const [{ data: events, error: eventError }, { data: tasks, error: taskError }] = await Promise.all([
    tracked(rt, rt.supabase.from("calendar_events").select("id,title,start_at,end_at").eq("user_id", rt.userId).gte("start_at", day.start).lte("start_at", day.end)),
    tracked(rt, rt.supabase.from("tasks").select("id,title,due_date,due_time,status").eq("user_id", rt.userId).eq("due_date", localDay).neq("status", "done").not("due_time", "is", null)),
  ]);
  if (eventError) throw eventError;
  if (taskError) throw taskError;

  const intervals = [
    ...(events ?? []).map((event) => ({
      title: event.title,
      start: new Date(event.start_at),
      end: event.end_at ? new Date(event.end_at) : new Date(new Date(event.start_at).getTime() + 60 * 60_000),
    })),
    ...(tasks ?? []).map((task) => {
      const start = zonedDateTimeToUtc(task.due_date, String(task.due_time).slice(0, 5), profile.timezone);
      return { title: task.title, start, end: new Date(start.getTime() + 60 * 60_000) };
    }),
  ];

  const conflicts = intervals.filter((item) => item.start < targetEnd && item.end > targetStart);
  if (!conflicts.length) return { data: [], reply: "Да, это время свободно." };

  const nextFree = new Date(Math.max(...conflicts.map((item) => item.end.getTime())));
  const nextText = new Intl.DateTimeFormat("ru-RU", { timeZone: profile.timezone, hour: "2-digit", minute: "2-digit" }).format(nextFree);
  return {
    data: conflicts.map((item) => ({ title: item.title, start_at: item.start.toISOString(), end_at: item.end.toISOString() })),
    reply: `В это время занято: ${conflicts.map((item) => item.title).join(", ")}. Ближайшее окно после ${nextText}.`,
  };
}

async function findDocument(rt: Runtime, query: string) {
  const { data, error } = await tracked(rt,
    rt.supabase.from("documents")
      .select("id,title,owner_person,document_type,expiry_date,tags,storage_path,mime_type,size_bytes,created_at")
      .eq("user_id", rt.userId)
      .order("created_at", { ascending: false })
      .limit(200)
  );
  if (error) throw error;

  const wanted = normalize(query);
  const matches = (data ?? []).filter((doc) => {
    const haystack = [doc.title, doc.owner_person, doc.document_type, ...(doc.tags ?? [])]
      .filter(Boolean).join(" ").toLocaleLowerCase("ru-RU");
    return haystack.includes(wanted) || wanted.split(/\s+/).some((part) => part.length > 3 && haystack.includes(part));
  }).slice(0, 10);

  const withUrls = await Promise.all(matches.map(async (doc) => {
    rt.metrics.supabaseQueries += 1;
    const { data: signed, error: signError } = await rt.supabase.storage.from("glasha-private").createSignedUrl(doc.storage_path, 60 * 10);
    if (signError) console.error("document_signed_url_failed", { code: signError.name, message: signError.message, documentId: doc.id });
    const { storage_path: _hidden, ...safe } = doc;
    return { ...safe, action_url: signed?.signedUrl || null };
  }));

  return { data: withUrls, reply: withUrls.length ? `Нашла документов: ${withUrls.length}.` : "Такого документа в архиве не нашла." };
}

type TaskActionRow = {
  id: string;
  title: string;
  description: string | null;
  area: "personal" | "work";
  due_date: string | null;
  due_time: string | null;
  reminder_at: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  status: string;
  goal_id: string | null;
  parent_task_id: string | null;
  is_project: boolean;
  updated_at: string;
};

async function resolveTaskForAction(rt: Runtime, taskQuery: string | null) {
  const { data, error } = await tracked(rt,
    rt.supabase.from("tasks")
      .select("id,title,description,area,due_date,due_time,reminder_at,priority,status,goal_id,parent_task_id,is_project,updated_at")
      .eq("user_id", rt.userId)
      .neq("status", "cancelled")
      .order("updated_at", { ascending: false })
      .limit(100)
  );
  if (error) throw error;
  const tasks = (data ?? []) as TaskActionRow[];
  if (!tasks.length) return { task: null, clarification: "У тебя пока нет задач." };

  if (!taskQuery) {
    const latest = tasks[0];
    const ageMs = Date.now() - new Date(latest.updated_at).getTime();
    if (ageMs > 30 * 60_000) {
      return { task: null, clarification: "Какую именно задачу нужно переместить?" };
    }
    return { task: latest, clarification: null };
  }

  const wanted = normalize(taskQuery)
    .replace(/^задач[ауи]?\s+/i, "")
    .replace(/^про\s+/i, "")
    .trim();
  const tokens = wanted.split(/\s+/).filter((token) => token.length >= 3);

  const scored = tasks.map((task) => {
    const title = normalize(task.title);
    let score = title === wanted ? 100 : 0;
    if (wanted && title.includes(wanted)) score += 60;
    if (wanted && wanted.includes(title)) score += 40;
    score += tokens.filter((token) => title.includes(token)).length * 10;
    return { task, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);

  if (!scored.length) return { task: null, clarification: `Не нашла задачу «${taskQuery}».` };
  if (scored.length > 1 && scored[0].score === scored[1].score) {
    const titles = scored.slice(0, 3).map((item) => `«${item.task.title}»`).join(", ");
    return { task: null, clarification: `Нашла несколько похожих задач: ${titles}. Какую выбрать?` };
  }
  return { task: scored[0].task, clarification: null };
}

async function moveTask(rt: Runtime, taskQuery: string | null, area: "personal" | "work") {
  const resolved = await resolveTaskForAction(rt, taskQuery);
  if (!resolved.task) return { needs_clarification: true, reply: resolved.clarification || "Какую задачу переместить?" };

  const before = resolved.task;
  if (before.area === area) {
    return {
      data: [{ ...before, preserved_id: true }],
      reply: `Задача «${before.title}» уже в разделе «${area === "work" ? "Работа" : "Личное"}».`,
    };
  }

  const { data, error } = await tracked(rt,
    rt.supabase.from("tasks")
      .update({ area, updated_at: new Date().toISOString() })
      .eq("user_id", rt.userId)
      .eq("id", before.id)
      .select("id,title,area,due_date,due_time,reminder_at,priority,status,goal_id,parent_task_id,is_project")
      .single()
  );
  if (error) throw error;

  return {
    data: [{
      ...data,
      previous_area: before.area,
      preserved: {
        id: data.id === before.id,
        due_date: data.due_date === before.due_date,
        due_time: String(data.due_time || "") === String(before.due_time || ""),
        reminder_at: data.reminder_at === before.reminder_at,
        priority: data.priority === before.priority,
        status: data.status === before.status,
        goal_id: data.goal_id === before.goal_id,
        parent_task_id: data.parent_task_id === before.parent_task_id,
      },
    }],
    reply: `Переместила «${before.title}» в «${area === "work" ? "Работа" : "Личное"}». Задача осталась той же, без дубля.`,
  };
}

async function splitTask(rt: Runtime, taskQuery: string) {
  const resolved = await resolveTaskForAction(rt, taskQuery);
  if (!resolved.task) return { needs_clarification: true, reply: resolved.clarification || "Какую задачу разбить на шаги?" };
  const parent = resolved.task;

  const { data: existing, error: existingError } = await tracked(rt,
    rt.supabase.from("tasks")
      .select("id,title,status,due_date,due_time,priority,area,parent_task_id")
      .eq("user_id", rt.userId)
      .eq("parent_task_id", parent.id)
      .order("sort_order")
      .order("created_at")
  );
  if (existingError) throw existingError;

  if ((existing ?? []).length) {
    const completed = (existing ?? []).filter((item) => item.status === "done").length;
    const total = (existing ?? []).length;
    return {
      data: existing,
      reply: `«${parent.title}» уже проект: ${completed}/${total} шагов выполнено (${Math.round((completed / total) * 100)}%).`,
    };
  }

  const model = fastModel();
  const openai = getOpenAI(rt);
  markAi(rt, model, "fast");
  const stepSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      steps: {
        type: "array",
        minItems: 3,
        maxItems: 7,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            priority: { type: "string", enum: ["low","normal","high","urgent"] },
          },
          required: ["title","priority"],
        },
      },
    },
    required: ["steps"],
  } as const;

  const response = await openai.responses.create({
    model,
    store: false,
    reasoning: { effort: "low" },
    instructions:
      "Разбей одну существующую задачу на 3–7 конкретных выполнимых подзадач. " +
      "Не создавай новую родительскую задачу. Не придумывай даты, время или напоминания. " +
      "Подзадачи должны быть короткими и не дублировать родителя. Ответ только по JSON-схеме.",
    input: `Задача: ${parent.title}\nОписание: ${parent.description || "нет"}\nОбласть: ${parent.area}\nПриоритет родителя: ${parent.priority}`,
    text: { format: { type: "json_schema", name: "task_steps", schema: stepSchema, strict: true } },
  });
  const generated = JSON.parse(response.output_text) as { steps: Array<{ title: string; priority: "low" | "normal" | "high" | "urgent" }> };

  const { error: projectError } = await tracked(rt,
    rt.supabase.from("tasks")
      .update({ is_project: true, updated_at: new Date().toISOString() })
      .eq("user_id", rt.userId)
      .eq("id", parent.id)
  );
  if (projectError) throw projectError;

  const rows = generated.steps.map((step, index) => ({
    user_id: rt.userId,
    parent_task_id: parent.id,
    area: parent.area,
    title: step.title.trim(),
    due_date: null,
    due_time: null,
    reminder_at: null,
    priority: step.priority || parent.priority,
    status: "todo",
    goal_id: parent.goal_id,
    source: rt.source,
    sort_order: (index + 1) * 10,
  }));

  const { data, error } = await tracked(rt,
    rt.supabase.from("tasks")
      .insert(rows)
      .select("id,title,status,due_date,due_time,reminder_at,priority,area,parent_task_id,goal_id,sort_order")
  );
  if (error) throw error;

  return {
    data,
    reply: `Превратила «${parent.title}» в проект и создала ${data?.length || 0} подзадач. Родительская задача сохранена.`,
  };
}

async function openService(rt: Runtime, serviceName: string) {
  const connections = await loadConnections(rt);
  const wanted = normalize(serviceName);
  const connection = connections.find((item) => {
    const aliases = item.aliases ?? [];
    return normalize(item.service) === wanted ||
      normalize(item.display_name) === wanted ||
      normalize(item.display_name).includes(wanted) ||
      wanted.includes(normalize(item.display_name)) ||
      aliases.some((alias: string) => normalize(alias) === wanted || normalize(alias).includes(wanted) || wanted.includes(normalize(alias)));
  });
  if (!connection) return { reply: "Такого приложения в «Подключениях» пока нет." };
  if (!connection.enabled) return { reply: `${connection.display_name} скрыто в «Подключениях». Включи его, чтобы открывать командой.` };

  const nativeUrl = connection.deep_link || connection.url_scheme;
  const universalUrl = connection.universal_link;
  const fallbackUrl = connection.web_fallback_url || connection.open_url || universalUrl;
  if (connection.capability === "NOT_CONNECTED" && !nativeUrl && !fallbackUrl) {
    return { reply: `${connection.display_name}: интеграция не подключена и ссылка для открытия не настроена.` };
  }

  return {
    data: [{
      id: connection.id,
      title: connection.display_name,
      platform: connection.platform,
      capability: connection.capability,
      native_url: nativeUrl,
      universal_url: universalUrl,
      action_url: nativeUrl || universalUrl || fallbackUrl,
      fallback_url: fallbackUrl,
    }],
    reply: connection.capability === "OPEN_ONLY"
      ? `Открываю ${connection.display_name}. Это только запуск приложения/сайта — аккаунт к Глаше не подключён.`
      : `Открываю ${connection.display_name}. Возможность: ${connection.capability}.`,
  };
}

async function contactAction(rt: Runtime, input: { contactName: string; method: "call" | "telegram" | "email"; messageText?: string | null }) {
  const contacts = await loadContacts(rt);
  const wanted = normalize(input.contactName);
  const contact = contacts.find((item) => normalize(item.name) === wanted)
    ?? contacts.find((item) => normalize(item.name).includes(wanted) || wanted.includes(normalize(item.name)));
  if (!contact) return { reply: "Контакт не найден. Добавь его в раздел «Контакты»." };

  if (input.method === "call") {
    if (!contact.phone) return { reply: `У ${contact.name} не сохранён телефон.` };
    return {
      data: [{ id: contact.id, title: `Позвонить ${contact.name}`, action_url: `tel:${contact.phone}`, requires_confirmation: true }],
      reply: `Нашла номер ${contact.name}. Нажми «Позвонить», чтобы начать вызов.`,
    };
  }

  if (input.method === "telegram") {
    if (!contact.telegram_username) return { reply: `У ${contact.name} не сохранён Telegram username.` };
    const username = contact.telegram_username.replace(/^@/, "");
    const message = input.messageText ? `&text=${encodeURIComponent(input.messageText)}` : "";
    return {
      data: [{
        id: contact.id,
        title: `Открыть чат с ${contact.name}`,
        action_url: `tg://resolve?domain=${encodeURIComponent(username)}${message}`,
        fallback_url: `https://t.me/${encodeURIComponent(username)}`,
        prepared_message: input.messageText || null,
        requires_confirmation: true,
      }],
      reply: input.messageText
        ? "Сообщение подготовлено, но не отправлено. Открой Telegram и подтверди отправку."
        : `Открою чат с ${contact.name} после твоего нажатия.`,
    };
  }

  if (!contact.email) return { reply: `У ${contact.name} не сохранён email.` };
  return {
    data: [{
      id: contact.id,
      title: `Написать ${contact.name}`,
      action_url: `mailto:${contact.email}${input.messageText ? `?body=${encodeURIComponent(input.messageText)}` : ""}`,
      requires_confirmation: true,
    }],
    reply: "Письмо подготовлено, но не отправлено.",
  };
}

async function searchTickets(rt: Runtime, input: { from: string; to: string; date: string; afterTime?: string | null }) {
  const openai = getOpenAI(rt);
  const model = process.env.OPENAI_WEB_MODEL || fastModel();
  markAi(rt, model, "fast", true);

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
            url: { type: ["string","null"] },
          },
          required: ["title","departure","arrival","price","carrier","source","url"],
        },
      },
    },
    required: ["summary","options"],
  } as const;

  const response = await openai.responses.create({
    model,
    store: false,
    reasoning: { effort: "low" },
    tools: [{ type: "web_search" }],
    instructions:
      "Найди актуальные варианты билетов. Не покупай и не бронируй. Покажи только найденные варианты с источником и рабочей ссылкой. " +
      "Если точная цена недоступна, price=null. Не выдумывай расписание или стоимость.",
    input: `Маршрут: ${input.from} — ${input.to}. Дата: ${input.date}. После: ${input.afterTime || "без ограничения"}.`,
    text: { format: { type: "json_schema", name: "ticket_options", schema: ticketSchema, strict: true } },
  });

  const data = JSON.parse(response.output_text) as { summary: string; options: Array<Record<string, unknown>> };
  return { reply: data.summary, data: data.options };
}

async function advise(rt: Runtime, question: string, goalTitle: string | null, explicitDeep: boolean) {
  let goal: Goal | null = null;
  if (goalTitle) {
    const goals = await loadGoals(rt);
    const wanted = normalize(goalTitle);
    goal = goals.find((g) => normalize(g.title) === wanted)
      ?? goals.find((g) => normalize(g.title).includes(wanted) || wanted.includes(normalize(g.title)))
      ?? null;
  }

  let taskQuery = rt.supabase.from("tasks")
    .select("id,title,area,due_date,due_time,status,priority,goal_id")
    .eq("user_id", rt.userId)
    .neq("status", "done")
    .order("due_date", { ascending: true })
    .limit(20);
  if (goal) taskQuery = taskQuery.eq("goal_id", goal.id);

  const [{ data: tasks, error: taskError }, { data: events, error: eventError }] = await Promise.all([
    tracked(rt, taskQuery),
    tracked(rt, rt.supabase.from("calendar_events")
      .select("id,title,kind,area,start_at,end_at")
      .eq("user_id", rt.userId)
      .gte("start_at", new Date().toISOString())
      .order("start_at")
      .limit(15)),
  ]);
  if (taskError) throw taskError;
  if (eventError) throw eventError;

  const selection = chooseAdvisorModel({
    question,
    explicitDeep,
    useWeb: false,
    contextItems: (tasks?.length || 0) + (events?.length || 0) + (goal ? 1 : 0),
  });
  const openai = getOpenAI(rt);
  markAi(rt, selection.model, selection.tier);

  const response = await openai.responses.create({
    model: selection.model,
    store: false,
    reasoning: { effort: selection.reasoning },
    instructions:
      "Ты — Советчик Глаши. Ответь по-русски практично. Используй только переданный минимальный личный контекст. " +
      "Не придумывай факты и не используй web search: этот вызов только про личные данные пользователя.",
    input:
      `Вопрос: ${question}\nЦель: ${goal ? JSON.stringify(goal) : "не указана"}\n` +
      `Задачи: ${JSON.stringify(tasks ?? [])}\nКалендарь: ${JSON.stringify(events ?? [])}`,
  });

  return { reply: response.output_text, data: tasks ?? [], model_tier: selection.tier };
}

async function executeDeterministic(rt: Runtime, route: DeterministicRoute, rawText: string) {
  rt.metrics.intent = route.kind;

  if (route.kind === "open_service") return openService(rt, route.service);
  if (route.kind === "find_document") return findDocument(rt, route.query);
  if (route.kind === "contact_action") return contactAction(rt, {
    contactName: route.contactName,
    method: route.method,
    messageText: route.messageText,
  });

  if (route.kind === "query_schedule") return querySchedule(rt, route.range);
  if (route.kind === "move_task") return moveTask(rt, route.taskQuery, route.area);
  if (route.kind === "split_task") return splitTask(rt, route.taskQuery);

  if (route.kind === "create_expense") return createExpense(rt, {
    amount: route.amount,
    note: route.note,
    categorySlug: route.categorySlug,
  });

  if (route.kind === "query_expenses") {
    const profile = await loadProfile(rt);
    const bounds = resolveMonthBounds(route.monthToken, profile.timezone);
    return queryExpenses(rt, { categorySlug: route.categorySlug, start: bounds?.start, end: bounds?.end });
  }

  if (route.kind === "create_task") {
    const profile = await loadProfile(rt);
    const dueDate = resolveDateToken(route.dateToken, profile.timezone);
    return createTask(rt, { title: route.title, area: route.area, dueDate, dueTime: route.time });
  }

  if (route.kind === "create_appointment") {
    const profile = await loadProfile(rt);
    const date = resolveDateToken(route.dateToken, profile.timezone);
    if (!route.time) return { needs_clarification: true, reply: "Во сколько запись к врачу?" };
    const startAt = zonedDateTimeToUtc(date, route.time, profile.timezone).toISOString();
    return createEvent(rt, { title: route.title, kind: "appointment", area: "health", startAt, mirrorHealth: true });
  }

  if (route.kind === "log_fitness") {
    const profile = await loadProfile(rt);
    const date = resolveDateToken(route.dateToken, profile.timezone);
    const occurredAt = route.time
      ? zonedDateTimeToUtc(date, route.time, profile.timezone).toISOString()
      : zonedDateTimeToUtc(date, "12:00", profile.timezone).toISOString();
    return logHealth(rt, { kind: "fitness", title: "Тренировка", occurredAt, addCalendar: Boolean(route.time) });
  }

  if (route.kind === "cycle_start") {
    const profile = await loadProfile(rt);
    const date = resolveDateToken(route.dateToken, profile.timezone);
    const occurredAt = zonedDateTimeToUtc(date, "12:00", profile.timezone).toISOString();
    return logHealth(rt, { kind: "cycle_start", title: "Начало цикла", occurredAt, addCalendar: true, allDay: true });
  }

  if (route.kind === "check_availability") {
    const profile = await loadProfile(rt);
    const date = resolveDateToken(route.dateToken, profile.timezone);
    const startAt = zonedDateTimeToUtc(date, route.time, profile.timezone).toISOString();
    return checkAvailability(rt, startAt, route.durationMinutes);
  }

  if (route.kind === "search_tickets") {
    const profile = await loadProfile(rt);
    const date = resolveDateToken(route.dateToken, profile.timezone);
    return searchTickets(rt, { from: route.from, to: route.to, date, afterTime: route.afterTime });
  }

  return advise(rt, rawText, route.goalTitle, route.explicitDeep);
}

async function executeParsed(rt: Runtime, parsed: Parsed, rawText: string) {
  rt.metrics.intent = parsed.action;
  if (parsed.needs_clarification) {
    return { needs_clarification: true, reply: parsed.clarification_question || "Уточни, пожалуйста, одну деталь." };
  }

  if (parsed.action === "create_expense") {
    if (parsed.amount == null) return { needs_clarification: true, reply: "Сколько именно ты потратила?" };
    return createExpense(rt, {
      amount: parsed.amount,
      note: parsed.description || parsed.merchant || parsed.title || rawText,
      categorySlug: parsed.category_slug,
      currency: parsed.currency,
      occurredAt: parsed.occurred_at,
    });
  }

  if (parsed.action === "query_expenses") {
    return queryExpenses(rt, {
      categorySlug: parsed.category_slug,
      start: parsed.query_start_date,
      end: parsed.query_end_date,
    });
  }

  if (parsed.action === "create_task") {
    return createTask(rt, {
      title: parsed.title || rawText,
      area: parsed.area === "work" ? "work" : "personal",
      dueDate: parsed.due_date,
      dueTime: parsed.due_time,
      goalTitle: parsed.goal_title,
    });
  }

  if (parsed.action === "create_event") {
    if (!parsed.start_at) return { needs_clarification: true, reply: "На какую дату и время поставить событие?" };
    const area = parsed.area || (parsed.event_kind === "appointment" ? "health" : parsed.event_kind === "trip" ? "travel" : "personal");
    return createEvent(rt, {
      title: parsed.title || rawText,
      kind: parsed.event_kind || "event",
      area,
      startAt: parsed.start_at,
      endAt: parsed.end_at,
      allDay: parsed.all_day ?? false,
      mirrorHealth: area === "health" || parsed.event_kind === "appointment",
    });
  }

  if (parsed.action === "log_health") {
    const kind = parsed.health_kind || "note";
    return logHealth(rt, {
      kind,
      title: parsed.title,
      occurredAt: parsed.start_at || parsed.occurred_at || new Date().toISOString(),
      addCalendar: kind === "cycle_start" || kind === "cycle_end" || (kind === "fitness" && Boolean(parsed.start_at)) || kind === "appointment",
      endAt: parsed.end_at,
      allDay: kind.startsWith("cycle") && !parsed.start_at,
    });
  }

  if (parsed.action === "create_goal") {
    const { data, error } = await tracked(rt,
      rt.supabase.from("goals").insert({
        user_id: rt.userId,
        kind: parsed.goal_kind || "goal",
        title: parsed.title || rawText,
        description: parsed.description,
        target_date: parsed.target_date,
      }).select("id,title,kind,target_date,status").single()
    );
    if (error) throw error;
    rt.goals = undefined;
    return { data, reply: "Сохранила цель." };
  }

  if (parsed.action === "save_note") {
    const { data, error } = await tracked(rt,
      rt.supabase.from("inbox_entries").insert({
        user_id: rt.userId,
        text: rawText,
        source: rt.source,
        intent: "save_note",
        structured: {},
        processed: false,
      }).select("id").single()
    );
    if (error) throw error;
    return { data, reply: "Сохранила мысль во входящие." };
  }

  if (parsed.action === "query_schedule") {
    return querySchedule(rt, parsed.query_range || "today", parsed.query_start_date, parsed.query_end_date);
  }

  if (parsed.action === "check_availability") {
    if (!parsed.start_at) return { needs_clarification: true, reply: "На какую дату и время проверить свободное окно?" };
    return checkAvailability(rt, parsed.start_at, parsed.duration_minutes || 60);
  }

  if (parsed.action === "find_document") return findDocument(rt, parsed.document_query || parsed.title || rawText);
  if (parsed.action === "move_task") {
    if (!parsed.target_area) return { needs_clarification: true, reply: "Куда переместить задачу: в личное или в работу?" };
    return moveTask(rt, parsed.task_query || parsed.title, parsed.target_area);
  }
  if (parsed.action === "split_task") return splitTask(rt, parsed.task_query || parsed.title || rawText);
  if (parsed.action === "open_service") return openService(rt, parsed.service_name || parsed.title || rawText);
  if (parsed.action === "contact_action") return contactAction(rt, {
    contactName: parsed.contact_name || parsed.title || "",
    method: parsed.contact_method || "call",
    messageText: parsed.message_text,
  });

  if (parsed.action === "search_tickets") {
    if (!parsed.route_from || !parsed.route_to || !parsed.travel_date) {
      return { needs_clarification: true, reply: "Уточни маршрут и дату поездки." };
    }
    return searchTickets(rt, {
      from: parsed.route_from,
      to: parsed.route_to,
      date: parsed.travel_date,
      afterTime: parsed.after_time,
    });
  }

  return advise(rt, rawText, parsed.goal_title, false);
}

function actionSummary(results: Array<{ action: string; result: Record<string, unknown> }>) {
  const counts = {
    tasks: results.filter((x) => x.action === "create_task").length,
    events: results.filter((x) => x.action === "create_appointment" || x.action === "create_event").length,
    expenses: results.filter((x) => x.action === "create_expense").length,
    health: results.filter((x) => x.action === "log_fitness" || x.action === "cycle_start" || x.action === "log_health").length,
    goals: results.filter((x) => x.action === "create_goal").length,
    notes: results.filter((x) => x.action === "save_note").length,
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
  const startedAt = Date.now();
  let rt: Runtime | null = null;

  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
      return privateJson({ error: "supabase_not_configured" }, 503);
    }

    const supabase = await createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    const user = authData.user;
    if (!user) return privateJson({ error: "auth_required" }, 401);

    const body = await request.json();
    const text = String(body?.text ?? "").trim();

    rt = {
      supabase,
      userId: user.id,
      metrics: {
        startedAt,
        routeType: "SUPABASE_ONLY",
        intent: "unknown",
        openaiCalls: 0,
        webSearchUsed: false,
        modelUsed: null,
        supabaseQueries: 0,
      },
      source: body?.source === "voice" ? "voice" : "text",
    };
    if (!text) return privateJson({ error: "empty_text" }, 400);

    const segments = splitBrainDump(text);
    const executed: Array<{ action: string; result: Record<string, unknown> }> = [];
    const clarifications: string[] = [];

    for (const segment of segments) {
      const fast = deterministicRoute(segment);
      let action = fast?.kind || "ai_fallback";
      let result: Record<string, unknown>;

      if (fast) {
        result = await executeDeterministic(rt, fast, segment) as Record<string, unknown>;
      } else {
        const parsed = await parseWithAi(rt, segment);
        action = parsed.action;
        result = await executeParsed(rt, parsed, segment) as Record<string, unknown>;
      }

      if (result.needs_clarification) {
        clarifications.push(String(result.reply || "Уточни одну деталь."));
      } else {
        executed.push({ action, result });
      }
    }

    rt.metrics.intent = segments.length > 1 ? "brain_dump" : (executed[0]?.action || rt.metrics.intent);

    let payload: Record<string, unknown>;
    if (segments.length === 1 && executed.length === 1 && clarifications.length === 0) {
      payload = {
        ok: true,
        action: executed[0].action,
        ...executed[0].result,
        telemetry: {
          route_type: rt.metrics.routeType,
          openai_calls_count: rt.metrics.openaiCalls,
          web_search_used: rt.metrics.webSearchUsed,
          model_used: rt.metrics.modelUsed,
          supabase_queries_count: rt.metrics.supabaseQueries,
          latency_ms: Math.max(0, Date.now() - startedAt),
        },
      };
    } else {
      const summary = actionSummary(executed);
      const firstReadable = executed.find((item) =>
        ["query_schedule","query_expenses","check_availability","find_document","open_service","contact_action","search_tickets","move_task","split_task","advice"].includes(item.action)
      );
      const reply = [
        summary,
        firstReadable ? String(firstReadable.result.reply || "") : null,
        clarifications[0] ? `Уточни только одно: ${clarifications[0]}` : null,
      ].filter(Boolean).join(" ");

      payload = {
        ok: true,
        action: segments.length > 1 ? "brain_dump" : executed[0]?.action,
        reply: reply || "Готово.",
        needs_clarification: clarifications.length > 0,
        data: executed.flatMap((item) => Array.isArray(item.result.data) ? item.result.data as unknown[] : []),
        summary: { total_items: segments.length, executed: executed.length, needs_clarification: clarifications.length },
        telemetry: {
          route_type: rt.metrics.routeType,
          openai_calls_count: rt.metrics.openaiCalls,
          web_search_used: rt.metrics.webSearchUsed,
          model_used: rt.metrics.modelUsed,
          supabase_queries_count: rt.metrics.supabaseQueries,
          latency_ms: Math.max(0, Date.now() - startedAt),
        },
      };
    }

    await writeTelemetry(rt);
    return privateJson(payload);
  } catch (error) {
    console.error("assistant_failed", error);
    if (rt) await writeTelemetry(rt).catch(() => undefined);
    if (error instanceof Error && (error.message === "openai_not_configured" || error.name === "openai_not_configured")) {
      return privateJson({ error: "openai_not_configured" }, 503);
    }
    return privateJson({ error: "assistant_failed" }, 500);
  }
}
