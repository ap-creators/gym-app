import assert from 'node:assert/strict';
import fs from 'node:fs';

// «Подключение программы» on the dark theme: the bottom bar was a light strip with an unreadable
// «Подключить программу», «Первая тренировка» was a light block with light text, and the error
// messages kept the dark reds of a white card. The bar is a literal light grey, its button writes
// #fff on --ink, and «Первая тренировка» sits on --accent-soft, which the dark theme does not redefine.
const read = (path) => fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

const css = read('src/join-program-dark.css');
const base = read('src/create-program.css');
const join = read('src/join-ready-program.css');
const schedule = read('src/create-program-schedule.css');
const scheduleList = read('src/program-schedule-list.css');
const main = read('src/main.jsx');
const screen = read('src/components/JoinReadyProgramScreen.jsx');
const settings = read('src/settings-screen.css');
const pkg = read('package.json');

// --- Why the override is needed: the base rules are literal, and the dark theme keeps --accent-soft. ---
assert.match(base, /\.create-program-footer \{[^}]*background: rgba\(243, 243, 240, 0\.96\);/);
assert.match(base, /\.create-program-next \{[^}]*background: var\(--ink\);\s*color: #fff;/);
assert.match(base, /\.create-program-next:disabled \{\s*background: #d7d7d2;\s*color: #999992;/);
assert.match(join, /\.ready-program-join-phone \.ready-program-date-preview \{[^}]*background: var\(--accent-soft\);/);
assert.match(join, /\.ready-program-join-phone \.ready-program-date-error \{[^}]*color: #9a3434;/);
assert.match(schedule, /\.program-schedule-error \{[^}]*background: #fff6f6;\s*color: #8f3030;/);
const darkTokens = settings.match(/html\[data-theme='dark'\],html\[data-theme='dark'\] body\{[^}]*\}/)?.[0] ?? '';
assert.match(darkTokens, /--surface:/);
assert.doesNotMatch(darkTokens, /--accent-soft:/, 'If the dark theme starts defining --accent-soft, revisit «Первая тренировка».');

// --- Only the dark theme and only this screen are touched: the light theme cannot change. ---
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
const selectors = rules.split('}').map((rule) => rule.split('{')[0].trim()).filter(Boolean)
  .flatMap((group) => group.split(',').map((selector) => selector.trim()));
assert.ok(selectors.length >= 7);
for (const selector of selectors) {
  assert.ok(selector.startsWith("html[data-theme='dark'] .ready-program-join-phone"), `Dark-only selector of the join screen expected: ${selector}`);
}
assert.doesNotMatch(rules, /!important/);
const literals = rules.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi) ?? [];
assert.deepEqual(literals, ['#e9958a'], 'The only literal colour is the dark red; everything else comes from theme tokens.');
assert.match(rules, /html\[data-theme='dark'\] \.ready-program-join-phone \{\s*--join-danger: #e9958a;\s*\}/);
assert.match(scheduleList, /html\[data-theme='dark'\] \.owned-schedule-list\{[^}]*--schedule-danger:#e9958a/,
  'The red matches the dark red of the program schedule list.');

// --- The bar and its button. ---
assert.match(rules, /html\[data-theme='dark'\] \.ready-program-join-phone \.ready-program-join-footer \{\s*background: color-mix\(in srgb, var\(--surface\) 96%, transparent\);/,
  'The bar takes the dark surface and keeps its 96% see-through blur.');
assert.match(rules, /html\[data-theme='dark'\] \.ready-program-join-phone \.create-program-next \{\s*color: var\(--surface\);/,
  '«Подключить программу» writes the dark surface colour on the light --ink plate.');
assert.match(rules, /html\[data-theme='dark'\] \.ready-program-join-phone \.create-program-next:disabled \{\s*background: color-mix\(in srgb, var\(--ink\) 14%, var\(--surface\)\);\s*color: var\(--muted\);/,
  'A disabled button is a dimmed plate with muted text, not a light grey one.');

// --- «Первая тренировка» and the error messages. ---
assert.match(rules, /html\[data-theme='dark'\] \.ready-program-join-phone \.ready-program-date-preview \{\s*background: color-mix\(in srgb, var\(--ink\) 14%, var\(--surface\)\);/,
  '«Первая тренировка» is a dimmed --ink plate, so its light text reads.');
assert.match(rules, /html\[data-theme='dark'\] \.ready-program-join-phone \.ready-program-date-error \{\s*color: var\(--join-danger\);/);
assert.match(rules, /html\[data-theme='dark'\] \.ready-program-join-phone \.program-schedule-error \{\s*border-color: color-mix\(in srgb, var\(--join-danger\) 40%, var\(--surface\)\);\s*background: color-mix\(in srgb, var\(--join-danger\) 14%, var\(--surface\)\);\s*color: var\(--join-danger\);/,
  'The save error is a dark red-tinted plate instead of a near-white one.');

// --- The stylesheet is loaded after the global layers, and the screen still uses these blocks. ---
assert.ok(main.includes("import './join-program-dark.css';"));
assert.ok(main.indexOf("import './join-program-dark.css';") > main.indexOf("import './training-program-polish.css';"));
assert.match(screen, /<div className="phone create-program-phone ready-program-join-phone">/);
assert.match(screen, /<footer className="create-program-footer ready-program-join-footer">\s*<button className="create-program-next"/);
assert.match(screen, /<div className="ready-program-date-preview">/);
assert.match(screen, /<p className="ready-program-date-error">/);
assert.match(screen, /<div className="program-schedule-error" role="alert">/);

assert.match(pkg, /node tests\/join-program-dark\.mjs/, 'The check is registered in package.json.');
console.log('«Подключение программы» on the dark theme verified.');
