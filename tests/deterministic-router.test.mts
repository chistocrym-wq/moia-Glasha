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
