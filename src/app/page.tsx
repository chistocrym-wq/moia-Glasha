"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { AssistantAvatar, GlashaCharacter, type GlashaImage } from "@/components/GlashaCharacter";
import { InstallGlashaTile } from "@/components/PwaClient";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  askAdvisor,
  getSystemStatus,
  sendAssistantCommand,
  transcribeVoice,
  uploadEntityAttachment,
  type AssistantResponse,
  type SystemStatus,
} from "@/lib/glasha-api";

type SectionId =
  | "home" | "tasks" | "work" | "calendar" | "finance" | "health"
  | "goals" | "learning" | "travel" | "documents" | "quick" | "advisor" | "chat";

type Task = {
  id: string;
  title: string;
  area: "Личное" | "Работа";
  done: boolean;
  time?: string;
  dueDate?: string;
  priority?: string;
};

type Expense = {
  id: string;
  title: string;
  amount: number;
  currency: string;
  category: string;
  categorySlug?: string;
  occurredAt?: string;
};

type EventItem = { id: string; title: string; when: string; area: string; kind?: string };
type Note = { id: string; text: string; createdAt: string };
type Goal = { id: string; title: string; kind: "Мечта" | "Цель"; targetDate?: string; description?: string };
type HealthEvent = { id: string; kind: string; occurredAt: string; title?: string };
type ExpenseCategory = { id: string; name: string; slug: string };

const sections: Array<{ id: SectionId; label: string; icon: string; subtitle: string; image: GlashaImage }> = [
  { id: "home", label: "Главная", icon: "⌂", subtitle: "Всё важное сейчас", image: "home" },
  { id: "tasks", label: "Мои дела", icon: "✓", subtitle: "Личное и бытовое", image: "cooking" },
  { id: "work", label: "Работа", icon: "▣", subtitle: "Проекты и задачи", image: "work" },
  { id: "calendar", label: "Календарь", icon: "◫", subtitle: "События и напоминания", image: "travel" },
  { id: "finance", label: "Финансы", icon: "₽", subtitle: "Расходы по категориям", image: "documents" },
  { id: "health", label: "Здоровье", icon: "♡", subtitle: "Самочувствие и цикл", image: "health" },
  { id: "goals", label: "Мечты и цели", icon: "☆", subtitle: "Хочу и к чему иду", image: "ideas" },
  { id: "learning", label: "Обучение", icon: "◉", subtitle: "Языки и развитие", image: "learning" },
  { id: "travel", label: "Поездки", icon: "✈", subtitle: "Билеты и планы", image: "travel" },
  { id: "documents", label: "Документы", icon: "▤", subtitle: "Всё под рукой", image: "documents" },
  { id: "quick", label: "Быстрый доступ", icon: "⌘", subtitle: "Ссылки и приложения", image: "quick" },
  { id: "advisor", label: "Советчик", icon: "?", subtitle: "Разобраться и спланировать", image: "ideas" },
  { id: "chat", label: "Поговорить", icon: "✦", subtitle: "Выгрузить мысли", image: "cat" },
];

const sampleTasks: Task[] = [
  { id: "sample-t1", title: "Оплатить интернет", area: "Личное", done: false, time: "12:00" },
  { id: "sample-t2", title: "Позвонить маме", area: "Личное", done: false, time: "19:00" },
  { id: "sample-t3", title: "Подготовить презентацию", area: "Работа", done: false, time: "15:00" },
];
const sampleEvents: EventItem[] = [
  { id: "sample-e1", title: "Встреча с клиентом", when: "Сегодня · 10:00", area: "Работа" },
  { id: "sample-e2", title: "Запись к врачу", when: "Сегодня · 14:30", area: "Здоровье" },
];
const sampleExpenses: Expense[] = [
  { id: "sample-x1", title: "Кофе", amount: 320, currency: "RUB", category: "Кофе и кафе" },
  { id: "sample-x2", title: "Продукты", amount: 1840, currency: "RUB", category: "Продукты" },
];

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="chip">{children}</span>;
}

function InfoCard({ icon, title, text }: { icon: string; title: string; text: string }) {
  return <article className="infoCard"><span className="infoIcon">{icon}</span><div><h3>{title}</h3><p>{text}</p></div><span className="arrow">›</span></article>;
}

function formatDateTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("ru-RU", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export default function Home() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [active, setActive] = useState<SectionId>("home");
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [authState, setAuthState] = useState<"checking" | "signed_out" | "signed_in" | "setup">("checking");
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [tasks, setTasks] = useState<Task[]>(sampleTasks);
  const [events, setEvents] = useState<EventItem[]>(sampleEvents);
  const [expenses, setExpenses] = useState<Expense[]>(sampleExpenses);
  const [notes, setNotes] = useState<Note[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [healthEvents, setHealthEvents] = useState<HealthEvent[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [defaultCurrency, setDefaultCurrency] = useState("RUB");
  const [command, setCommand] = useState("");
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState("Я рядом. Скажи или напиши, что нужно запомнить.");
  const [lastResult, setLastResult] = useState<AssistantResponse | null>(null);
  const [advisorQuestion, setAdvisorQuestion] = useState("");
  const [advisorAnswer, setAdvisorAnswer] = useState("");
  const [advisorBusy, setAdvisorBusy] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const voiceChunksRef = useRef<BlobPart[]>([]);

  const current = sections.find((item) => item.id === active) ?? sections[0];
  const liveData = authState === "signed_in" && Boolean(userId);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const status = await getSystemStatus();
        if (cancelled) return;
        setSystemStatus(status);

        if (!status.supabase || !supabase) {
          setAuthState("setup");
          setAnswer("Интерфейс готов к настоящему режиму. Осталось подключить Supabase и OpenAI.");
          return;
        }

        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        const id = data.session?.user?.id ?? null;
        setUserId(id);
        setAuthState(id ? "signed_in" : "signed_out");
      } catch {
        if (!cancelled) {
          setAuthState("setup");
          setAnswer("Не смогла проверить подключение backend. Сейчас показан безопасный демо-режим без сохранения.");
        }
      }
    }

    init();

    if (!supabase) return () => { cancelled = true; };
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const id = session?.user?.id ?? null;
      setUserId(id);
      setAuthState(id ? "signed_in" : "signed_out");
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (authState === "signed_in" && userId) {
      void loadLiveData();
    } else if (authState === "setup" || authState === "signed_out") {
      setTasks(sampleTasks);
      setEvents(sampleEvents);
      setExpenses(sampleExpenses);
      setNotes([]);
      setGoals([]);
      setHealthEvents([]);
      setCategories([]);
    }
  }, [authState, userId]);

  async function loadLiveData() {
    if (!supabase || !userId) return;

    const [taskRes, eventRes, expenseRes, noteRes, goalRes, healthRes, categoryRes, profileRes] = await Promise.all([
      supabase.from("tasks").select("id,title,area,status,due_date,due_time,priority").eq("user_id", userId).order("due_date", { ascending: true }),
      supabase.from("calendar_events").select("id,title,start_at,kind").eq("user_id", userId).order("start_at", { ascending: true }).limit(100),
      supabase.from("expenses").select("id,amount,currency,occurred_at,merchant,note,expense_categories(name,slug)").eq("user_id", userId).order("occurred_at", { ascending: false }).limit(300),
      supabase.from("inbox_entries").select("id,text,created_at,processed").eq("user_id", userId).order("created_at", { ascending: false }).limit(100),
      supabase.from("goals").select("id,title,description,kind,target_date,status").eq("user_id", userId).eq("status", "active").order("created_at", { ascending: false }),
      supabase.from("health_events").select("id,kind,occurred_at,title").eq("user_id", userId).order("occurred_at", { ascending: false }).limit(100),
      supabase.from("expense_categories").select("id,name,slug").eq("user_id", userId).order("sort_order"),
      supabase.from("profiles").select("default_currency").eq("id", userId).maybeSingle(),
    ]);

    const error = taskRes.error || eventRes.error || expenseRes.error || noteRes.error || goalRes.error || healthRes.error || categoryRes.error || profileRes.error;
    if (error) {
      setAnswer("Backend подключён, но не удалось загрузить данные. Проверь, применена ли migration Supabase.");
      return;
    }

    setTasks((taskRes.data ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      area: row.area === "work" ? "Работа" : "Личное",
      done: row.status === "done",
      dueDate: row.due_date || undefined,
      time: row.due_time ? String(row.due_time).slice(0, 5) : undefined,
      priority: row.priority || undefined,
    })));

    setEvents((eventRes.data ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      when: formatDateTime(row.start_at),
      area: eventArea(row.kind),
      kind: row.kind,
    })));

    setExpenses((expenseRes.data ?? []).map((row) => {
      const relation = row.expense_categories as unknown;
      const category = Array.isArray(relation) ? relation[0] : relation as { name?: string; slug?: string } | null;
      return {
        id: row.id,
        title: row.merchant || row.note || category?.name || "Расход",
        amount: Number(row.amount) || 0,
        currency: row.currency || "RUB",
        category: category?.name || "Другое",
        categorySlug: category?.slug,
        occurredAt: row.occurred_at,
      };
    }));

    setNotes((noteRes.data ?? []).filter((row) => !row.processed).map((row) => ({
      id: row.id,
      text: row.text,
      createdAt: row.created_at,
    })));

    setGoals((goalRes.data ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description || undefined,
      kind: row.kind === "dream" ? "Мечта" : "Цель",
      targetDate: row.target_date || undefined,
    })));

    setHealthEvents((healthRes.data ?? []).map((row) => ({
      id: row.id,
      kind: row.kind,
      occurredAt: row.occurred_at,
      title: row.title || undefined,
    })));

    setCategories((categoryRes.data ?? []).map((row) => ({ id: row.id, name: row.name, slug: row.slug })));
    setDefaultCurrency(profileRes.data?.default_currency || "RUB");
  }

  function eventArea(kind?: string) {
    if (kind === "health" || kind === "cycle" || kind === "appointment") return "Здоровье";
    if (kind === "trip") return "Поездка";
    if (kind === "deadline") return "Работа";
    return "Событие";
  }

  async function signIn(e: FormEvent) {
    e.preventDefault();
    if (!supabase || !email.trim()) return;
    setAuthMessage("Отправляю ссылку для входа…");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setAuthMessage(error ? "Не получилось отправить письмо: " + error.message : "Проверь почту — ссылка для входа отправлена.");
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setUserId(null);
    setAuthState("signed_out");
    setAnswer("Вышла из личного пространства.");
  }

  async function processCommand(raw: string, source: "text" | "voice" = "text") {
    const text = raw.trim();
    if (!text) return;

    if (!liveData) {
      setAnswer("Эта команда уже переведена на настоящий backend, но сейчас backend ещё не подключён к твоему аккаунту.");
      return;
    }
    if (!systemStatus?.openai) {
      setAnswer("Supabase подключён, но AI-маршрутизация ещё ждёт OPENAI_API_KEY.");
      return;
    }

    setBusy(true);
    setLastResult(null);
    try {
      const result = await sendAssistantCommand(text, source);
      setAnswer(result.reply || "Готово.");
      setLastResult(result);
      if (!result.needs_clarification) await loadLiveData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "request_failed";
      if (message === "auth_required") setAnswer("Нужно войти в Глашу.");
      else if (message === "openai_not_configured") setAnswer("OpenAI ещё не подключён.");
      else if (message === "supabase_not_configured") setAnswer("Supabase ещё не подключён.");
      else setAnswer("Не получилось выполнить команду. Я сохранила ошибку в консоль для отладки.");
      console.error(error);
    } finally {
      setBusy(false);
    }
  }

  async function submitCommand(e: FormEvent) {
    e.preventDefault();
    const value = command;
    setCommand("");
    await processCommand(value, "text");
  }

  async function startVoice() {
    if (listening) {
      mediaRecorderRef.current?.stop();
      return;
    }

    if (!liveData || !systemStatus?.transcribe) {
      setAnswer("Серверный голос уже подготовлен, но для него нужны подключённые Supabase и OpenAI.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setAnswer("Этот браузер не разрешает запись аудио. Можно использовать текстовый ввод.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      voiceChunksRef.current = [];
      const preferred = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = preferred ? new MediaRecorder(stream, { mimeType: preferred }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size) voiceChunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        setListening(false);
        stream.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        const blob = new Blob(voiceChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (!blob.size) {
          setAnswer("Запись пустая. Попробуй ещё раз.");
          return;
        }
        setBusy(true);
        setAnswer("Расшифровываю и раскладываю по разделам…");
        try {
          const text = await transcribeVoice(blob);
          setCommand(text);
          await processCommand(text, "voice");
        } catch (error) {
          console.error(error);
          setAnswer("Не получилось расшифровать голос.");
        } finally {
          setBusy(false);
        }
      };

      recorder.onerror = () => {
        setListening(false);
        stream.getTracks().forEach((track) => track.stop());
        setAnswer("Ошибка записи голоса.");
      };

      recorder.start();
      setListening(true);
      setAnswer("Слушаю… Нажми на микрофон ещё раз, когда закончишь.");
    } catch {
      setAnswer("Нет доступа к микрофону. Разреши микрофон для сайта или используй текст.");
    }
  }

  async function toggleTask(id: string) {
    if (!liveData || !supabase || id.startsWith("sample-")) {
      setAnswer("В демо-режиме изменения не сохраняются.");
      return;
    }
    const task = tasks.find((item) => item.id === id);
    if (!task) return;
    const nextStatus = task.done ? "todo" : "done";
    const { error } = await supabase.from("tasks").update({ status: nextStatus, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) setAnswer("Не смогла изменить задачу.");
    else await loadLiveData();
  }

  async function addTask(area: Task["area"] = "Личное") {
    if (!liveData || !supabase || !userId) {
      setAnswer("Ручное добавление уже переведено на Supabase и заработает после подключения аккаунта.");
      return;
    }
    const title = window.prompt(area === "Работа" ? "Новая рабочая задача" : "Новое личное дело");
    if (!title?.trim()) return;
    const dueDate = window.prompt("Дата YYYY-MM-DD (можно оставить пустой)")?.trim() || null;
    const dueTime = window.prompt("Время HH:MM (можно оставить пустым)")?.trim() || null;
    const { error } = await supabase.from("tasks").insert({
      user_id: userId,
      area: area === "Работа" ? "work" : "personal",
      title: title.trim(),
      due_date: dueDate,
      due_time: dueTime,
      source: "manual",
    });
    if (error) setAnswer("Не смогла сохранить задачу.");
    else {
      setAnswer("Задача сохранена.");
      await loadLiveData();
    }
  }

  async function addExpense() {
    if (!liveData || !supabase || !userId) {
      setAnswer("Ручные расходы уже переведены на Supabase и заработают после подключения аккаунта.");
      return;
    }
    const title = window.prompt("На что потратила?");
    if (!title?.trim()) return;
    const amount = Number((window.prompt("Сумма") ?? "").replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) return;
    const list = categories.map((item) => item.name).join(", ");
    const categoryInput = window.prompt("Категория: " + list, categories[0]?.name || "Другое")?.trim().toLowerCase();
    const category = categories.find((item) => item.name.toLowerCase() === categoryInput || item.slug.toLowerCase() === categoryInput)
      ?? categories.find((item) => item.slug === "other")
      ?? null;
    const currency = window.prompt("Валюта", defaultCurrency)?.trim().toUpperCase() || defaultCurrency;
    const { error } = await supabase.from("expenses").insert({
      user_id: userId,
      category_id: category?.id ?? null,
      amount,
      currency,
      note: title.trim(),
      source: "manual",
    });
    if (error) setAnswer("Не смогла сохранить расход.");
    else {
      setAnswer(`Записала ${formatMoney(amount, currency)} — ${category?.name || "Другое"}.`);
      await loadLiveData();
    }
  }

  async function addGoal() {
    if (!liveData || !supabase || !userId) {
      setAnswer("Мечты и цели уже переведены на Supabase и заработают после подключения аккаунта.");
      return;
    }
    const title = window.prompt("Какая мечта или цель?");
    if (!title?.trim()) return;
    const kind = window.confirm("Это конкретная цель? Нажми OK для цели, Отмена для мечты.") ? "goal" : "dream";
    const targetDate = window.prompt("Желаемая дата YYYY-MM-DD (можно оставить пустой)")?.trim() || null;
    const { error } = await supabase.from("goals").insert({
      user_id: userId, title: title.trim(), kind, target_date: targetDate,
    });
    if (error) setAnswer("Не смогла сохранить цель.");
    else {
      setAnswer("Сохранила. В Советчике можно разложить её на ближайшие шаги.");
      await loadLiveData();
    }
  }

  function attachToTask(taskId: string) {
    if (!liveData || taskId.startsWith("sample-")) {
      setAnswer("Вложения работают только в подключённом личном пространстве.");
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf,.doc,.docx,.xls,.xlsx,.txt,.jpg,.jpeg,.png,.webp";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setBusy(true);
      setAnswer("Загружаю документ…");
      try {
        await uploadEntityAttachment("task", taskId, file);
        setAnswer(`Прикрепила «${file.name}» к задаче.`);
      } catch (error) {
        console.error(error);
        setAnswer("Не получилось прикрепить файл.");
      } finally {
        setBusy(false);
      }
    };
    input.click();
  }

  async function submitAdvisor(e: FormEvent) {
    e.preventDefault();
    const question = advisorQuestion.trim();
    if (!question) return;
    if (!liveData || !systemStatus?.openai) {
      setAdvisorAnswer("Советчик полностью подключён к интерфейсу, но ждёт Supabase/OpenAI credentials.");
      return;
    }
    setAdvisorBusy(true);
    setAdvisorAnswer("");
    try {
      const response = await askAdvisor(question);
      setAdvisorAnswer(response);
    } catch (error) {
      console.error(error);
      setAdvisorAnswer("Не получилось получить ответ Советчика.");
    } finally {
      setAdvisorBusy(false);
    }
  }

  const pendingPersonal = tasks.filter((item) => !item.done && item.area === "Личное").length;
  const pendingWork = tasks.filter((item) => !item.done && item.area === "Работа").length;
  const expenseTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const item of expenses) totals[item.currency] = (totals[item.currency] || 0) + item.amount;
    return totals;
  }, [expenses]);
  const financeTotalText = Object.entries(expenseTotals).map(([currency, amount]) => formatMoney(amount, currency)).join(" · ") || "0";
  const todayOverview = [
    { label: "Личных дел", value: pendingPersonal, tone: "pink" },
    { label: "По работе", value: pendingWork, tone: "blue" },
    { label: "Событий", value: events.length, tone: "green" },
    { label: "Расходов", value: financeTotalText, tone: "yellow" },
  ];

  const connectionText =
    authState === "setup" ? "РЕЖИМ НАСТРОЙКИ · данные на экране демонстрационные и не сохраняются"
    : authState === "signed_out" ? "SUPABASE ПОДКЛЮЧЁН · войди, чтобы открыть личные данные"
    : authState === "signed_in" && !systemStatus?.openai ? "БАЗА ПОДКЛЮЧЕНА · AI ждёт OPENAI_API_KEY"
    : authState === "signed_in" ? "ЛИЧНОЕ ПРОСТРАНСТВО ПОДКЛЮЧЕНО"
    : "ПРОВЕРЯЮ ПОДКЛЮЧЕНИЕ…";

  return <main className="appShell">
    <aside className="sidebar">
      <div className="brandRow"><div className="brandAvatar"><AssistantAvatar className="brandAvatarImage" /></div><div><strong>Глаша</strong><span>мой личный помощник</span></div></div>
      <nav className="navList">{sections.map((item) =>
        <button key={item.id} className={active === item.id ? "navItem active" : "navItem"} onClick={() => setActive(item.id)}>
          <span className="navIcon">{item.icon}</span><span><b>{item.label}</b><small>{item.subtitle}</small></span>
        </button>)}</nav>
      <div className="privacyNote">🔒 Личное пространство<br/><span>{connectionText}</span></div>
    </aside>

    <section className="workspace">
      <div className={authState === "signed_in" && systemStatus?.openai ? "connectionBanner live" : "connectionBanner"}>
        <span>{connectionText}</span>
        {authState === "signed_in" && <button onClick={signOut}>Выйти</button>}
      </div>

      {authState === "signed_out" && <section className="authPanel">
        <div><p className="eyebrow">Вход в личное пространство</p><h2>Твои данные — только после входа</h2><p>Введи email. Supabase пришлёт безопасную ссылку для входа без пароля.</p></div>
        <form onSubmit={signIn}><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required/><button className="primaryButton">Получить ссылку</button></form>
        {authMessage && <p className="muted">{authMessage}</p>}
      </section>}

      <header className="topbar"><div><p className="eyebrow">Твоя Глаша</p><h1>{active === "home" ? "Привет! Что держим под контролем?" : current.label}</h1></div>
        <div className="topActions"><button className="ghostButton" onClick={() => setActive("quick")}>⌘ Быстрый доступ</button><div className="miniAvatar"><AssistantAvatar /></div></div>
      </header>

      {active === "home" ? <>
        <section className="heroCard"><div className="heroCopy"><Chip>{liveData ? "Живой режим" : "Preview"}</Chip><h2>Выгружай всё из головы.<br/><span>Я разложу по местам.</span></h2><p>{answer}</p>
          <form className="commandBar" onSubmit={submitCommand}>
            <button type="button" className={listening ? "micButton listening" : "micButton"} onClick={startVoice} disabled={busy}>{listening ? "■" : "🎙"}</button>
            <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="Например: потратила 70 рублей на кофе…" disabled={busy}/>
            <button className="sendButton" disabled={busy}>{busy ? "Думаю…" : "Отправить"}</button>
          </form>
          <div className="promptHints">
            <button onClick={() => setCommand("Потратила 70 рублей на кофе")}>+ расход</button>
            <button onClick={() => setCommand("Завтра по работе позвонить бухгалтеру")}>+ работа</button>
            <button onClick={() => setCommand("Сегодня начались месячные")}>+ здоровье</button>
            <button onClick={() => setCommand("Какие у меня задачи на завтра?")}>+ спросить</button>
          </div>
          {lastResult && <ResultPreview result={lastResult}/>}
        </div><div className="heroGlasha"><GlashaCharacter image="home" priority className="heroCharacter" alt="Глаша рядом" /><span className="speechBubble">Я рядом ♡</span></div></section>

        <div className="overviewGrid">{todayOverview.map((x) => <article key={x.label} className={`statCard ${x.tone}`}><span>{x.label}</span><strong>{x.value}</strong></article>)}</div>

        <div className="twoColumns"><section className="panel"><div className="panelHeader"><div><p className="eyebrow">Сейчас</p><h3>Что требует внимания</h3></div><button className="linkButton" onClick={() => setActive("tasks")}>Все дела →</button></div>
          <div className="taskList">{tasks.filter(t => !t.done).slice(0, 5).map(t => <div key={t.id} className="taskRow taskRowStatic"><button className="checkButton" onClick={() => toggleTask(t.id)}><span className="checkCircle"/></button><span className="taskText"><b>{t.title}</b><small>{t.area}{t.dueDate ? ` · ${t.dueDate}` : ""}{t.time ? ` · ${t.time}` : ""}</small></span></div>)}</div></section>
          <section className="panel softPanel"><div className="panelHeader"><div><p className="eyebrow">Глаша заметила</p><h3>Не потерять</h3></div></div>
            <div className="insight"><span className="insightIcon">✦</span><div><b>{notes.length ? `${notes.length} мыслей ждут разбора` : "Входящие мысли пусты"}</b><p>{notes.length ? "Их можно превратить в задачи, цели или просто оставить как мысли." : "Говори всё, что приходит в голову — я сохраню."}</p></div></div>
            <div className="insight"><span className="insightIcon">☆</span><div><b>{goals.length ? `${goals.length} активных целей и мечт` : "Добавь первую мечту"}</b><p>Советчик сможет разложить цель на конкретные шаги.</p></div></div>
          </section></div>
      </> : <SectionContent
        active={active}
        currentImage={current.image}
        tasks={tasks}
        events={events}
        expenses={expenses}
        notes={notes}
        goals={goals}
        healthEvents={healthEvents}
        categories={categories}
        liveData={liveData}
        totalText={financeTotalText}
        advisorQuestion={advisorQuestion}
        advisorAnswer={advisorAnswer}
        advisorBusy={advisorBusy}
        onAdvisorQuestion={setAdvisorQuestion}
        onSubmitAdvisor={submitAdvisor}
        onToggleTask={toggleTask}
        onAddTask={addTask}
        onAddExpense={addExpense}
        onAddGoal={addGoal}
        onAttachTask={attachToTask}
        onCommand={processCommand}
      />}
    </section>

    <nav className="mobileNav">{sections.slice(0,4).map((item) => <button key={item.id} className={active === item.id ? "active" : ""} onClick={() => setActive(item.id)}><span>{item.icon}</span><small>{item.label}</small></button>)}<button onClick={() => setActive("quick")}><span>•••</span><small>Ещё</small></button></nav>
  </main>;
}

function ResultPreview({ result }: { result: AssistantResponse }) {
  const rows = Array.isArray(result.data) ? result.data as Array<Record<string, unknown>> : [];
  return <div className="resultPreview">
    <b>{result.reply || "Готово"}</b>
    {rows.slice(0, 6).map((row, index) => <div className="resultRow" key={String(row.id || index)}>
      <span>{String(row.title || row.merchant || row.category || "Запись")}</span>
      <small>{row.due_date ? String(row.due_date) : row.occurred_at ? formatDateTime(String(row.occurred_at)) : ""}</small>
    </div>)}
  </div>;
}

function SectionContent({
  active, currentImage, tasks, events, expenses, notes, goals, healthEvents, categories, liveData, totalText,
  advisorQuestion, advisorAnswer, advisorBusy, onAdvisorQuestion, onSubmitAdvisor,
  onToggleTask, onAddTask, onAddExpense, onAddGoal, onAttachTask, onCommand,
}: {
  active: SectionId;
  currentImage: GlashaImage;
  tasks: Task[];
  events: EventItem[];
  expenses: Expense[];
  notes: Note[];
  goals: Goal[];
  healthEvents: HealthEvent[];
  categories: ExpenseCategory[];
  liveData: boolean;
  totalText: string;
  advisorQuestion: string;
  advisorAnswer: string;
  advisorBusy: boolean;
  onAdvisorQuestion: (value: string) => void;
  onSubmitAdvisor: (e: FormEvent) => void;
  onToggleTask: (id: string) => void;
  onAddTask: (area?: Task["area"]) => void;
  onAddExpense: () => void;
  onAddGoal: () => void;
  onAttachTask: (id: string) => void;
  onCommand: (text: string, source?: "text" | "voice") => void;
}) {
  const latestCycle = healthEvents.find((item) => item.kind === "cycle_start");
  const categoryTotals = useMemo(() => {
    const totals: Record<string, Record<string, number>> = {};
    for (const expense of expenses) {
      totals[expense.category] ||= {};
      totals[expense.category][expense.currency] = (totals[expense.category][expense.currency] || 0) + expense.amount;
    }
    return totals;
  }, [expenses]);

  return <div className="sectionLayout">
    <section className="sectionLead"><div><Chip>{sections.find(s=>s.id===active)?.label}</Chip><h2>{headline(active)}</h2><p>{description(active)}</p></div><div className="sectionGlasha"><GlashaCharacter image={currentImage} className="sectionCharacter" alt={`Глаша — ${sections.find(s=>s.id===active)?.label ?? "раздел"}`} /></div></section>

    {(active === "tasks" || active === "work") && <section className="panel">
      <div className="panelHeader"><div><p className="eyebrow">{active === "work" ? "Работа" : "Личное + работа"}</p><h3>{active === "work" ? "Текущие задачи" : "Все дела"}</h3></div><button className="primaryButton" onClick={() => onAddTask(active === "work" ? "Работа" : "Личное")}>+ Добавить</button></div>
      <div className="taskList">{tasks.filter(t => active === "tasks" || t.area === "Работа").map(t =>
        <div key={t.id} className={`taskRow taskRowStatic ${t.done ? "done" : ""}`}>
          <button className="checkButton" onClick={() => onToggleTask(t.id)}><span className="checkCircle">{t.done ? "✓" : ""}</span></button>
          <span className="taskText"><b>{t.title}</b><small>{t.area}{t.dueDate ? ` · ${t.dueDate}` : ""}{t.time ? ` · ${t.time}` : ""}</small></span>
          <button className="attachButton" onClick={() => onAttachTask(t.id)} title="Прикрепить документ">📎</button>
        </div>)}</div>
      {!liveData && <p className="demoNote">Демо-данные. После входа здесь будут реальные задачи и вложения.</p>}
    </section>}

    {active === "calendar" && <div className="twoColumns"><section className="panel">
      <h3>Ближайшие события</h3>
      <p className="muted">Скажи: «день рождения Иры 12 октября» или «врач завтра в 15:00» — событие попадёт сюда.</p>
      {events.length ? events.map(e => <div className="eventRow" key={e.id}><span className="eventDot"/><div><b>{e.title}</b><small>{e.when} · {e.area}</small></div></div>) : <p className="muted">Событий пока нет.</p>}
    </section><section className="panel"><h3>Напоминания голосом</h3><div className="promptStack">
      <button onClick={() => onCommand("Напомни завтра в 10 позвонить врачу")}>Завтра в 10 — врачу</button>
      <button onClick={() => onCommand("День рождения Иры 12 октября")}>Добавить день рождения</button>
      <button onClick={() => onCommand("Какие у меня задачи на завтра?")}>Что у меня завтра?</button>
    </div></section></div>}

    {active === "finance" && <>
      <div className="overviewGrid">
        <article className="statCard blue"><span>Все расходы</span><strong>{totalText}</strong></article>
        <article className="statCard green"><span>Категорий</span><strong>{Object.keys(categoryTotals).length}</strong></article>
        <article className="statCard pink"><span>Записей</span><strong>{expenses.length}</strong></article>
        <article className="statCard yellow"><span>Справочник</span><strong>{categories.length || 13}</strong></article>
      </div>
      <div className="twoColumns"><section className="panel"><div className="panelHeader"><h3>По категориям</h3><button className="primaryButton" onClick={onAddExpense}>+ Расход вручную</button></div>
        {Object.entries(categoryTotals).map(([category, totals]) => <div className="moneyRow" key={category}><div><b>{category}</b><small>Категория</small></div><strong>{Object.entries(totals).map(([currency, amount]) => formatMoney(amount, currency)).join(" · ")}</strong></div>)}
      </section><section className="panel"><h3>Последние расходы</h3>{expenses.slice(0, 15).map(x => <div className="moneyRow" key={x.id}><div><b>{x.title}</b><small>{x.category}{x.occurredAt ? ` · ${formatDateTime(x.occurredAt)}` : ""}</small></div><strong>-{formatMoney(x.amount, x.currency)}</strong></div>)}</section></div>
    </>}

    {active === "health" && <div className="cardGrid">
      <InfoCard icon="◌" title="Цикл" text={latestCycle ? `Последнее начало: ${formatDateTime(latestCycle.occurredAt)}` : "Скажи Глаше о начале цикла"} />
      <InfoCard icon="☻" title="Самочувствие" text={`Записей: ${healthEvents.filter(x => x.kind === "symptom" || x.kind === "note").length}`} />
      <InfoCard icon="✚" title="Лекарства" text={`Записей: ${healthEvents.filter(x => x.kind === "medication").length}`} />
      <InfoCard icon="⌁" title="Врачи" text={`Записей: ${healthEvents.filter(x => x.kind === "appointment").length}`} />
      <button className="infoCard actionCard" onClick={() => onCommand("Сегодня начались месячные")}><span className="infoIcon">＋</span><div><h3>Отметить цикл</h3><p>Записать сегодняшнее начало</p></div><span className="arrow">›</span></button>
    </div>}

    {active === "goals" && <section className="panel">
      <div className="panelHeader"><div><p className="eyebrow">Мечты и цели</p><h3>То, к чему ты идёшь</h3></div><button className="primaryButton" onClick={onAddGoal}>+ Добавить</button></div>
      {goals.length ? goals.map(goal => <div className="goalRow" key={goal.id}><span className="goalIcon">{goal.kind === "Мечта" ? "☆" : "◎"}</span><div><b>{goal.title}</b><small>{goal.kind}{goal.targetDate ? ` · до ${goal.targetDate}` : ""}</small>{goal.description && <p>{goal.description}</p>}</div></div>) : <p className="muted">Пока пусто. Можно сказать: «моя цель — сдать немецкий B1 до июня».</p>}
    </section>}

    {active === "learning" && <div className="twoColumns"><section className="panel"><p className="eyebrow">Обучение</p><h3>Привязываем к целям</h3><p className="muted">Курсы и обучение можно учитывать как расходы, задачи и шаги к цели.</p><button className="primaryButton" onClick={() => onCommand("Моя цель — выучить немецкий до уровня B1")}>Добавить цель B1</button></section><section className="panel"><h3>Быстрые команды</h3><div className="promptStack"><button onClick={() => onCommand("Потратила 5000 рублей на курс немецкого")}>Записать оплату курса</button><button onClick={() => onCommand("Завтра заниматься немецким 30 минут")}>Добавить занятие</button></div></section></div>}

    {active === "travel" && <div className="cardGrid"><InfoCard icon="✈" title="Билеты" text="Поиск и покупка будут подключаться отдельным travel-инструментом"/><InfoCard icon="▣" title="Брони" text="Бронирования и подтверждения будут связаны с календарём"/><InfoCard icon="◫" title="Даты" text={`Поездок в календаре: ${events.filter(e => e.kind === "trip").length}`}/><InfoCard icon="▤" title="Документы" text="Паспорт, страховка, визы и файлы"/></div>}

    {active === "documents" && <section className="panel"><h3>Документы и вложения</h3><p className="muted">Вложения к рабочим задачам уже подключены к приватному storage endpoint. Нажми 📎 у любой рабочей задачи.</p><div className="documentHint">PDF · DOCX · XLSX · JPG · PNG · до 50 МБ</div></section>}

    {active === "quick" && <div className="quickGrid"><InstallGlashaTile />{[["🏦","Банк"],["▣","Госуслуги"],["✉","Почта"],["◫","Календарь"],["✈","Билеты"],["⌖","Карты"],["文","Переводчик"],["A1","Тренажёр"],["💬","Telegram"],["☁","Диск"]].map(([i,n]) => <button className="quickTile" key={n}><span>{i}</span><b>{n}</b></button>)}</div>}

    {active === "advisor" && <div className="twoColumns"><section className="panel"><h3>Спроси Советчика</h3><p className="muted">Он получит твои актуальные задачи, цели и ближайшие события и поможет разложить ситуацию на шаги.</p><form className="advisorForm" onSubmit={onSubmitAdvisor}><textarea value={advisorQuestion} onChange={(e) => onAdvisorQuestion(e.target.value)} placeholder="Например: моя цель — переехать. Что мне сделать в ближайшие две недели?"/><button className="primaryButton" disabled={advisorBusy}>{advisorBusy ? "Думаю…" : "Спросить"}</button></form></section><section className="panel advisorAnswer"><h3>Ответ</h3><p>{advisorAnswer || "Здесь появится ответ Советчика."}</p></section></div>}

    {active === "chat" && <div className="twoColumns"><section className="panel"><h3>Выгрузить всё из головы</h3><p className="muted">Пиши или говори обычным языком. AI-router разделит расходы, дела, здоровье, цели и календарь. То, что не требует действия, останется во входящих мыслях.</p><div className="promptStack"><button onClick={() => onCommand("Я переживаю, что ничего не успеваю, надо разобраться с документами и ещё купить билет")}>Пример выгрузки мыслей</button></div></section><section className="panel"><h3>Входящие мысли</h3>{notes.length ? notes.map(n => <div className="noteRow" key={n.id}><b>{n.text}</b><small>{formatDateTime(n.createdAt)}</small></div>) : <p className="muted">Неразобранных мыслей сейчас нет.</p>}</section></div>}
  </div>;
}

function headline(id: SectionId) {
  return ({
    tasks: "Ничего не держим в голове",
    work: "Помню, где мы остановились",
    calendar: "Все даты в одном месте",
    finance: "Деньги без тумана",
    health: "Забота о себе тоже дело",
    goals: "Мечты превращаем в шаги",
    learning: "Учиться — без хаоса",
    travel: "Поездки без потери деталей",
    documents: "Важное — под рукой",
    quick: "Открыть нужное за секунду",
    advisor: "Спроси — разберёмся",
    chat: "Можно сказать всё как есть",
    home: "",
  })[id];
}

function description(id: SectionId) {
  return ({
    tasks: "Личные и рабочие дела можно смотреть вместе или отдельно.",
    work: "Задачи, дедлайны и документы к ним — в одном рабочем контексте.",
    calendar: "Напоминания, встречи, дни рождения, здоровье и поездки.",
    finance: "Говори сумму и назначение — Глаша распределит расход по категории.",
    health: "Самочувствие, цикл, врачи, лекарства и заметки.",
    goals: "Мечта может остаться мечтой или превратиться в цель с датой и шагами.",
    learning: "Обучение связывается с целями, задачами и расходами.",
    travel: "Билеты и брони станут отдельным подключаемым инструментом.",
    documents: "Файлы можно связывать с конкретными задачами и событиями.",
    quick: "Банк, Госуслуги, почта и другие сервисы подключаются отдельными ссылками и интеграциями.",
    advisor: "OpenAI-советчик использует твои реальные задачи, цели и календарь.",
    chat: "Разговор и поток мыслей тоже превращаются в структуру.",
    home: "",
  })[id];
}
