import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const file = readFileSync("supabase/functions/telegram-github-issues/index.ts", "utf8");

// Execute the actual pure formatting helpers, not duplicated test versions.
// Strip only TypeScript type declarations needed for Node's VM.
function extract(start, end) {
  const first = file.indexOf(start), last = file.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, "Expected source function not found");
  return file.slice(first, last);
}
const rawSource = extract("function rawDraft(", "async function makeDraft(")
  .replace("input: string): IssueDraft", "input)");
const formattedSource = extract("function formatIssue(", "async function githubRequest(")
  .replace("draft: IssueDraft, marker: string, screenshotUrls: string[] = [], originalText = \"\"",
           "draft, marker, screenshotUrls = [], originalText = \"\"")
  .replace("const descriptions: Record<string, string> =", "const descriptions =")
  .replace("const parts: string[] = [];", "const parts = [];");
const helpers = runInNewContext(
  rawSource + "\n" + formattedSource + "\n({ rawDraft, formatIssue })"
);
const { rawDraft, formatIssue } = helpers;
const original = [
  "Правки по приложению Gym App",
  ...Array.from({ length: 180 }, (_, i) =>
    "Упражнение " + (i + 1) + ": при смене вариации обязательно сохранить технику, теги и веса."),
].join("\n");
assert.ok(original.length > 6000 && original.length < 12000);
const marker = "<!-- gym-telegram-task:regression -->";
const raw = rawDraft(original);
assert.equal(raw.tasks[0], original);
const plain = formatIssue(raw, marker, [], original);
assert.ok(plain.includes(original));
assert.ok(plain.includes(marker));
assert.ok(plain.length < 65536);

const prepared = {
  title: "Краткое ТЗ", problem: "",
  tasks: ["Отобразить технику"], criteria: ["Техника видна"],
  priority: "P2",
};
const formatted = formatIssue(prepared, marker, [], original);
assert.ok(formatted.includes("## Исходное описание (дословно)"));
assert.ok(formatted.includes(original));
assert.ok(formatted.includes("## Критерии готовности"));
assert.ok(formatted.length < 65536);

assert.match(file, /max_tokens: 8000/);
assert.match(file, /catch \(error\) \{\s*console\.warn\("Claude formatting unavailable;/);
assert.match(file, /draft = rawDraft\(description\)/);
assert.match(file, /createIssue\(repositoryToken, project, draft, marker, screenshots, description\)/);
assert.match(file, /usedPlainTextFallback \? ".*Claude не оформил текст/);
console.log("Long Telegram description is preserved in both AI and fallback paths.");
