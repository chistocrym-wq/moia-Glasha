"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { AssistantAvatar, GlashaCharacter, type GlashaImage } from "@/components/GlashaCharacter";
import { InstallGlashaTile } from "@/components/PwaClient";

type SectionId =
  | "home" | "tasks" | "work" | "calendar" | "finance" | "health"
  | "learning" | "travel" | "documents" | "quick" | "advisor" | "chat";

type Task = { id: string; title: string; area: "Личное" | "Работа"; done: boolean; time?: string };
type Expense = { id: string; title: string; amount: number; area: "Личные" | "Рабочие" };
type EventItem = { id: string; title: string; when: string; area: string };
type Note = { id: string; text: string; createdAt: string };

type SpeechRecognitionEventLike = { results: { [key: number]: { [key: number]: { transcript: string } } } };
type RecognitionLike = {
  lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null; onend: (() => void) | null; onerror: (() => void) | null;
};
type SpeechRecognitionCtor = new () => RecognitionLike;
type WindowWithSpeech = Window & { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };

const sections: Array<{ id: SectionId; label: string; icon: string; subtitle: string; image: GlashaImage }> = [
  { id: "home", label: "Главная", icon: "⌂", subtitle: "Всё важное сейчас", image: "home" },
  { id: "tasks", label: "Мои дела", icon: "✓", subtitle: "Личное и бытовое", image: "home" },
  { id: "work", label: "Работа", icon: "▣", subtitle: "Проекты и задачи", image: "work" },
  { id: "calendar", label: "Календарь", icon: "◫", subtitle: "События и напоминания", image: "travel" },
  { id: "finance", label: "Финансы", icon: "₽", subtitle: "Личные и рабочие", image: "documents" },
  { id: "health", label: "Здоровье", icon: "♡", subtitle: "Самочувствие и цикл", image: "health" },
  { id: "learning", label: "Обучение", icon: "◉", subtitle: "Языки и развитие", image: "learning" },
  { id: "travel", label: "Поездки", icon: "✈", subtitle: "Билеты и планы", image: "travel" },
  { id: "documents", label: "Документы", icon: "▤", subtitle: "Всё под рукой", image: "documents" },
  { id: "quick", label: "Быстрый доступ", icon: "⌘", subtitle: "Ссылки и приложения", image: "quick" },
  { id: "advisor", label: "Советчик", icon: "?", subtitle: "Найти и разобраться", image: "ideas" },
  { id: "chat", label: "Поговорить", icon: "✦", subtitle: "Выгрузить мысли", image: "cat" },
];

const initialTasks: Task[] = [
  { id: "t1", title: "Оплатить интернет", area: "Личное", done: false, time: "12:00" },
  { id: "t2", title: "Позвонить маме", area: "Личное", done: false, time: "19:00" },
  { id: "t3", title: "Подготовить презентацию", area: "Работа", done: false, time: "15:00" },
];
const initialEvents: EventItem[] = [
  { id: "e1", title: "Встреча с клиентом", when: "Сегодня · 10:00", area: "Работа" },
  { id: "e2", title: "Записаться к врачу", when: "Сегодня · 14:30", area: "Здоровье" },
  { id: "e3", title: "Тренировка", when: "Сегодня · 18:00", area: "Здоровье" },
];
const initialExpenses: Expense[] = [
  { id: "x1", title: "Продукты", amount: 48.2, area: "Личные" },
  { id: "x2", title: "Аптека", amount: 32.5, area: "Личные" },
  { id: "x3", title: "Подписка сервиса", amount: 19, area: "Рабочие" },
];

function useStoredState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const raw = window.localStorage.getItem(key);
    if (raw) {
      try { setValue(JSON.parse(raw) as T); } catch {}
    }
    setHydrated(true);
  }, [key]);

  useEffect(() => {
    if (hydrated) window.localStorage.setItem(key, JSON.stringify(value));
  }, [hydrated, key, value]);

  return [value, setValue] as const;
}

function Chip({ children }: { children: React.ReactNode }) { return <span className="chip">{children}</span>; }
function InfoCard({ icon, title, text }: { icon: string; title: string; text: string }) {
  return <article className="infoCard"><span className="infoIcon">{icon}</span><div><h3>{title}</h3><p>{text}</p></div><span className="arrow">›</span></article>;
}

export default function Home() {
  const [active, setActive] = useState<SectionId>("home");
  const [tasks, setTasks] = useStoredState<Task[]>("glasha.tasks", initialTasks);
  const [events, setEvents] = useStoredState<EventItem[]>("glasha.events", initialEvents);
  const [expenses, setExpenses] = useStoredState<Expense[]>("glasha.expenses", initialExpenses);
  const [notes, setNotes] = useStoredState<Note[]>("glasha.notes", []);
  const [command, setCommand] = useState("");
  const [listening, setListening] = useState(false);
  const [answer, setAnswer] = useState("Я рядом. Скажи или напиши, что нужно запомнить.");

  const current = sections.find((item) => item.id === active) ?? sections[0];
  const pendingPersonal = tasks.filter((item) => !item.done && item.area === "Личное").length;
  const pendingWork = tasks.filter((item) => !item.done && item.area === "Работа").length;
  const totalExpenses = expenses.reduce((sum, item) => sum + item.amount, 0);
  const todayOverview = useMemo(() => [
    { label: "Личных дел", value: pendingPersonal, tone: "pink" },
    { label: "По работе", value: pendingWork, tone: "blue" },
    { label: "Событий", value: events.length, tone: "green" },
    { label: "Расходов", value: `${totalExpenses.toFixed(0)} €`, tone: "yellow" },
  ], [pendingPersonal, pendingWork, events.length, totalExpenses]);

  function toggleTask(id: string) { setTasks((p) => p.map((t) => t.id === id ? { ...t, done: !t.done } : t)); }
  function addTask(area: Task["area"] = "Личное") {
    const title = window.prompt(area === "Работа" ? "Новая рабочая задача" : "Новое личное дело");
    if (title?.trim()) setTasks((p) => [...p, { id: crypto.randomUUID(), title: title.trim(), area, done: false }]);
  }
  function addExpense(area: Expense["area"] = "Личные") {
    const title = window.prompt("На что потратили?"); if (!title?.trim()) return;
    const amount = Number((window.prompt("Сумма") ?? "").replace(",", "."));
    if (Number.isFinite(amount) && amount > 0) setExpenses((p) => [...p, { id: crypto.randomUUID(), title: title.trim(), amount, area }]);
  }
  function processCommand(raw: string) {
    const text = raw.trim(); if (!text) return; const lower = text.toLowerCase();
    if (/потрат|заплат|купил|купила/.test(lower)) {
      const m = text.match(/(\d+[.,]?\d*)/); const amount = m ? Number(m[1].replace(",", ".")) : 0;
      setExpenses((p) => [...p, { id: crypto.randomUUID(), title: text, amount, area: /работ|фирм|клиент/.test(lower) ? "Рабочие" : "Личные" }]);
      setAnswer(`Записала расход${amount ? ` на ${amount} €` : ""}.`); return;
    }
    if (/билет|поезд|самол|отел|гостин/.test(lower)) {
      setEvents((p) => [...p, { id: crypto.randomUUID(), title: text, when: "Нужно уточнить дату", area: "Поездка" }]);
      setAnswer("Сохранила в поездки. Когда появится дата, привяжем к календарю."); return;
    }
    if (/врач|анализ|лекар|цикл|месяч|здоров/.test(lower)) {
      setEvents((p) => [...p, { id: crypto.randomUUID(), title: text, when: "Нужно уточнить время", area: "Здоровье" }]);
      setAnswer("Записала в здоровье и календарь."); return;
    }
    if (/напом|надо|сделать|позвон|отправ|провер/.test(lower)) {
      const area: Task["area"] = /работ|клиент|договор|отч[её]т|проект/.test(lower) ? "Работа" : "Личное";
      setTasks((p) => [...p, { id: crypto.randomUUID(), title: text, area, done: false }]);
      setAnswer(`Записала в ${area === "Работа" ? "рабочие" : "личные"} дела.`); return;
    }
    setNotes((p) => [...p, { id: crypto.randomUUID(), text, createdAt: new Date().toISOString() }]);
    setAnswer("Сохранила во входящие мысли. Разберём позже.");
  }
  function submitCommand(e: FormEvent) { e.preventDefault(); processCommand(command); setCommand(""); }
  function startVoice() {
    const sw = window as WindowWithSpeech; const Ctor = sw.SpeechRecognition ?? sw.webkitSpeechRecognition;
    if (!Ctor) { setAnswer("Голосовой ввод здесь недоступен. Напиши команду текстом."); return; }
    const r = new Ctor(); r.lang = "ru-RU"; r.interimResults = false; r.continuous = false; setListening(true);
    r.onresult = (e) => { const t = e.results[0][0].transcript; setCommand(t); processCommand(t); };
    r.onend = () => setListening(false); r.onerror = () => { setListening(false); setAnswer("Не расслышала. Попробуй ещё раз."); }; r.start();
  }

  return <main className="appShell">
    <aside className="sidebar">
      <div className="brandRow"><div className="brandAvatar"><AssistantAvatar className="brandAvatarImage" /></div><div><strong>Глаша</strong><span>мой личный помощник</span></div></div>
      <nav className="navList">{sections.map((item) =>
        <button key={item.id} className={active === item.id ? "navItem active" : "navItem"} onClick={() => setActive(item.id)}>
          <span className="navIcon">{item.icon}</span><span><b>{item.label}</b><small>{item.subtitle}</small></span>
        </button>)}</nav>
      <div className="privacyNote">🔒 Личное пространство<br/><span>Данные прототипа хранятся в твоём браузере.</span></div>
    </aside>

    <section className="workspace">
      <header className="topbar"><div><p className="eyebrow">Твоя Глаша</p><h1>{active === "home" ? "Привет! Что держим под контролем?" : current.label}</h1></div>
        <div className="topActions"><button className="ghostButton" onClick={() => setActive("quick")}>⌘ Быстрый доступ</button><div className="miniAvatar"><AssistantAvatar /></div></div>
      </header>

      {active === "home" ? <>
        <section className="heroCard"><div className="heroCopy"><Chip>Сегодня</Chip><h2>Выгружай всё из головы.<br/><span>Я разложу по местам.</span></h2><p>{answer}</p>
          <form className="commandBar" onSubmit={submitCommand}><button type="button" className={listening ? "micButton listening" : "micButton"} onClick={startVoice}>🎙</button>
            <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="Например: в понедельник оплатить страховку…" /><button className="sendButton">Запомнить</button></form>
          <div className="promptHints"><button onClick={() => setCommand("Потратила 45 евро на продукты")}>+ расход</button><button onClick={() => setCommand("Напомни завтра позвонить врачу")}>+ напоминание</button><button onClick={() => setCommand("По работе проверить договор")}>+ работа</button></div>
        </div><div className="heroGlasha"><GlashaCharacter image="home" priority className="heroCharacter" alt="Глаша рядом" /><span className="speechBubble">Я рядом ♡</span></div></section>

        <div className="overviewGrid">{todayOverview.map((x) => <article key={x.label} className={`statCard ${x.tone}`}><span>{x.label}</span><strong>{x.value}</strong></article>)}</div>

        <div className="twoColumns"><section className="panel"><div className="panelHeader"><div><p className="eyebrow">Сегодня</p><h3>Что требует внимания</h3></div><button className="linkButton" onClick={() => setActive("tasks")}>Все дела →</button></div>
          <div className="taskList">{tasks.filter(t => !t.done).slice(0, 5).map(t => <button key={t.id} className="taskRow" onClick={() => toggleTask(t.id)}><span className="checkCircle"/><span className="taskText"><b>{t.title}</b><small>{t.area}{t.time ? ` · ${t.time}` : ""}</small></span><span>›</span></button>)}</div></section>
          <section className="panel softPanel"><div className="panelHeader"><div><p className="eyebrow">Глаша заметила</p><h3>Не потерять</h3></div></div>
            <div className="insight"><span className="insightIcon">✦</span><div><b>{notes.length ? `${notes.length} мыслей ждут разбора` : "Входящие мысли пусты"}</b><p>{notes.length ? "Можно разобрать их по делам, планам и идеям." : "Говори всё, что приходит в голову — я сохраню."}</p></div></div>
            <div className="insight"><span className="insightIcon">♡</span><div><b>Время для себя</b><p>На вечер можно оставить окно без рабочих задач.</p></div></div>
          </section></div>
      </> : <SectionContent active={active} currentImage={current.image} tasks={tasks} events={events} expenses={expenses} notes={notes} totalExpenses={totalExpenses}
        onToggleTask={toggleTask} onAddTask={addTask} onAddExpense={addExpense} onCommand={processCommand} />}
    </section>

    <nav className="mobileNav">{sections.slice(0,4).map((item) => <button key={item.id} className={active === item.id ? "active" : ""} onClick={() => setActive(item.id)}><span>{item.icon}</span><small>{item.label}</small></button>)}<button onClick={() => setActive("quick")}><span>•••</span><small>Ещё</small></button></nav>
  </main>;
}

function SectionContent({ active, currentImage, tasks, events, expenses, notes, totalExpenses, onToggleTask, onAddTask, onAddExpense, onCommand }:{\n  active: SectionId; currentImage:GlashaImage; tasks:Task[]; events:EventItem[]; expenses:Expense[]; notes:Note[]; totalExpenses:number;
  onToggleTask:(id:string)=>void; onAddTask:(a?:Task["area"])=>void; onAddExpense:(a?:Expense["area"])=>void; onCommand:(t:string)=>void;
}) {
  return <div className="sectionLayout">
    <section className="sectionLead"><div><Chip>{sections.find(s=>s.id===active)?.label}</Chip><h2>{headline(active)}</h2><p>{description(active)}</p></div><div className="sectionGlasha"><GlashaCharacter image={currentImage} className="sectionCharacter" alt={`Глаша — ${sections.find(s=>s.id===active)?.label ?? "раздел"}`} /></div></section>

    {(active==="tasks"||active==="work") && <section className="panel"><div className="panelHeader"><div><p className="eyebrow">{active==="work"?"Работа":"Личное + работа"}</p><h3>{active==="work"?"Текущие задачи":"Все дела"}</h3></div><button className="primaryButton" onClick={()=>onAddTask(active==="work"?"Работа":"Личное")}>+ Добавить</button></div>
      <div className="taskList">{tasks.filter(t=>active==="tasks"||t.area==="Работа").map(t=><button key={t.id} className={`taskRow ${t.done?"done":""}`} onClick={()=>onToggleTask(t.id)}><span className="checkCircle">{t.done?"✓":""}</span><span className="taskText"><b>{t.title}</b><small>{t.area}{t.time?` · ${t.time}`:""}</small></span><span>›</span></button>)}</div></section>}

    {active==="calendar" && <div className="twoColumns"><section className="panel"><div className="calendarTop"><button>‹</button><strong>Сентябрь 2026</strong><button>›</button></div><div className="weekRow">{["Пн","Вт","Ср","Чт","Пт","Сб","Вс"].map(d=><span key={d}>{d}</span>)}</div><div className="daysGrid">{Array.from({length:35},(_,i)=><button key={i} className={i===21?"selectedDay":""}>{i<1?"":i}</button>)}</div></section><section className="panel"><h3>Ближайшее</h3>{events.map(e=><div className="eventRow" key={e.id}><span className="eventDot"/><div><b>{e.title}</b><small>{e.when} · {e.area}</small></div></div>)}</section></div>}

    {active==="finance" && <><div className="overviewGrid"><article className="statCard blue"><span>Расходы</span><strong>{totalExpenses.toFixed(0)} €</strong></article><article className="statCard green"><span>Личные</span><strong>{expenses.filter(x=>x.area==="Личные").reduce((s,x)=>s+x.amount,0).toFixed(0)} €</strong></article><article className="statCard pink"><span>Рабочие</span><strong>{expenses.filter(x=>x.area==="Рабочие").reduce((s,x)=>s+x.amount,0).toFixed(0)} €</strong></article><article className="statCard yellow"><span>Записей</span><strong>{expenses.length}</strong></article></div><section className="panel"><div className="panelHeader"><h3>Последние операции</h3><button className="primaryButton" onClick={()=>onAddExpense("Личные")}>+ Расход</button></div>{expenses.slice().reverse().map(x=><div className="moneyRow" key={x.id}><div><b>{x.title}</b><small>{x.area}</small></div><strong>-{x.amount.toFixed(2)} €</strong></div>)}</section></>}

    {active==="health" && <div className="cardGrid"><InfoCard icon="☻" title="Самочувствие" text="Сегодня ты в порядке"/><InfoCard icon="◌" title="Цикл" text="День 14 из 28"/><InfoCard icon="✚" title="Лекарства" text="3 активных напоминания"/><InfoCard icon="⌁" title="Врачи" text="2 ближайшие записи"/><InfoCard icon="◒" title="Сон" text="Добавить данные"/><InfoCard icon="↗" title="Показатели" text="Вес, давление, активность"/></div>}

    {active==="learning" && <div className="twoColumns"><section className="panel"><p className="eyebrow">Немецкий язык</p><h3>A1 → A2</h3><div className="progressTrack"><span style={{width:"68%"}}/></div><p className="muted">Прогресс 68%</p><div className="simpleRow"><b>Словарь</b><span>15 минут</span></div><div className="simpleRow"><b>Грамматика</b><span>20 минут</span></div><div className="simpleRow"><b>Разговорная практика</b><span>15 минут</span></div><button className="primaryButton full">Продолжить занятие</button></section><section className="panel"><p className="eyebrow">Мои материалы</p><h3>Всё в одном месте</h3><div className="linkCards"><a href="#">↗ Тренажёр языка</a><a href="#">▤ Мои заметки</a><a href="#">◎ Полезные ссылки</a></div></section></div>}

    {active==="travel" && <div className="cardGrid"><InfoCard icon="✈" title="Билеты" text="Добавлять поездки и брони"/><InfoCard icon="▣" title="Отели" text="Хранить подтверждения"/><InfoCard icon="◫" title="Календарь поездок" text="Все даты автоматически"/><InfoCard icon="▤" title="Документы" text="Паспорт, страховка, визы"/></div>}
    {active==="documents" && <section className="panel"><div className="documentList">{[["Паспорт","Срок до 2031"],["ВНЖ","Срок до 2028"],["Медицинские документы","Анализы и заключения"],["Договоры","Рабочие и личные"],["Счета и квитанции","Оплаченные и будущие"]].map(([a,b])=><button className="documentRow" key={a}><span className="docIcon">▤</span><span><b>{a}</b><small>{b}</small></span><span>›</span></button>)}</div></section>}
    {active==="quick" && <div className="quickGrid"><InstallGlashaTile />{[["🏦","Банк"],["▣","Госуслуги"],["✉","Почта"],["◫","Календарь"],["✈","Билеты"],["⌖","Карты"],["文","Переводчик"],["A1","Тренажёр"],["▶","Видео"],["💬","Telegram"],["☁","Диск"],["+","Добавить"]].map(([i,n])=><button className="quickTile" key={n}><span>{i}</span><b>{n}</b></button>)}</div>}
    {active==="advisor" && <section className="panel advisorPanel"><h3>Что нужно найти или решить?</h3><p>Здесь Глаша сможет обращаться к поиску, сравнивать варианты, разбирать документы и помогать с юридическими вопросами.</p><div className="advisorButtons"><button onClick={()=>onCommand("Найди варианты и сравни их")}>Найти информацию</button><button onClick={()=>onCommand("Помоги разобраться с документом")}>Разобрать документ</button><button onClick={()=>onCommand("Сравни варианты и объясни различия")}>Сравнить варианты</button></div><div className="legalNotice">Юридический раздел помогает ориентироваться и готовить вопросы, но не заменяет профессионального юриста.</div></section>}
    {active==="chat" && <div className="twoColumns"><section className="panel"><p className="eyebrow">Разговор</p><h3>Можно просто выговориться</h3><p className="muted">Глаша сохранит важное и поможет разложить ситуацию на факты, решения и следующие шаги.</p><button className="primaryButton" onClick={()=>onCommand("Мне нужно выгрузить мысли и разобраться")}>Начать разговор</button></section><section className="panel"><p className="eyebrow">Входящие мысли</p><h3>{notes.length} сохранено</h3>{notes.length?notes.slice().reverse().slice(0,5).map(n=><div className="noteRow" key={n.id}>{n.text}</div>):<p className="muted">Пока пусто. Скажи любую мысль на главном экране.</p>}</section></div>}
  </div>;
}

function headline(active: SectionId) {
  const m:Record<SectionId,string>={home:"",tasks:"Ничего не держим в голове",work:"Помню, где мы остановились",calendar:"Все даты в одном месте",finance:"Деньги без тумана",health:"Забота о себе тоже дело",learning:"Учиться — без поиска по рабочему столу",travel:"Билеты, брони и планы вместе",documents:"Важное — под рукой",quick:"Открыть нужное за секунду",advisor:"Спроси — разберёмся",chat:"Можно сказать всё как есть"}; return m[active];
}
function description(active: SectionId) {
  const m:Record<SectionId,string>={home:"",tasks:"Личные и рабочие дела можно смотреть вместе или отдельно.",work:"Задачи, проекты, договорённости и последняя актуальная точка по каждому вопросу.",calendar:"Напоминания, встречи, врачи, билеты и дедлайны.",finance:"Говори сумму и назначение — Глаша сохранит расход в нужный дневник.",health:"Самочувствие, цикл, врачи, лекарства и показатели — в одном разделе.",learning:"Курсы, ссылки, тренажёры, заметки и текущий прогресс.",travel:"Купила билет — поездка должна оказаться в календаре без ручного переписывания.",documents:"Документы, сроки действия, договоры, счета и важные файлы.",quick:"Банк, билеты, почта, карты и всё, что часто нужно открыть.",advisor:"Поиск, сравнение вариантов, объяснения и помощь с документами.",chat:"Разговор, мысли, идеи и ситуации — Глаша поможет отделить важное от шума."}; return m[active];
}
