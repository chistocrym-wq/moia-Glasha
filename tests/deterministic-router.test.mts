import assert from "node:assert/strict";
import { deterministicRoute } from "../src/lib/deterministic-router.ts";

const cases = [
  ["Открой Tutu", "open_service"],
  ["Какие дела завтра?", "query_schedule"],
  ["Найди мой паспорт", "find_document"],
  ["Позвони Кайрату", "contact_action"],
  ["Потратила 70 рублей на кофе", "create_expense"],
  ["Завтра по работе позвонить бухгалтеру", "create_task"],
  ["Я записана к врачу завтра в 16:30", "create_appointment"],
  ["Сегодня была тренировка", "log_fitness"],
  ["Могу я завтра в 15:00 записаться к врачу?", "check_availability"],
  ["Разбери мою неделю и предложи стратегию подготовки к B1", "advice"],
  ["Найди билеты Москва — Петербург завтра", "search_tickets"],
  ["Перенеси задачу про договор в работу", "move_task"],
  ["Это личное, а не рабочее", "move_task"],
  ["Разбей задачу Подготовить презентацию на этапы", "split_task"],
  ["Открой Мой супербанк", "open_service"],
  ["Напомни завтра в 10 оплатить интернет", "create_reminder"],
  ["Покажи просроченные", "query_overdue"],
  ["Найди проект Переезд", "global_search"],
  ["Отметь задачу Подать документы выполненной", "complete_task"],
  ["Верни задачу Подать документы в дела", "restore_task"],
  ["Покажи мои достижения", "query_achievements"],
  ["Что я сделала за последние 14 дней?", "query_achievements"],
] as const;

for (const [text, expected] of cases) {
  const route = deterministicRoute(text);
  assert.ok(route, `No deterministic route for: ${text}`);
  assert.equal(route.kind, expected, `Wrong route for: ${text}`);
}

const expense = deterministicRoute("Потратила 70 рублей на кофе");
assert.equal(expense?.kind, "create_expense");
if (expense?.kind === "create_expense") {
  assert.equal(expense.amount, 70);
  assert.equal(expense.categorySlug, "coffee_cafes");
}

const task = deterministicRoute("Завтра по работе позвонить бухгалтеру");
assert.equal(task?.kind, "create_task");
if (task?.kind === "create_task") {
  assert.equal(task.area, "work");
  assert.equal(task.dateToken, "tomorrow");
}

console.log(`deterministic-router: ${cases.length} cases PASS`);


const move = deterministicRoute("Перенеси задачу про договор в работу");
assert.equal(move?.kind, "move_task");
if (move?.kind === "move_task") {
  assert.equal(move.taskQuery, "договор");
  assert.equal(move.area, "work");
}

const correction = deterministicRoute("Это личное, а не рабочее");
assert.equal(correction?.kind, "move_task");
if (correction?.kind === "move_task") {
  assert.equal(correction.taskQuery, null);
  assert.equal(correction.area, "personal");
}

const split = deterministicRoute("Разбей задачу Подготовить презентацию на этапы");
assert.equal(split?.kind, "split_task");

const arbitraryApp = deterministicRoute("Открой Мой супербанк");
assert.equal(arbitraryApp?.kind, "open_service");
if (arbitraryApp?.kind === "open_service") assert.equal(arbitraryApp.service, "Мой супербанк");


const reminder = deterministicRoute("Напомни завтра в 10 оплатить интернет");
assert.equal(reminder?.kind, "create_reminder");
if (reminder?.kind === "create_reminder") {
  assert.equal(reminder.dateToken, "tomorrow");
  assert.equal(reminder.time, "10:00");
  assert.equal(reminder.title.toLocaleLowerCase("ru-RU"), "оплатить интернет");
  assert.equal(reminder.recurrence, "none");
}

const recurring = deterministicRoute("Напоминай каждый день в 09:00 пить витамины");
assert.equal(recurring?.kind, "create_reminder");
if (recurring?.kind === "create_reminder") assert.equal(recurring.recurrence, "daily");


const completed = deterministicRoute("Отметь задачу Подать документы выполненной");
assert.equal(completed?.kind, "complete_task");
if (completed?.kind === "complete_task") assert.equal(completed.taskQuery, "Подать документы");

const restored = deterministicRoute("Верни задачу Подать документы в дела");
assert.equal(restored?.kind, "restore_task");
if (restored?.kind === "restore_task") assert.equal(restored.taskQuery, "Подать документы");
