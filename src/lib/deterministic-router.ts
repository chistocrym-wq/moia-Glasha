export type DeterministicRoute =
  | { kind: "open_service"; service: string }
  | { kind: "query_schedule"; range: "today" | "tomorrow" }
  | { kind: "find_document"; query: string }
  | { kind: "contact_action"; contactName: string; method: "call" | "telegram" | "email" | "show_phone"; messageText?: string }
  | { kind: "create_expense"; amount: number; note: string; categorySlug: string | null }
  | { kind: "query_expenses"; categorySlug: string | null; monthToken: string | null }
  | { kind: "create_task"; title: string; area: "personal" | "work"; dateToken: string; time: string | null }
  | { kind: "create_appointment"; title: string; dateToken: string; time: string | null }
  | { kind: "log_fitness"; dateToken: string; time: string | null }
  | { kind: "cycle_start"; dateToken: string }
  | { kind: "check_availability"; dateToken: string; time: string; durationMinutes: number }
  | { kind: "search_tickets"; from: string; to: string; dateToken: string; afterTime: string | null }
  | { kind: "move_task"; taskQuery: string | null; area: "personal" | "work" }
  | { kind: "complete_task"; taskQuery: string }
  | { kind: "restore_task"; taskQuery: string }
  | { kind: "query_achievements" }
  | { kind: "split_task"; taskQuery: string }
  | { kind: "create_reminder"; title: string; dateToken: string; time: string; recurrence: "none" | "daily" | "weekly" | "monthly" }
  | { kind: "query_overdue" }
  | { kind: "global_search"; query: string }
  | { kind: "advice"; goalTitle: string | null; explicitDeep: boolean };

const CATEGORY_HINTS: Array<[RegExp, string]> = [
  [/кофе|кафе|ресторан|обед|ужин/i, "coffee_cafes"],
  [/продукт|магазин|еда/i, "groceries"],
  [/аптек|врач|лекар|анализ/i, "health"],
  [/такси|метро|бензин|транспорт/i, "transport"],
  [/курс|обуч|урок|репетитор|книг/i, "education"],
  [/сын|реб[её]нок|школ/i, "child"],
  [/аренд|квартир|коммун|жкх|дом/i, "housing"],
  [/одежд|космет|маникюр|волос|массаж/i, "self_care"],
  [/кино|театр|развлеч|игр/i, "entertainment"],
  [/подписк|сервис/i, "subscriptions"],
  [/билет|отел|поездк/i, "travel"],
  [/работ|клиент|офис/i, "work"],
];

const MONTHS: Record<string, number> = {
  январ: 1, феврал: 2, март: 3, апрел: 4, май: 5, ма: 5, июн: 6,
  июл: 7, август: 8, сентябр: 9, октябр: 10, ноябр: 11, декабр: 12,
};

const WEEKDAYS: Array<[string[], number]> = [
  [["понедельник", "понедельника"], 1],
  [["вторник", "вторника"], 2],
  [["среда", "среду", "среды"], 3],
  [["четверг", "четверга"], 4],
  [["пятница", "пятницу", "пятницы"], 5],
  [["суббота", "субботу", "субботы"], 6],
  [["воскресенье", "воскресенья"], 0],
];

function tidy(value: string) {
  return value.trim().replace(/[.!?]+$/g, "").replace(/\s+/g, " ");
}

function lower(value: string) {
  return value.toLocaleLowerCase("ru-RU");
}

function hasAny(text: string, parts: string[]) {
  const value = lower(text);
  return parts.some((part) => value.includes(part));
}

function dateToken(text: string) {
  const value = lower(text);
  if (value.includes("сегодня")) return "today";
  if (value.includes("завтра")) return "tomorrow";
  for (const [names] of WEEKDAYS) {
    const found = names.find((name) => value.includes(name));
    if (found) return found;
  }
  return null;
}

function timeToken(text: string) {
  const match = text.match(/(?:^|\s)(?:в|после)\s+([01]?\d|2[0-3])(?::([0-5]\d))?(?=\s|$|[,.!?])/i);
  if (!match) return null;
  return `${String(Number(match[1])).padStart(2, "0")}:${match[2] || "00"}`;
}

function categoryFromText(text: string) {
  return CATEGORY_HINTS.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

function serviceFromText(text: string) {
  const value = lower(tidy(text));
  if (/^(?:tutu|туту)$/.test(value)) return "tutu";
  if (/^(?:telegram|телеграм|телеграмм)$/.test(value)) return "telegram";
  if (/^(?:яндекс\s+карты|карты|карта)$/.test(value)) return "maps";
  if (/^переводчик$/.test(value)) return "translate";
  if (/^госуслуги$/.test(value)) return "gosuslugi";
  if (/^(?:почта|email|e-mail)$/.test(value)) return "mail";
  if (/^календарь$/.test(value)) return "calendar";
  if (/^(?:банк|мой\s+банк)$/.test(value)) return "bank";
  return null;
}

function hasFutureCue(text: string) {
  return Boolean(dateToken(text)) || hasAny(text, ["через ", "на следующ", " потом", "вечером", "утром", "днём", "днем"]);
}

function monthFromText(text: string) {
  const value = lower(text);
  return Object.keys(MONTHS).find((stem) => value.includes(stem)) ?? null;
}

function stripSchedulingPrefix(text: string) {
  return tidy(text
    .replace(/^\s*(?:сегодня|завтра)\s*/i, "")
    .replace(/^\s*(?:в\s+)?(?:понедельник|понедельника|вторник|вторника|среду|среда|четверг|четверга|пятницу|пятница|субботу|суббота|воскресенье)\s*/i, "")
    .replace(/(?:^|\s)по работе(?=\s|$)/ig, " ")
    .replace(/\s+/g, " "));
}

function cleanupDocumentQuery(text: string) {
  return tidy(
    text
      .replace(/^.*?(?:найди|покажи)\s+/i, "")
      .replace(/(?:^|\s)(?:мой|мою|мои|мне)(?=\s|$)/ig, " ")
  );
}

export function deterministicRoute(input: string): DeterministicRoute | null {
  const text = tidy(input);
  const value = lower(text);
  if (!text) return null;

  if (/^(?:глаша[,.]?\s*)?(?:покажи\s+мои\s+достижения|покажи\s+достижения|что\s+я\s+сделал[аи]?\s+за\s+последн(?:ие|их)\s+14\s+дн(?:ей|я))$/i.test(text)) {
    return { kind: "query_achievements" };
  }

  const completeTask = text.match(/^(?:глаша[,.]?\s*)?(?:отметь|пометь)\s+(?:задачу\s+)?[«"]?(.+?)[»"]?\s+(?:как\s+)?выполненн(?:ой|ую)|^(?:глаша[,.]?\s*)?(?:заверши|выполни)\s+(?:задачу\s+)?[«"]?(.+?)[»"]?$/i);
  if (completeTask) {
    const taskQuery = tidy((completeTask[1] || completeTask[2] || "").replace(/^["«]|["»]$/g, ""));
    if (taskQuery) return { kind: "complete_task", taskQuery };
  }

  const restoreTask = text.match(/^(?:глаша[,.]?\s*)?(?:верни|возврати)\s+(?:задачу\s+)?[«"]?(.+?)[»"]?\s+(?:обратно\s+)?(?:в\s+)?дела$/i);
  if (restoreTask) {
    const taskQuery = tidy(restoreTask[1].replace(/^["«]|["»]$/g, ""));
    if (taskQuery) return { kind: "restore_task", taskQuery };
  }

  const openContact = text.match(/^(?:глаша[,.]?\s*)?открой\s+контакт\s+(.+)$/i);
  if (openContact) {
    const contactName = tidy(openContact[1]);
    if (contactName) return { kind: "contact_action", contactName, method: "show_phone" };
  }

  if (/^(?:глаша[,.]?\s*)?(?:открой|открыть)(?:\s|$)/i.test(text)) {
    const requested = tidy(text.replace(/^(?:глаша[,.]?\s*)?(?:открой|открыть)\s*/i, ""));
    const service = serviceFromText(requested) || requested;
    if (service) return { kind: "open_service", service };
  }

  const moveNamed = text.match(/^(?:глаша[,.]?\s*)?(?:перенеси|перемести)\s+(?:задачу\s+)?(?:про\s+)?(.+?)\s+(?:в|на)\s+(работу|рабочее|рабочие|личное|личные)(?:\s+дела)?$/i);
  if (moveNamed) {
    return {
      kind: "move_task",
      taskQuery: tidy(moveNamed[1].replace(/^["«]|["»]$/g, "")),
      area: /работ/i.test(moveNamed[2]) ? "work" : "personal",
    };
  }

  if (/^это\s+(?:точно\s+)?личн(?:ое|ая|ый)(?:\s*,?\s*а\s+не\s+рабоч(?:ее|ая|ий))?$/i.test(text)) {
    return { kind: "move_task", taskQuery: null, area: "personal" };
  }
  if (/^это\s+(?:точно\s+)?рабоч(?:ее|ая|ий)(?:\s*,?\s*а\s+не\s+личн(?:ое|ая|ый))?$/i.test(text)) {
    return { kind: "move_task", taskQuery: null, area: "work" };
  }

  const splitTask = text.match(/^(?:глаша[,.]?\s*)?(?:разбей|разложи)\s+(?:задачу\s+)?["«]?(.+?)["»]?\s+(?:на\s+)?(?:этапы|шаги|подзадачи)$/i);
  if (splitTask) {
    return { kind: "split_task", taskQuery: tidy(splitTask[1]) };
  }

  if (
    ((value.includes("какие") || value.includes("что")) &&
      (value.includes("дел") || value.includes("задач") || value.includes("план") || value.includes("у меня")) &&
      (value.includes("завтра") || value.includes("сегодня")))
  ) {
    return { kind: "query_schedule", range: value.includes("завтра") ? "tomorrow" : "today" };
  }

  if (
    (value.includes("найди") || value.includes("покажи")) &&
    hasAny(value, ["паспорт", "документ", "полис", "страхов", "договор", "свидетельств", "справк"])
  ) {
    const query = cleanupDocumentQuery(text);
    return { kind: "find_document", query: query || "документ" };
  }

  const showPhone = text.match(/^(?:глаша[,.]?\s*)?покажи\s+(?:номер|телефон)\s+(.+)$/i);
  if (showPhone) {
    const contactName = tidy(showPhone[1]);
    if (contactName) return { kind: "contact_action", contactName, method: "show_phone" };
  }

  if (/^(?:позвони|набери)\s+/i.test(text) && !hasFutureCue(text)) {
    const contactName = tidy(text.replace(/^(?:позвони|набери)\s+/i, "").replace(/\s+сейчас$/i, ""));
    if (contactName) return { kind: "contact_action", contactName, method: "call" };
  }

  const telegram = text.match(/^напиши\s+(.+?)\s+в\s+телеграм(?:е)?(?:\s*[:,]\s*(.+))?$/i);
  if (telegram && !hasFutureCue(text)) {
    return {
      kind: "contact_action",
      contactName: tidy(telegram[1]),
      method: "telegram",
      messageText: telegram[2] ? tidy(telegram[2]) : undefined,
    };
  }

  const email = text.match(/^напиши\s+(.+?)\s+(?:на\s+)?(?:email|e-mail|почту)(?:\s*[:,]\s*(.+))?$/i);
  if (email && !hasFutureCue(text)) {
    return {
      kind: "contact_action",
      contactName: tidy(email[1]),
      method: "email",
      messageText: email[2] ? tidy(email[2]) : undefined,
    };
  }

  if (/^(?:глаша[,.]?\s*)?покажи\s+просроченн(?:ые|ое|ую|ый)(?:\s+задачи)?$/i.test(text)) {
    return { kind: "query_overdue" };
  }

  if (/^(?:глаша[,.]?\s*)?(?:напомни|напоминай)(?:\s|$)/i.test(text)) {
    const recurrence =
      /кажд(?:ый|ую)\s+день|ежеднев/i.test(text) ? "daily" :
      /кажд(?:ую|ой)\s+недел|еженедел/i.test(text) ? "weekly" :
      /кажд(?:ый|ую)\s+месяц|ежемесяч/i.test(text) ? "monthly" :
      "none";
    const reminderDate = dateToken(text) || (recurrence !== "none" ? "today" : null);
    const reminderTime = timeToken(text);
    if (reminderDate && reminderTime) {
      const title = tidy(text
        .replace(/^(?:глаша[,.]?\s*)?(?:напомни|напоминай)\s*/i, "")
        .replace(/(?:^|\s)(?:сегодня|завтра)(?=\s|$)/ig, " ")
        .replace(/(?:^|\s)(?:в\s+)?(?:понедельник|понедельника|вторник|вторника|среду|среда|четверг|четверга|пятницу|пятница|субботу|суббота|воскресенье)(?=\s|$)/ig, " ")
        .replace(/кажд(?:ый|ую|ой)\s+(?:день|недел\w*|месяц)|ежеднев\w*|еженедел\w*|ежемесяч\w*/ig, " ")
        .replace(/(?:^|\s)в\s+([01]?\d|2[0-3])(?::[0-5]\d)?(?=\s|$|[,.!?])/ig, " ")
        .replace(/\s+/g, " "));
      if (title) return { kind: "create_reminder", title, dateToken: reminderDate, time: reminderTime, recurrence };
    }
  }

  const expense = text.match(/(?:потратил[аи]?|заплатил[аи]?|расход(?:ы)?)[^\d]{0,24}(\d+(?:[.,]\d{1,2})?)\s*(?:₽|р\.?|руб(?:ль|ля|лей)?\.?)?(?:\s+на)?\s+(.+)/i);
  if (expense) {
    const amount = Number(expense[1].replace(",", "."));
    const note = tidy(expense[2]);
    if (Number.isFinite(amount) && amount >= 0 && note) {
      return { kind: "create_expense", amount, note, categorySlug: categoryFromText(note) };
    }
  }

  if ((value.includes("сколько") || value.includes("расход")) && (value.includes("потрат") || value.includes("расход"))) {
    return {
      kind: "query_expenses",
      categorySlug: categoryFromText(text),
      monthToken: monthFromText(text),
    };
  }

  const token = dateToken(text);
  const time = timeToken(text);

  if (
    (hasAny(text, ["могу я", "свободно ли", "есть ли окно"])) &&
    hasAny(text, ["записаться", "поставить", "встретиться", " в "])
  ) {
    if (token && time) return { kind: "check_availability", dateToken: token, time, durationMinutes: 60 };
  }

  if (
    hasAny(text, ["записана к врачу", "записан к врачу", "записалась к врачу", "записался к врачу", "приём у врача", "прием у врача"]) ||
    (value.includes("врач") && Boolean(token) && Boolean(time))
  ) {
    if (token) {
      const doctorMatch = text.match(/(?:к|у)\s+(?:врачу|врача|врач)(?:\s+([^,.]+?))?(?=\s+(?:сегодня|завтра|в\s+\d)|$)/i);
      const title = doctorMatch?.[1] ? `Врач: ${tidy(doctorMatch[1])}` : "Врач";
      return { kind: "create_appointment", title, dateToken: token, time };
    }
  }

  if (hasAny(text, ["была тренировка", "был на тренировке", "был тренировка", "тренировалась", "тренировался"])) {
    return { kind: "log_fitness", dateToken: token || "today", time };
  }

  if (hasAny(text, ["начались месячные", "начался цикл", "началась менструация", "месячные начались"])) {
    return { kind: "cycle_start", dateToken: token || "today" };
  }

  if (
    token &&
    hasAny(text, ["позвонить", "отправить", "сделать", "купить", "забрать", "подготовить", "написать", "оплатить", "пройти", "заниматься"])
  ) {
    const title = stripSchedulingPrefix(text);
    const work = hasAny(text, ["по работе", "бухгалтер", "клиент", "договор", "рабоч", "офис", "презентац"]);
    return { kind: "create_task", title, area: work ? "work" : "personal", dateToken: token, time };
  }

  if (/^найди\s+билет(?:ы)?(?:\s|$)/i.test(text)) {
    const body = tidy(text.replace(/^найди\s+билет(?:ы)?\s*/i, ""));
    const routeMatch = body.match(/^(.+?)\s+[—–-]\s+(.+)$/);
    if (routeMatch) {
      const from = tidy(routeMatch[1]);
      let rest = tidy(routeMatch[2]);
      const travelDate = dateToken(rest);
      const after = rest.match(/(?:^|\s)после\s+([01]?\d|2[0-3])(?::([0-5]\d))?(?=\s|$|[,.!?])/i);
      const afterTime = after ? `${String(Number(after[1])).padStart(2, "0")}:${after[2] || "00"}` : null;
      rest = tidy(rest
        .replace(/(?:^|\s)(?:сегодня|завтра)(?=\s|$)/ig, " ")
        .replace(/(?:^|\s)(?:в\s+)?(?:понедельник|вторник|среду|среда|четверг|пятницу|пятница|субботу|суббота|воскресенье)(?=\s|$)/ig, " ")
        .replace(/(?:^|\s)после\s+([01]?\d|2[0-3])(?::[0-5]\d)?(?=\s|$)/ig, " "));
      if (from && rest && travelDate) {
        return { kind: "search_tickets", from, to: rest, dateToken: travelDate, afterTime };
      }
    }
  }

  if (/^(?:глаша[,.]?\s*)?(?:найди|поиск)\s+/i.test(text)) {
    const query = tidy(text.replace(/^(?:глаша[,.]?\s*)?(?:найди|поиск)\s+/i, ""));
    if (query) return { kind: "global_search", query };
  }

  if (hasAny(text, ["разбери мою неделю", "стратег", "план подготовки", "что мне сделать для моей цели"])) {
    const goal = text.match(/(?:цели?|подготовк[аи]\s+к)\s+([A-Za-zА-Яа-яЁё0-9-]+)/i)?.[1] ?? null;
    return {
      kind: "advice",
      goalTitle: goal,
      explicitDeep: hasAny(text, ["стратег", "разбери мою неделю", "сравни", "вариант"]),
    };
  }

  return null;
}

function currentLocalDate(timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function resolveDateToken(token: string, timezone: string) {
  const today = currentLocalDate(timezone);
  const base = new Date(today + "T12:00:00Z");

  if (token === "today") return today;
  if (token === "tomorrow") {
    base.setUTCDate(base.getUTCDate() + 1);
    return base.toISOString().slice(0, 10);
  }

  const value = lower(token);
  const weekdayEntry = WEEKDAYS.find(([names]) => names.some((name) => value.includes(name)));
  if (!weekdayEntry) return today;

  const target = weekdayEntry[1];
  const current = base.getUTCDay();
  let delta = (target - current + 7) % 7;
  if (delta === 0) delta = 7;
  base.setUTCDate(base.getUTCDate() + delta);
  return base.toISOString().slice(0, 10);
}

export function resolveMonthBounds(monthToken: string | null, timezone: string) {
  if (!monthToken) return null;
  const value = lower(monthToken);
  const stem = Object.keys(MONTHS).find((key) => value.startsWith(key) || key.startsWith(value));
  if (!stem) return null;

  const month = MONTHS[stem];
  const year = Number(currentLocalDate(timezone).slice(0, 4));
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(year, month, 0));
  return { start, end: endDate.toISOString().slice(0, 10) };
}
