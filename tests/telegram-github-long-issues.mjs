import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const file = readFileSync("supabase/functions/telegram-github-issues/index.ts", "utf8");

function extract(start, end) {
  const first = file.indexOf(start), last = file.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, "Expected source function not found");
  return file.slice(first, last);
}
// Test the actual formatting and combining helpers, not reimplementations.
const combineSource = extract("function combineTaskText(", "function rawDraft(")
  .replace("previous: string, incoming: string): string | null", "previous, incoming)");
const rawSource = extract("function rawDraft(", "async function makeDraft(")
  .replace("input: string): IssueDraft", "input)");
const formattedSource = extract("function formatIssue(", "async function githubRequest(")
  .replace("draft: IssueDraft, marker: string, screenshotUrls: string[] = [], originalText = \"\"",
           "draft, marker, screenshotUrls = [], originalText = \"\"")
  .replace("const descriptions: Record<string, string> =", "const descriptions =")
  .replace("const parts: string[] = [];", "const parts = [];");
const { rawDraft, formatIssue, combineTaskText } = runInNewContext(
  "const MAX_TASK_LENGTH = 50000;\n" + combineSource + "\n" + rawSource + "\n" +
    formattedSource + "\n({ rawDraft, formatIssue, combineTaskText })"
);

const marker = "<!-- gym-telegram-task:regression -->";
const original = [
  "Правки по приложению Gym App",
  ...Array.from({ length: 120 }, (_, i) =>
    "Упражнение " + (i + 1) + ": при смене вариации обязательно сохранить технику, теги и веса."),
].join("\n");
assert.ok(original.length > 6000 && original.length < 12000);
const raw = rawDraft(original);
assert.equal(raw.tasks[0], original);
const plain = formatIssue(raw, marker, [], original);
assert.ok(plain.includes(original));
assert.ok(plain.includes(marker));
assert.ok(plain.length < 60000);
assert.equal(plain.split(original).length - 1, 1, "Raw original should not be repeated");

const prepared = {
  title: "Краткое ТЗ", problem: "",
  tasks: ["Отобразить технику"], criteria: ["Техника видна"],
  priority: "P2",
};
const formatted = formatIssue(prepared, marker, [], original);
assert.ok(formatted.includes("## Исходное описание (дословно)"));
assert.ok(formatted.includes(original));
assert.ok(formatted.includes("## Критерии готовности"));
assert.ok(formatted.length < 60000);

// The maximum-size task fits safely in a single GitHub Issue body.
const large = "Подробное ТЗ:\n" + "Ж".repeat(50000 - "Подробное ТЗ:\n".length);
assert.equal(large.length, 50000);
const largeBody = formatIssue(rawDraft(large), marker, [], large);
assert.ok(largeBody.includes(large));
assert.equal(largeBody.split(large).length - 1, 1);
assert.ok(largeBody.length < 60000, "50k source should fit without duplicates");

// The 13th Telegram message can fill remaining space, but no more.
let collected = "";
for (let i = 0; i < 13; i++) {
  const toSend = Math.min(4000, 50000 - collected.length - (collected ? 2 : 0));
  assert.ok(toSend > 0);
  collected = combineTaskText(collected, "Я".repeat(toSend));
  assert.ok(collected);
}
assert.equal(collected.length, 50000);
assert.equal(combineTaskText(collected, "ещё"), null);
assert.equal(combineTaskText("готово", "ещё"), "готово\n\nещё");
assert.equal(combineTaskText("", large), large);

assert.match(file, /const MAX_TASK_LENGTH = 50000/);
assert.match(file, /const MAX_AI_INPUT_LENGTH = 12000/);
assert.match(file, /const MAX_ISSUE_BODY_LENGTH = 60000/);
assert.match(file, /description.length > MAX_TASK_LENGTH/);
assert.match(file, /description = combineTaskText\(/);
assert.match(file, /body.length > MAX_ISSUE_BODY_LENGTH/);
assert.match(file, /max_tokens: 8000/);
assert.match(file, /draft = rawDraft\(description\)/);
assert.match(file, /createIssue\(repositoryToken, project, draft, marker, screenshots, description\)/);
assert.match(file, /Длинное ТЗ добавлено целиком без обработки Claude/);
assert.match(file, /Claude не оформил текст/);
console.log("50,000-character Telegram Issues remain complete, unduplicated and within body limits.");
