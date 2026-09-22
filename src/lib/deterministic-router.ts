export type DeterministicRoute =
  | { kind: "open_service"; service: string }
  | { kind: "query_schedule"; range: "today" | "tomorrow" }
  | { kind: "find_document"; query: string }
  | { kind: "contact_action"; contactName: string; method: "call" | "telegram" | "email"; messageText?: string }
  | { kind: "create_expense"; amount: number; note: string; categorySlug: string | null }
  | { kind: "query_expenses"; categorySlug: string | null; monthToken: string | null }
  | { kind: "create_task"; title: string; area: "personal" | "work"; dateToken: string; time: string | null }
  | { kind: "create_appointment"; title: string; dateToken: string; time: string | null }
  | { kind: "log_fitness"; dateToken: string; time: string | null }
  | { kind: "cycle_start"; dateToken: string }
  | { kind: "check_availability"; dateToken: string; time: string; durationMinutes: number }
  | { kind: "search_tickets"; from: string; to: string; dateToken: string; afterTime: string | null }
  | { kind: "advice"; goalTitle: string | null; explicitDeep: boolean };

const SERVICE_ALIASES: Array<[RegExp, string]> = [
  [/\btutu\b|\bтуту\b/i, "tutu"],
  [/telegram|телеграм/i, "telegram"],
  [/яндекс\s*карт|\bкарт[ыау]?\b/i, "maps"],
  [/переводчик/i, "translate"],
  [/госуслуг/i, "gosuslugi"],
  [/почт[ауые]/i, "mail"],
  [/календар/i, "calendar"],
  [/банк/i, "bank"],
];

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
  январ: 1, феврал: 2, март: 3, апрел: 4, ма: 5, июн: 6,
  июл: 7, август: 8, сентябр: 9, октябр: 10, ноябр: 11, декабр: 12,
};

const WEEKDAYS: Record<string, number> = {
  понедельник: 1, понедельника: 1,
  вторник: 2, вторника: 2,
  среда: 3, среду: 3, среды: 3,
  четверг: 4, четверга: 4,
  пятница: 5, пятницу: 5, пятницы: 5,
  суббота: 6, субботу: 6, субботы: 6,
  воскресенье: 0, воскресенья: 0,
};

function tidy(value: string) {
  return value.trim().replace(/[.!?]+$/g, "").replace(/\s+/g, " ");
}

function dateToken(text: string) {
  const lower = text.toLocaleLowerCase("ru-RU");
  if (/\bсегодня\b/.test(lower)) return "today";
  if (/\bзавтра\b/.test(lower)) return "tomorrow";
  for (const name of Object.keys(WEEKDAYS)) {
    if (new RegExp(`\\b${name}\\b`, "i").test(lower)) return name;
  }
  return null;
}

function timeToken(text: string) {
  const match = text.match(/(?:\bв\s+|после\s+)([01]?\d|2[0-3])(?::([0-5]\d))?/i);
  if (!match) return null;
  return `${String(Number(match[1])).padStart(2, "0")}:${match[2] || "00"}`;
}

function categoryFromText(text: string) {
  return CATEGORY_HINTS.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

function serviceFromText(text: string) {
  return SERVICE_ALIASES.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

function hasFutureCue(text: string) {
  return Boolean(dateToken(text)) || /\b(?:через|на следующ|потом|вечером|утром|дн[её]м)\b/i.test(text);
}

function monthFromText(text: string) {
  const lower = text.toLocaleLowerCase("ru-RU");
  return Object.keys(MONTHS).find((stem) => lower.includes(stem)) ?? null;
}

function stripSchedulingPrefix(text: string) {
  return tidy(text
    .replace(/^\s*(?:сегодня|завтра)\s*/i, "")
    .replace(/^\s*(?:в\s+)?(?:понедельник|понедельника|вторник|вторника|среду|среда|четверг|пятницу|пятница|субботу|суббота|воскресенье)\s*/i, "")
    .replace(/\bпо работе\b/ig, "")
    .replace(/\s+/g, " "));
}

export function deterministicRoute(input: string): DeterministicRoute | null {
  const text = tidy(input);
  const lower = text.toLocaleLowerCase("ru-RU");
  if (!text) return null;

  if (/^(?:глаша[,.]?\s*)?(?:открой|открыть)\b/i.test(text)) {
    const service = serviceFromText(text);
    if (service) return { kind: "open_service", service };
  }

  if (/(?:какие|что).*(?:дела|задач|план|у меня).*(?:завтра|сегодня)|(?:что у меня завтра|что у меня сегодня)/i.test(text)) {
    return { kind: "query_schedule", range: /завтра/i.test(text) ? "tomorrow" : "today" };
  }

  if (/(?:найди|покажи).*(?:паспорт|документ|полис|страхов|договор|свидетельств|справк)/i.test(text)) {
    const query = tidy(text
      .replace(/^.*?(?:найди|покажи)\s+/i, "")
      .replace(/\b(?:мой|мою|мои|мне)\b/ig, ""));
    return { kind: "find_document", query: query || "документ" };
  }

  if (/^позвони\s+/i.test(text) && !hasFutureCue(text)) {
    const contactName = tidy(text.replace(/^позвони\s+/i, "").replace(/\s+сейчас$/i, ""));
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

  const expense = text.match(/(?:потратил[аи]?|заплатил[аи]?|расход(?:ы)?)[^\d]{0,24}(\d+(?:[.,]\d{1,2})?)\s*(?:₽|р\.?|руб(?:ль|ля|лей)?\.?)?(?:\s+на)?\s+(.+)/i);
  if (expense) {
    const amount = Number(expense[1].replace(",", "."));
    const note = tidy(expense[2]);
    if (Number.isFinite(amount) && amount >= 0 && note) {
      return { kind: "create_expense", amount, note, categorySlug: categoryFromText(note) };
    }
  }

  if (/(?:сколько|какие).*потрат|расходы.*(?:за|в)/i.test(text)) {
    return {
      kind: "query_expenses",
      categorySlug: categoryFromText(text),
      monthToken: monthFromText(text),
    };
  }

  const token = dateToken(text);
  const time = timeToken(text);

  if (/(?:записан[аы]?|записал[аи]?сь)\s+(?:к|на)\s+врач|\bврач\b.*(?:завтра|сегодня|пятниц|сред|четверг|вторник|понедельник|суббот|воскрес)/i.test(text)) {
    if (token) {
      const doctorMatch = text.match(/(?:к|на)\s+(?:врачу|врач|при[её]м)(?:\s+([^,.]+?))?(?=\s+(?:сегодня|завтра|в\s+\d|в\s+(?:понедельник|вторник|сред|четверг|пятниц|суббот|воскрес))|$)/i);
      const title = doctorMatch?.[1] ? `Врач: ${tidy(doctorMatch[1])}` : "Врач";
      return { kind: "create_appointment", title, dateToken: token, time };
    }
  }

  if (/(?:была|был|сделал[аи]?|прошла|прош[её]л).*трениров|тренировал[асься]/i.test(text)) {
    return { kind: "log_fitness", dateToken: token || "today", time };
  }

  if (/начал[исьось]+.*месяч|начал[асься]+.*цикл|месячные\s+начал/i.test(lower)) {
    return { kind: "cycle_start", dateToken: token || "today" };
  }

  if (/(?:могу\s+я|свободно\s+ли|есть\s+ли\s+окно).*(?:записаться|поставить|встретиться|в\s+\d)/i.test(text)) {
    if (token && time) return { kind: "check_availability", dateToken: token, time, durationMinutes: 60 };
  }

  if (token && /\b(?:позвонить|отправить|сделать|купить|забрать|подготовить|написать|оплатить|пройти|заниматься)\b/i.test(text)) {
    const title = stripSchedulingPrefix(text);
    const work = /по работе|бухгалтер|клиент|договор|рабоч|офис|презентац/i.test(text);
    return { kind: "create_task", title, area: work ? "work" : "personal", dateToken: token, time };
  }

  if (/^найди\s+билет/i.test(text)) {
    const body = tidy(text.replace(/^найди\s+билет(?:ы)?\s*/i, ""));
    const routeMatch = body.match(/^(.+?)\s+[—–-]\s+(.+)$/);
    if (routeMatch) {
      const from = tidy(routeMatch[1]);
      let rest = tidy(routeMatch[2]);
      const travelDate = dateToken(rest);
      const after = rest.match(/\bпосле\s+([01]?\d|2[0-3])(?::([0-5]\d))?/i);
      const afterTime = after ? `${String(Number(after[1])).padStart(2, "0")}:${after[2] || "00"}` : null;
      rest = tidy(rest
        .replace(/\b(?:сегодня|завтра)\b/ig, "")
        .replace(/\b(?:в\s+)?(?:понедельник|вторник|среду|среда|четверг|пятницу|пятница|субботу|суббота|воскресенье)\b/ig, "")
        .replace(/\bпосле\s+([01]?\d|2[0-3])(?::[0-5]\d)?/ig, ""));
      if (from && rest && travelDate) {
        return { kind: "search_tickets", from, to: rest, dateToken: travelDate, afterTime };
      }
    }
  }

  if (/разбери.*недел|стратег|план.*подготов|что.*сделать.*цели/i.test(text)) {
    const goal = text.match(/(?:цели?|подготовк[аи]\s+к)\s+([A-Za-zА-Яа-яЁё0-9-]+)/i)?.[1] ?? null;
    return { kind: "advice", goalTitle: goal, explicitDeep: /стратег|разбери.*недел|сравни|вариант/i.test(text) };
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

  const target = WEEKDAYS[token.toLocaleLowerCase("ru-RU")];
  if (target == null) return today;
  const current = base.getUTCDay();
  let delta = (target - current + 7) % 7;
  if (delta === 0) delta = 7;
  base.setUTCDate(base.getUTCDate() + delta);
  return base.toISOString().slice(0, 10);
}

export function resolveMonthBounds(monthToken: string | null, timezone: string) {
  if (!monthToken) return null;
  const stem = Object.keys(MONTHS).find((key) => monthToken.startsWith(key) || key.startsWith(monthToken));
  if (!stem) return null;
  const month = MONTHS[stem];
  const year = Number(currentLocalDate(timezone).slice(0, 4));
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(year, month, 0));
  return { start, end: endDate.toISOString().slice(0, 10) };
}
