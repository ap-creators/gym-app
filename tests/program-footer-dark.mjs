import assert from 'node:assert/strict';
import fs from 'node:fs';

// On the dark theme the bottom action bar of the program detail was a white strip, and
// «Редактировать программу» / «Начать программу» / «Присоединиться к программе» were unreadable:
// the bar is a hard-coded white, the filled buttons write #fff on --ink, and the secondary
// button sits on --accent-soft, which the dark theme does not redefine.
const read = (path) => fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

const css = read('src/program-footer-dark.css');
const base = read('src/program-detail.css');
const main = read('src/main.jsx');
const owned = read('src/components/ProgramDetailScreen.jsx');
const catalog = read('src/components/CatalogProgramsPanel.jsx');
const settings = read('src/settings-screen.css');
const pkg = read('package.json');

// --- Why the override is needed: the base rules are literal, and the dark theme keeps --accent-soft. ---
assert.match(base, /\.program-detail-footer \{[^}]*background: rgba\(255, 255, 255, 0\.96\);/);
assert.match(base, /\.program-detail-start-button \{\s*background: var\(--ink\);\s*color: #fff;/);
assert.match(base, /\.program-detail-edit-button \{\s*background: var\(--accent-soft\);/);
const darkTokens = settings.match(/html\[data-theme='dark'\],html\[data-theme='dark'\] body\{[^}]*\}/)?.[0] ?? '';
assert.match(darkTokens, /--surface:/);
assert.doesNotMatch(darkTokens, /--accent-soft:/, 'If the dark theme starts defining --accent-soft, revisit the secondary button.');

// --- Only the dark theme is touched: the light theme cannot change. ---
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
const selectors = rules.split('}').map((rule) => rule.split('{')[0].trim()).filter(Boolean)
  .flatMap((group) => group.split(',').map((selector) => selector.trim()));
assert.ok(selectors.length >= 4);
for (const selector of selectors) {
  assert.ok(selector.startsWith("html[data-theme='dark'] "), `Dark-only selector expected: ${selector}`);
}
assert.doesNotMatch(rules, /#[0-9a-f]{3,8}\b|rgba?\(/i, 'Colours come from theme tokens.');
assert.doesNotMatch(rules, /!important/);

// --- The bar and its buttons on the dark theme. ---
assert.match(rules, /html\[data-theme='dark'\] \.program-detail-footer \{\s*background: color-mix\(in srgb, var\(--surface\) 96%, transparent\);/,
  'The bar takes the dark surface and keeps its 96% see-through blur.');
assert.match(rules, /html\[data-theme='dark'\] \.program-detail-start-button,\s*html\[data-theme='dark'\] \.program-detail-footer:not\(\.two-actions\) \.program-detail-edit-button \{\s*color: var\(--surface\);/,
  'A filled button writes the dark surface colour on the light --ink plate.');
assert.match(rules, /html\[data-theme='dark'\] \.program-detail-footer\.two-actions \.program-detail-edit-button \{\s*background: color-mix\(in srgb, var\(--ink\) 14%, var\(--surface\)\);\s*color: var\(--ink\);/,
  'The secondary button is a dimmed --ink plate with light text.');

// --- The stylesheet is loaded after the global layers, and both screens still use the bar. ---
assert.ok(main.includes("import './program-footer-dark.css';"));
assert.ok(main.indexOf("import './program-footer-dark.css';") > main.indexOf("import './training-program-polish.css';"));
assert.match(owned, /<footer className=\{`program-detail-footer\$\{canStart && canEditProgram \? ' two-actions' : ''\}`\}>/);
assert.match(owned, /<button className="program-detail-start-button"/);
assert.match(owned, /<button className="program-detail-edit-button"/);
assert.match(catalog, /<footer className="program-detail-footer catalog-unified-footer"><button className="program-detail-start-button"/);

assert.match(pkg, /node tests\/program-footer-dark\.mjs/, 'The check is registered in package.json.');
console.log('Program detail bottom bar on the dark theme verified.');
