// The GitHub account that owns the repositories was renamed (issue #139).
// The old login only works through GitHub's redirect, and anyone can register
// it again, so no source file may keep pointing at it.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const OWNER = "ap-creators";
// Split so that this file does not match its own search.
const OLD_OWNER = "pavel" + "mashina";

const ROOTS = ["docs", "supabase", "src", "public", "scripts", "tests", ".github"];
const ROOT_FILES = ["README.md", "index.html", "package.json", "vite.config.js"];
const TEXT = new Set([".md", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".json", ".yml", ".yaml", ".html", ".css", ".sql", ".toml", ".webmanifest", ".txt"]);

function walk(dir, found = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return found; }
  for (const name of entries) {
    if (name === "node_modules" || name === ".git") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (TEXT.has(extname(name))) found.push(path);
  }
  return found;
}

const files = [...ROOTS.flatMap((root) => walk(root)), ...ROOT_FILES];
const stale = [];
for (const path of files) {
  let text;
  try { text = readFileSync(path, "utf8"); } catch { continue; }
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.includes(OLD_OWNER)) stale.push(`${path}:${index + 1}`);
  });
}
assert.deepEqual(stale, [], `The old account name is still mentioned in: ${stale.join(", ")}`);

// The bot creates issues through the API path built from these names.
const bot = readFileSync("supabase/functions/telegram-github-issues/index.ts", "utf8");
assert.ok(bot.includes(`"gym-app": { fullName: "${OWNER}/gym-app"`), "The bot must create Gym App issues in the renamed account");
assert.ok(bot.includes(`"ryadom-app": { fullName: "${OWNER}/ryadom-app"`), "The bot must create Рядом issues in the renamed account");
assert.ok(bot.includes(`Проекты: ${OWNER}/gym-app и ${OWNER}/ryadom-app.`), "The bot rules must name the repositories as they are now");

// Push services show this contact address to whoever investigates a sender.
const reminders = readFileSync("supabase/functions/send-workout-reminders/index.ts", "utf8");
assert.ok(reminders.includes(`setVapidDetails("https://github.com/${OWNER}/gym-app"`), "The push contact address must lead to the existing repository");

console.log(`repository owner: ${files.length} files name only ${OWNER}`);
