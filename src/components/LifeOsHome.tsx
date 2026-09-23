"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type NowData = {
  next_event: { id: string; title: string; start_at: string; area?: string } | null;
  urgent_or_overdue: Array<{ id: string; title: string; due_date?: string; priority?: string; area?: string }>;
  overdue_count: number;
  top_tasks: Array<{ id: string; title: string; due_date?: string; due_time?: string; priority?: string; area?: string }>;
  upcoming_payment_or_reminder: { id: string; title: string; deliver_at: string } | null;
  health_reminder: { id: string; title: string; deliver_at: string } | null;
};

type NotificationItem = {
  id: string;
  title: string;
  deliver_at: string;
  priority: "normal" | "urgent";
  state: "unread" | "seen" | "snoozed";
  bucket: "urgent" | "today" | "later";
  category?: string;
  linked_entity_type?: string | null;
  linked_entity_id?: string | null;
};

type SearchItem = { entity_type: string; id: string; title: string; subtitle?: string };
type ReviewData = Record<string, unknown> & { kind: "morning" | "evening" | "weekly" };

async function jsonFetch(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(data.error || "request_failed"));
  return data;
}

function when(value?: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

export default function LifeOsHome({
  liveData,
  refreshToken,
  onCommand,
  onOpenSection,
}: {
  liveData: boolean;
  refreshToken?: string;
  onCommand: (text: string, source?: "text" | "voice") => void;
  onOpenSection: (section: "tasks" | "work" | "calendar" | "finance" | "health" | "goals" | "travel" | "documents" | "contacts" | "chat") => void;
}) {
  const [now, setNow] = useState<NowData | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SearchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [review, setReview] = useState<ReviewData | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [status, setStatus] = useState("");

  const [reminderTitle, setReminderTitle] = useState("");
  const [reminderDate, setReminderDate] = useState("");
  const [reminderTime, setReminderTime] = useState("09:00");
  const [recurrence, setRecurrence] = useState<"none" | "daily" | "weekly" | "monthly">("none");
  const [reminderCategory, setReminderCategory] = useState<"general" | "payment" | "health">("general");
  const [reminderPriority, setReminderPriority] = useState<"normal" | "urgent">("normal");
  const [quietEnabled, setQuietEnabled] = useState(false);
  const [quietStart, setQuietStart] = useState("22:00");
  const [quietEnd, setQuietEnd] = useState("08:00");

  async function refresh() {
    if (!liveData) return;
    try {
      const [nowResponse, notificationsResponse, preferencesResponse] = await Promise.all([
        jsonFetch("/api/life/now"),
        jsonFetch("/api/life/notifications"),
        jsonFetch("/api/life/preferences"),
      ]);
      setNow(nowResponse.now);
      setNotifications(notificationsResponse.notifications || []);
      setQuietEnabled(Boolean(preferencesResponse.preferences?.quiet_hours_enabled));
      setQuietStart(String(preferencesResponse.preferences?.quiet_hours_start || "22:00").slice(0,5));
      setQuietEnd(String(preferencesResponse.preferences?.quiet_hours_end || "08:00").slice(0,5));
    } catch (error) {
      console.error("life_os_refresh_failed", error);
      setStatus("Life OS ждёт preview-миграцию 006.");
    }
  }

  useEffect(() => {
    void refresh();
  }, [liveData, refreshToken]);

  async function submitSearch(event: FormEvent) {
    event.preventDefault();
    const q = search.trim();
    if (!q || !liveData) return;
    setSearching(true);
    setStatus("");
    try {
      const data = await jsonFetch(`/api/life/search?q=${encodeURIComponent(q)}`);
      setSearchResults(data.results || []);
      if (!(data.results || []).length) setStatus("Совпадений в личной базе нет.");
    } catch (error) {
      console.error("life_search_ui_failed", error);
      setStatus("Не получилось выполнить поиск.");
    } finally {
      setSearching(false);
    }
  }

  async function createReminder(event: FormEvent) {
    event.preventDefault();
    if (!reminderTitle.trim() || !reminderDate || !reminderTime || !liveData) return;
    setStatus("Сохраняю напоминание…");
    try {
      await jsonFetch("/api/life/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: reminderTitle.trim(),
          local_date: reminderDate,
          local_time: reminderTime,
          recurrence,
          category: reminderCategory,
          priority: reminderPriority,
        }),
      });
      setReminderTitle("");
      setStatus("Напоминание сохранено.");
      await refresh();
    } catch (error) {
      console.error("reminder_ui_failed", error);
      setStatus("Не получилось сохранить напоминание.");
    }
  }

  async function saveQuietHours() {
    if (!liveData) return;
    setStatus("Сохраняю тихие часы…");
    try {
      await jsonFetch("/api/life/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quiet_hours_enabled: quietEnabled,
          quiet_hours_start: quietStart,
          quiet_hours_end: quietEnd,
        }),
      });
      setStatus(quietEnabled ? `Тихие часы: ${quietStart}–${quietEnd}.` : "Тихие часы выключены.");
      await refresh();
    } catch (error) {
      console.error("quiet_hours_ui_failed", error);
      setStatus("Не получилось сохранить тихие часы.");
    }
  }

  async function notificationAction(id: string, action: "seen" | "snooze" | "skip" | "done") {
    try {
      await jsonFetch("/api/life/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, snooze_minutes: 60 }),
      });
      await refresh();
    } catch (error) {
      console.error("notification_action_ui_failed", error);
      setStatus("Не получилось изменить напоминание.");
    }
  }

  function openLinkedEntity(item: NotificationItem) {
    const section = ({
      task: "tasks", project: "tasks", goal: "goals", event: "calendar", health_event: "health",
      expense: "finance", purchase: "finance", document: "documents", contact: "contacts",
      trip: "travel", journal: "chat", memory: "chat",
    } as const)[String(item.linked_entity_type || "") as "task"];
    if (section) onOpenSection(section);
  }

  async function loadReview(kind: "morning" | "evening" | "weekly") {
    if (!liveData) return;
    setReviewBusy(true);
    try {
      const data = await jsonFetch(`/api/life/review?kind=${kind}`);
      setReview(data.review);
    } catch (error) {
      console.error("review_ui_failed", error);
      setStatus("Не получилось собрать обзор.");
    } finally {
      setReviewBusy(false);
    }
  }

  async function inboxAction(id: string) {
    try {
      await jsonFetch("/api/life/inbox", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "processed" }),
      });
      if (review?.kind === "weekly") await loadReview("weekly");
    } catch (error) {
      console.error("weekly_inbox_action_failed", error);
      setStatus("Не получилось разобрать входящее.");
    }
  }

  async function taskAction(id: string, action: "cancel" | "move_tomorrow") {
    try {
      await jsonFetch("/api/life/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      await refresh();
      if (review?.kind) await loadReview(review.kind);
    } catch (error) {
      console.error("review_task_action_failed", error);
      setStatus("Не получилось изменить задачу.");
    }
  }

  const grouped = useMemo(() => ({
    urgent: notifications.filter((item) => item.bucket === "urgent"),
    today: notifications.filter((item) => item.bucket === "today"),
    later: notifications.filter((item) => item.bucket === "later"),
  }), [notifications]);

  const unfinished = review?.kind === "evening"
    ? (review.unfinished as Array<{ id: string; title: string; area?: string; due_date?: string }> || [])
    : [];

  return <div className="lifeOsStack">
    <section className="panel">
      <div className="panelHeader"><div><p className="eyebrow">Сейчас</p><h3>Только то, что требует внимания</h3></div><button className="linkButton" onClick={() => void refresh()} disabled={!liveData}>Обновить</button></div>
      {!now && <p className="muted">{liveData ? "Загружаю…" : "Доступно после входа."}</p>}
      {now && <div className="nowGrid">
        <article><span>Следующее событие</span><b>{now.next_event?.title || "Нет ближайшего"}</b><small>{when(now.next_event?.start_at)}</small></article>
        <article><span>Срочно / просрочено</span><b>{now.urgent_or_overdue[0]?.title || "Ничего срочного"}</b><small>{now.overdue_count ? `Просрочено: ${now.overdue_count}` : "Просрочек нет"}</small></article>
        <article className="nowTasks"><span>Топ-3 действия</span>{now.top_tasks.length ? now.top_tasks.map((task) => <div key={task.id}><b>{task.title}</b><small>{[task.due_date, task.due_time, task.area].filter(Boolean).join(" · ")}</small></div>) : <b>Список свободен</b>}</article>
        <article><span>Платёж / напоминание</span><b>{now.upcoming_payment_or_reminder?.title || "Нет ближайшего"}</b><small>{when(now.upcoming_payment_or_reminder?.deliver_at)}</small></article>
        <article><span>Здоровье</span><b>{now.health_reminder?.title || "Нет напоминаний"}</b><small>{when(now.health_reminder?.deliver_at)}</small></article>
      </div>}
    </section>
    <details className="panel lifeOsTools">
      <summary><span>Поиск, напоминания, уведомления и обзоры</span><small>Открыть инструменты Life OS</small></summary>
      <div className="lifeOsToolsBody">
    <section className="panel lifeSearchPanel">
      <div className="panelHeader"><div><p className="eyebrow">Поиск везде</p><h3>Найти в личной базе</h3></div><span className="zeroAiBadge">0 AI</span></div>
      <form className="lifeSearchForm" onSubmit={submitSearch}>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Задача, цель, событие, документ, контакт, мысль…" disabled={!liveData || searching} />
        <button className="primaryButton" disabled={!liveData || searching}>{searching ? "Ищу…" : "Найти"}</button>
      </form>
      {searchResults.length > 0 && <div className="lifeSearchResults">{searchResults.map((item) =>
        <div className="lifeSearchRow" key={`${item.entity_type}-${item.id}`}><span className="entityType">{item.entity_type}</span><div><b>{item.title}</b>{item.subtitle && <small>{item.subtitle}</small>}</div></div>
      )}</div>}
    </section>
    <div className="twoColumns">
      <section className="panel">
        <div className="panelHeader"><div><p className="eyebrow">Напоминания</p><h3>Один раз или регулярно</h3></div></div>
        <form className="reminderForm" onSubmit={createReminder}>
          <input value={reminderTitle} onChange={(e) => setReminderTitle(e.target.value)} placeholder="Оплатить интернет" disabled={!liveData} />
          <div className="reminderFields"><input type="date" value={reminderDate} onChange={(e) => setReminderDate(e.target.value)} disabled={!liveData}/><input type="time" value={reminderTime} onChange={(e) => setReminderTime(e.target.value)} disabled={!liveData}/></div>
          <div className="reminderFields"><select value={recurrence} onChange={(e) => setRecurrence(e.target.value as typeof recurrence)} disabled={!liveData}><option value="none">Один раз</option><option value="daily">Каждый день</option><option value="weekly">Каждую неделю</option><option value="monthly">Каждый месяц</option></select><select value={reminderCategory} onChange={(e) => setReminderCategory(e.target.value as typeof reminderCategory)} disabled={!liveData}><option value="general">Обычное</option><option value="payment">Платёж</option><option value="health">Здоровье</option></select></div>
          <label className="priorityToggle"><input type="checkbox" checked={reminderPriority === "urgent"} onChange={(e) => setReminderPriority(e.target.checked ? "urgent" : "normal")} /> Срочно</label>
          <button className="primaryButton" disabled={!liveData}>Сохранить</button>
        </form>
        <details className="quietHours">
          <summary>Тихие часы</summary>
          <div className="quietHoursRow">
            <label><input type="checkbox" checked={quietEnabled} onChange={(e) => setQuietEnabled(e.target.checked)} /> Включить</label>
            <input type="time" value={quietStart} onChange={(e) => setQuietStart(e.target.value)} disabled={!quietEnabled}/>
            <span>—</span>
            <input type="time" value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} disabled={!quietEnabled}/>
            <button type="button" className="linkButton" onClick={() => void saveQuietHours()} disabled={!liveData}>Сохранить</button>
          </div>
          <p className="muted">Напоминания, попавшие в этот интервал, откладываются до окончания тихих часов.</p>
        </details>
      </section>

      <section className="panel">
        <div className="panelHeader"><div><p className="eyebrow">Центр уведомлений</p><h3>Urgent · Today · Later</h3></div></div>
        {(["urgent","today","later"] as const).map((bucket) => grouped[bucket].length > 0 && <div className="notificationGroup" key={bucket}>
          <b>{bucket === "urgent" ? "Срочно" : bucket === "today" ? "Сегодня" : "Позже"}</b>
          {grouped[bucket].map((item) => <div className="notificationCard" key={item.id}><div><strong>{item.title}</strong><small>{when(item.deliver_at)}</small></div><div className="rowActions">{item.linked_entity_type && item.linked_entity_id && <button onClick={() => openLinkedEntity(item)}>Открыть</button>}{item.state === "unread" && <button onClick={() => void notificationAction(item.id,"seen")}>Просмотрено</button>}<button onClick={() => void notificationAction(item.id,"snooze")}>+1ч</button><button onClick={() => void notificationAction(item.id,"skip")}>Пропустить</button><button onClick={() => void notificationAction(item.id,"done")}>Готово</button></div></div>)}
        </div>)}
        {!notifications.length && <p className="muted">Активных уведомлений нет.</p>}
      </section>
    </div>

    <section className="panel">
      <div className="panelHeader"><div><p className="eyebrow">Ритуалы Глаши</p><h3>Утро · Вечер · Неделя</h3></div></div>
      <div className="reviewTabs"><button onClick={() => void loadReview("morning")}>Утро</button><button onClick={() => void loadReview("evening")}>Вечер</button><button onClick={() => void loadReview("weekly")}>Неделя</button></div>
      {reviewBusy && <p className="muted">Собираю из базы…</p>}
      {review && <ReviewView review={review} unfinished={unfinished} onTaskAction={taskAction} onInboxAction={inboxAction} onCommand={onCommand} />}
    </section>
    {status && <p className="lifeOsStatus">{status}</p>}
      </div>
    </details>
  </div>;
}

function ReviewView({
  review,
  unfinished,
  onTaskAction,
  onInboxAction,
  onCommand,
}: {
  review: ReviewData;
  unfinished: Array<{ id: string; title: string; area?: string; due_date?: string }>;
  onTaskAction: (id: string, action: "cancel" | "move_tomorrow") => Promise<void>;
  onInboxAction: (id: string) => Promise<void>;
  onCommand: (text: string, source?: "text" | "voice") => void;
}) {
  if (review.kind === "morning") {
    const tasks = (review.tasks as Array<{ id: string; title: string }> || []);
    const conflicts = (review.conflicts as Array<{ first: { title: string }; second: { title: string } }> || []);
    const urgent = (review.urgent_notifications as Array<{ id: string; title: string }> || []);
    return <div className="reviewContent"><p><b>Сегодня:</b> {tasks.length} задач. <b>Срочно:</b> {urgent.length}. <b>Конфликтов:</b> {conflicts.length}.</p>{conflicts.map((pair,index) => <p key={index} className="reviewWarning">Пересекаются: {pair.first.title} ↔ {pair.second.title}</p>)}</div>;
  }
  if (review.kind === "evening") {
    const completed = (review.completed as Array<{ id: string; title: string }> || []);
    return <div className="reviewContent"><p><b>Выполнено:</b> {completed.length}. <b>Осталось:</b> {unfinished.length}.</p>{unfinished.slice(0,12).map((task) => <div className="reviewTask" key={task.id}><div><b>{task.title}</b><small>{task.due_date || "без даты"}</small></div><div className="rowActions"><button onClick={() => void onTaskAction(task.id,"move_tomorrow")}>На завтра</button><button onClick={() => void onTaskAction(task.id,"cancel")}>Отменить</button><button onClick={() => onCommand(`Разбей задачу «${task.title}» на этапы`)}>Разбить</button></div></div>)}</div>;
  }
  const inbox = (review.inbox as Array<{ id: string; text: string }> || []);
  const overdue = (review.overdue as unknown[] || []).length;
  const stale = (review.stale_projects as Array<{ id: string; title: string }> || []);
  const goals = (review.goals_without_next_action as Array<{ id: string; title: string }> || []);
  const oldTasks = (review.old_tasks as Array<{ id: string; title: string }> || []);
  return <div className="reviewContent">
    <p><b>Входящие:</b> {inbox.length}. <b>Просрочено:</b> {overdue}. <b>Застоявшихся проектов:</b> {stale.length}. <b>Целей без следующего шага:</b> {goals.length}. <b>Старых задач:</b> {oldTasks.length}.</p>
    {inbox.slice(0,8).map((item) => <div className="reviewTask" key={item.id}><div><b>{item.text}</b><small>входящее</small></div><button className="linkButton" onClick={() => void onInboxAction(item.id)}>Разобрано</button></div>)}
    {stale.slice(0,5).map((item) => <p key={item.id}>Проект без движения: <b>{item.title}</b></p>)}
    {goals.slice(0,5).map((item) => <p key={item.id}>Нужен следующий шаг для цели: <b>{item.title}</b></p>)}
    {oldTasks.slice(0,5).map((item) => <p key={item.id}>Давно в списке: <b>{item.title}</b></p>)}
  </div>;
}
