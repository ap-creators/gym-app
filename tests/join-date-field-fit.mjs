// #138: on «Подключение программы» the «Дата начала» field stuck out of its card on iPhones.
// iOS sizes a native date control as a content box, so `width: 100%` plus the side padding
// was wider than the card. The field drops the native appearance and may shrink with its card.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const css = read('src/join-ready-program.css');
const screen = read('src/components/JoinReadyProgramScreen.jsx');

const rule = selector => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = css.match(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`));
  assert.ok(found, `Rule ${selector} exists`);
  return found[1];
};

assert.match(screen, /<div className="ready-program-join-card ready-program-date-card">\s*<label className="ready-program-date-label">\s*<span>Дата начала<\/span>\s*<input type="date"/,
  'The start date is a native date input inside the date card');

const card = rule('.ready-program-join-phone .ready-program-date-card');
assert.match(card, /grid-template-columns: minmax\(0,1fr\);/, 'The card column may be narrower than its content');

const label = rule('.ready-program-join-phone .ready-program-date-label');
assert.match(label, /grid-template-columns: minmax\(0,1fr\);/, 'The label column may be narrower than the input');
assert.match(label, /min-width: 0;/, 'The label does not hold the card open');

const input = rule(".ready-program-join-phone .ready-program-date-label input[type='date']");
assert.match(input, /-webkit-appearance: none;/, 'iOS does not draw its own date pill');
assert.match(input, /(?:^|\s)appearance: none;/, 'Standard property next to the prefixed one');
assert.match(input, /box-sizing: border-box;/, 'Padding and border are inside the width');
assert.match(input, /(?:^|\s)width: 100%;/);
assert.match(input, /min-width: 0;/, 'No intrinsic minimum width');
assert.match(input, /max-width: 100%;/, 'Never wider than the card');
assert.match(input, /min-height: 48px;/, 'Touch target stays 48px without the native appearance');
assert.match(input, /display: flex;/, 'Block-level, so the width applies');
assert.match(input, /align-items: center;/, 'The date stays vertically centred');
assert.match(input, /padding: 0 var\(--space-3\);/, 'Same side padding as «Первая тренировка»');

const preview = rule('.ready-program-join-phone .ready-program-date-preview');
assert.match(preview, /padding: var\(--space-3\);/, 'The date text starts where the preview text starts');

const value = rule(".ready-program-join-phone .ready-program-date-label input[type='date']::-webkit-date-and-time-value");
assert.match(value, /text-align: left;/, 'iOS centres the date by default');
assert.match(value, /min-width: 0;/);
assert.match(value, /margin: 0;/);

console.log('join date field fit: ok');
