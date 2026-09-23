import { createSupabaseServerClient } from "@/lib/supabase/server";
import { nextOccurrence, localTimeFallsInQuietHours, type Recurrence } from "@/lib/life-os";

export type LifeDb = Awaited<ReturnType<typeof createSupabaseServerClient>>;

type LifeProfile = {
  timezone: string;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
};

export type ReminderInput = {
  title: string;
  dueAt: string;
  recurrence?: Recurrence;
  recurrenceInterval?: number;
  priority?: "normal" | "urgent";
  category?: "general" | "payment" | "health";
  details?: string | null;
  linkedEntityType?: string | null;
  linkedEntityId?: string | null;
};

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("ru-RU");
}

function safeLike(value: string) {
  return value.replace(/[%_]/g, (match) => "\\" + match);
}

export function localDate(timezone: string, offsetDays = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const date = new Date(parts + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

export function zonedDateTimeToUtc(date: string, time: string, timezone: string) {
  const [hour, minute] = time.slice(0, 5).split(":").map((part) => Number(part) || 0);
  const guess = new Date(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(guess);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  const viewedAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return new Date(guess.getTime() - (viewedAsUtc - guess.getTime()));
}

export function dayBounds(date: string, timezone: string) {
  return {
    start: zonedDateTimeToUtc(date, "00:00", timezone).toISOString(),
    end: zonedDateTimeToUtc(date, "23:59", timezone).toISOString(),
  };
}

async function getProfile(db: LifeDb, userId: string): Promise<LifeProfile> {
  const { data, error } = await db
    .from("profiles")
    .select("timezone,quiet_hours_enabled,quiet_hours_start,quiet_hours_end")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return {
    timezone: data?.timezone || "Europe/Berlin",
    quiet_hours_enabled: Boolean(data?.quiet_hours_enabled),
    quiet_hours_start: String(data?.quiet_hours_start || "22:00"),
    quiet_hours_end: String(data?.quiet_hours_end || "08:00"),
  };
}

function localParts(iso: string, timezone: string) {
  const date = new Date(iso);
  const datePart = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  const timePart = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return { date: datePart, time: timePart };
}

function adjustForQuietHours(iso: string, profile: LifeProfile) {
  if (!profile.quiet_hours_enabled) return iso;
  const local = localParts(iso, profile.timezone);
  if (!localTimeFallsInQuietHours(local.time, profile.quiet_hours_start, profile.quiet_hours_end)) return iso;

  const start = profile.quiet_hours_start.slice(0, 5);
  const end = profile.quiet_hours_end.slice(0, 5);
  let targetDate = local.date;
  if (start > end && local.time >= start) {
    const next = new Date(local.date + "T12:00:00Z");
    next.setUTCDate(next.getUTCDate() + 1);
    targetDate = next.toISOString().slice(0, 10);
  }
  return zonedDateTimeToUtc(targetDate, end, profile.timezone).toISOString();
}

export async function materializeNotifications(db: LifeDb, userId: string, knownProfile?: LifeProfile) {
  const profile = knownProfile || await getProfile(db, userId);
  const { data: reminders, error } = await db
    .from("reminders")
    .select("id,title,priority,next_occurrence_at")
    .eq("user_id", userId)
    .eq("active", true)
    .order("next_occurrence_at", { ascending: true })
    .limit(250);
  if (error) throw error;
  if (!reminders?.length) return;

  const rows = reminders.map((reminder) => ({
    user_id: userId,
    reminder_id: reminder.id,
    title: reminder.title,
    scheduled_for: reminder.next_occurrence_at,
    deliver_at: adjustForQuietHours(reminder.next_occurrence_at, profile),
    priority: reminder.priority,
    state: "unread",
  }));

  const { error: insertError } = await db
    .from("notifications")
    .upsert(rows, { onConflict: "user_id,reminder_id,scheduled_for", ignoreDuplicates: true });
  if (insertError) throw insertError;
}

export async function listNotifications(db: LifeDb, userId: string) {
  const profile = await getProfile(db, userId);
  await materializeNotifications(db, userId, profile);
  const { data, error } = await db
    .from("notifications")
    .select("id,reminder_id,title,scheduled_for,deliver_at,priority,state,resolution,snoozed_until,reminders(category,recurrence,linked_entity_type,linked_entity_id)")
    .eq("user_id", userId)
    .in("state", ["unread", "seen", "snoozed"])
    .order("deliver_at", { ascending: true })
    .limit(100);
  if (error) throw error;

  const today = localParts(new Date().toISOString(), profile.timezone).date;
  const nowMs = Date.now();
  return (data ?? []).map((item) => ({
    ...item,
    bucket: new Date(item.deliver_at).getTime() <= nowMs
      ? "urgent"
      : localParts(item.deliver_at, profile.timezone).date === today
        ? "today"
        : "later",
  }));
}

export async function createReminder(db: LifeDb, userId: string, input: ReminderInput) {
  const interval = Math.max(1, Math.min(365, input.recurrenceInterval || 1));
  const recurrence = input.recurrence || "none";
  const { data, error } = await db
    .from("reminders")
    .insert({
      user_id: userId,
      title: input.title,
      details: input.details || null,
      priority: input.priority || "normal",
      category: input.category || "general",
      recurrence,
      recurrence_interval: interval,
      due_at: input.dueAt,
      next_occurrence_at: input.dueAt,
      active: true,
      linked_entity_type: input.linkedEntityType || null,
      linked_entity_id: input.linkedEntityId || null,
    })
    .select("id,title,due_at,next_occurrence_at,recurrence,priority,category")
    .single();
  if (error) throw error;
  await materializeNotifications(db, userId);
  return data;
}

export async function actOnNotification(
  db: LifeDb,
  userId: string,
  notificationId: string,
  action: "seen" | "snooze" | "skip" | "done",
  snoozeMinutes = 60,
) {
  const { data: notification, error } = await db
    .from("notifications")
    .select("id,reminder_id,scheduled_for,state,reminders(id,recurrence,recurrence_interval,next_occurrence_at,active)")
    .eq("user_id", userId)
    .eq("id", notificationId)
    .single();
  if (error) throw error;

  if (action === "seen") {
    const { error: updateError } = await db
      .from("notifications")
      .update({ state: "seen", updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("id", notificationId);
    if (updateError) throw updateError;
    return { state: "seen" };
  }

  if (action === "snooze") {
    const until = new Date(Date.now() + Math.max(5, Math.min(7 * 24 * 60, snoozeMinutes)) * 60_000).toISOString();
    const { error: updateError } = await db
      .from("notifications")
      .update({ state: "snoozed", snoozed_until: until, deliver_at: until, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("id", notificationId);
    if (updateError) throw updateError;
    return { state: "snoozed", snoozed_until: until };
  }

  const relation = notification.reminders as unknown;
  const reminder = (Array.isArray(relation) ? relation[0] : relation) as {
    id: string;
    recurrence: Recurrence;
    recurrence_interval: number;
    next_occurrence_at: string;
    active: boolean;
  } | null;

  const { error: notificationError } = await db
    .from("notifications")
    .update({
      state: "done",
      resolution: action === "skip" ? "skipped" : "done",
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("id", notificationId);
  if (notificationError) throw notificationError;

  if (reminder) {
    const next = nextOccurrence(reminder.next_occurrence_at, reminder.recurrence, reminder.recurrence_interval);
    const patch = next
      ? { next_occurrence_at: next, updated_at: new Date().toISOString() }
      : { active: false, updated_at: new Date().toISOString() };
    const { error: reminderError } = await db
      .from("reminders")
      .update(patch)
      .eq("user_id", userId)
      .eq("id", reminder.id);
    if (reminderError) throw reminderError;
  }

  await materializeNotifications(db, userId);
  return { state: "done", resolution: action === "skip" ? "skipped" : "done" };
}

export async function searchLife(db: LifeDb, userId: string, rawQuery: string) {
  const q = normalize(rawQuery);
  if (!q) return [];
  const pattern = `%${safeLike(q)}%`;

  const [tasks, goals, events, documents, contacts, inbox, memories] = await Promise.all([
    db.from("tasks").select("id,title,area,status,due_date,is_project").eq("user_id", userId).ilike("title", pattern).limit(12),
    db.from("goals").select("id,title,kind,status,target_date").eq("user_id", userId).ilike("title", pattern).limit(12),
    db.from("calendar_events").select("id,title,kind,start_at,area").eq("user_id", userId).ilike("title", pattern).limit(12),
    db.from("documents").select("id,title,document_type,owner_person,expiry_date").eq("user_id", userId).ilike("title", pattern).limit(12),
    db.from("contacts").select("id,name,relation,phone,email").eq("user_id", userId).ilike("name", pattern).limit(12),
    db.from("inbox_entries").select("id,text,created_at,processed").eq("user_id", userId).ilike("text", pattern).limit(12),
    db.from("memories").select("id,title,kind,happened_at").eq("user_id", userId).ilike("title", pattern).limit(12),
  ]);

  const firstError = [tasks, goals, events, documents, contacts, inbox, memories].find((item) => item.error)?.error;
  if (firstError) throw firstError;

  return [
    ...(tasks.data ?? []).map((row) => ({
      entity_type: row.is_project ? "project" : "task",
      id: row.id,
      title: row.title,
      subtitle: [row.area, row.status, row.due_date].filter(Boolean).join(" · "),
    })),
    ...(goals.data ?? []).map((row) => ({
      entity_type: "goal",
      id: row.id,
      title: row.title,
      subtitle: [row.kind, row.status, row.target_date].filter(Boolean).join(" · "),
    })),
    ...(events.data ?? []).map((row) => ({
      entity_type: "event",
      id: row.id,
      title: row.title,
      subtitle: [row.kind, row.start_at].filter(Boolean).join(" · "),
    })),
    ...(documents.data ?? []).map((row) => ({
      entity_type: "document",
      id: row.id,
      title: row.title,
      subtitle: [row.document_type, row.owner_person, row.expiry_date].filter(Boolean).join(" · "),
    })),
    ...(contacts.data ?? []).map((row) => ({
      entity_type: "contact",
      id: row.id,
      title: row.name,
      subtitle: [row.relation, row.phone, row.email].filter(Boolean).join(" · "),
    })),
    ...(inbox.data ?? []).map((row) => ({
      entity_type: "inbox",
      id: row.id,
      title: row.text,
      subtitle: row.processed ? "обработано" : "входящее",
    })),
    ...(memories.data ?? []).map((row) => ({
      entity_type: row.kind === "journal" ? "journal" : "memory",
      id: row.id,
      title: row.title,
      subtitle: [row.kind, row.happened_at].filter(Boolean).join(" · "),
    })),
  ].slice(0, 40);
}

export async function getNow(db: LifeDb, userId: string) {
  const profile = await getProfile(db, userId);
  const today = localDate(profile.timezone);
  const nowIso = new Date().toISOString();

  await materializeNotifications(db, userId, profile);

  const [taskRes, eventRes, notificationRes] = await Promise.all([
    db.from("tasks")
      .select("id,title,area,status,due_date,due_time,priority,parent_task_id,is_project")
      .eq("user_id", userId)
      .neq("status", "done")
      .neq("status", "cancelled")
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(40),
    db.from("calendar_events")
      .select("id,title,start_at,end_at,kind,area")
      .eq("user_id", userId)
      .gte("start_at", nowIso)
      .order("start_at")
      .limit(1),
    db.from("notifications")
      .select("id,title,deliver_at,priority,state,reminders(category,linked_entity_type)")
      .eq("user_id", userId)
      .in("state", ["unread", "seen", "snoozed"])
      .order("deliver_at")
      .limit(40),
  ]);
  const firstError = [taskRes, eventRes, notificationRes].find((item) => item.error)?.error;
  if (firstError) throw firstError;

  const tasks = taskRes.data ?? [];
  const overdue = tasks.filter((task) => task.due_date && task.due_date < today);
  const urgent = tasks.filter((task) => task.priority === "urgent" || (task.due_date && task.due_date < today));
  const topTasks = [...tasks]
    .sort((a, b) => {
      const ap = a.priority === "urgent" ? 0 : a.priority === "high" ? 1 : 2;
      const bp = b.priority === "urgent" ? 0 : b.priority === "high" ? 1 : 2;
      return ap - bp || String(a.due_date || "9999").localeCompare(String(b.due_date || "9999"));
    })
    .slice(0, 3);

  const notifications = (notificationRes.data ?? []).map((item) => {
    const relation = item.reminders as unknown;
    const reminder = (Array.isArray(relation) ? relation[0] : relation) as { category?: string; linked_entity_type?: string } | null;
    return { ...item, category: reminder?.category || "general", linked_entity_type: reminder?.linked_entity_type || null };
  });

  return {
    generated_at: nowIso,
    next_event: eventRes.data?.[0] ?? null,
    urgent_or_overdue: urgent.slice(0, 5),
    overdue_count: overdue.length,
    top_tasks: topTasks,
    upcoming_payment_or_reminder: notifications.find((item) => item.category === "payment") ?? notifications[0] ?? null,
    health_reminder: notifications.find((item) => item.category === "health" || item.linked_entity_type === "health_event") ?? null,
  };
}

type Interval = { id: string; title: string; start: Date; end: Date };

function conflictPairs(items: Interval[]) {
  const sorted = [...items].sort((a, b) => a.start.getTime() - b.start.getTime());
  const pairs: Array<{ first: Interval; second: Interval }> = [];
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      if (sorted[j].start >= sorted[i].end) break;
      if (sorted[i].start < sorted[j].end && sorted[j].start < sorted[i].end) {
        pairs.push({ first: sorted[i], second: sorted[j] });
      }
    }
  }
  return pairs;
}

export async function getReview(db: LifeDb, userId: string, kind: "morning" | "evening" | "weekly") {
  const profile = await getProfile(db, userId);
  const today = localDate(profile.timezone);
  const bounds = dayBounds(today, profile.timezone);

  if (kind === "morning") {
    const [tasks, events, notifications] = await Promise.all([
      db.from("tasks").select("id,title,area,status,due_date,due_time,priority").eq("user_id", userId).neq("status", "done").lte("due_date", today).order("due_time"),
      db.from("calendar_events").select("id,title,start_at,end_at,kind,area").eq("user_id", userId).gte("start_at", bounds.start).lte("start_at", bounds.end).order("start_at"),
      listNotifications(db, userId),
    ]);
    if (tasks.error) throw tasks.error;
    if (events.error) throw events.error;

    const intervals: Interval[] = [
      ...(events.data ?? []).map((event) => ({
        id: event.id,
        title: event.title,
        start: new Date(event.start_at),
        end: new Date(event.end_at || new Date(new Date(event.start_at).getTime() + 60 * 60_000).toISOString()),
      })),
      ...(tasks.data ?? []).filter((task) => task.due_date === today && task.due_time).map((task) => {
        const start = zonedDateTimeToUtc(today, String(task.due_time).slice(0, 5), profile.timezone);
        return { id: task.id, title: task.title, start, end: new Date(start.getTime() + 60 * 60_000) };
      }),
    ];

    return {
      kind,
      date: today,
      tasks: tasks.data ?? [],
      events: events.data ?? [],
      conflicts: conflictPairs(intervals),
      urgent_notifications: notifications.filter((item) => item.bucket === "urgent" || item.priority === "urgent"),
      payments_or_reminders: notifications.filter((item) => {
        const relation = item.reminders as unknown;
        const reminder = (Array.isArray(relation) ? relation[0] : relation) as { category?: string } | null;
        return reminder?.category === "payment" || item.bucket === "today";
      }).slice(0, 5),
    };
  }

  if (kind === "evening") {
    const [completed, unfinished] = await Promise.all([
      db.from("tasks").select("id,title,area,status,completed_at").eq("user_id", userId).gte("completed_at", bounds.start).lte("completed_at", bounds.end).order("completed_at", { ascending: false }),
      db.from("tasks").select("id,title,area,status,due_date,due_time,priority,is_project").eq("user_id", userId).neq("status", "done").neq("status", "cancelled").lte("due_date", today).order("due_date"),
    ]);
    if (completed.error) throw completed.error;
    if (unfinished.error) throw unfinished.error;
    return {
      kind,
      date: today,
      completed: completed.data ?? [],
      unfinished: unfinished.data ?? [],
      suggested_actions: ["move", "cancel", "split"],
    };
  }

  const staleBefore = new Date(Date.now() - 14 * 24 * 60 * 60_000).toISOString();
  const [inbox, overdue, projects, goals, goalTasks] = await Promise.all([
    db.from("inbox_entries").select("id,text,created_at").eq("user_id", userId).eq("processed", false).order("created_at").limit(100),
    db.from("tasks").select("id,title,area,due_date,priority,parent_task_id").eq("user_id", userId).neq("status", "done").neq("status", "cancelled").lt("due_date", today).order("due_date").limit(100),
    db.from("tasks").select("id,title,area,status,updated_at").eq("user_id", userId).eq("is_project", true).neq("status", "done").lt("updated_at", staleBefore).order("updated_at").limit(50),
    db.from("goals").select("id,title,target_date,status").eq("user_id", userId).eq("status", "active").limit(100),
    db.from("tasks").select("id,goal_id,status").eq("user_id", userId).neq("status", "done").not("goal_id", "is", null).limit(500),
  ]);
  const firstError = [inbox, overdue, projects, goals, goalTasks].find((item) => item.error)?.error;
  if (firstError) throw firstError;

  const activeGoalIds = new Set((goalTasks.data ?? []).map((task) => task.goal_id));
  return {
    kind,
    inbox: inbox.data ?? [],
    overdue: overdue.data ?? [],
    stale_projects: projects.data ?? [],
    goals_without_next_action: (goals.data ?? []).filter((goal) => !activeGoalIds.has(goal.id)),
  };
}

export async function createEntityLink(
  db: LifeDb,
  userId: string,
  input: {
    sourceType: string;
    sourceId: string;
    targetType: string;
    targetId: string;
    relationType: string;
    note?: string | null;
  },
) {
  const { data, error } = await db
    .from("entity_links")
    .insert({
      user_id: userId,
      source_type: input.sourceType,
      source_id: input.sourceId,
      target_type: input.targetType,
      target_id: input.targetId,
      relation_type: input.relationType,
      note: input.note || null,
    })
    .select("id,source_type,source_id,target_type,target_id,relation_type,note,created_at")
    .single();
  if (error) throw error;
  return data;
}
