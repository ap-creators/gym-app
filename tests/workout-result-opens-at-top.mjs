import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Issue #125: the result of a finished workout opens at its top, not where the exercise list was scrolled to.
// Windows checkouts get CRLF; comments are dropped so they cannot hide or fake a rule.
const read = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const css = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, '');
const rulesOf = (source) => [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, selector, body]) => ({ selectors: selector.split(',').map((item) => item.trim().replace(/\s+/g, ' ')), body }));

const workout = read('src/components/WorkoutSessionScreenV3.jsx');
const design = read('docs/design-system.md');
const start = workout.indexOf('export function WorkoutSessionScreen(');
assert.notEqual(start, -1, 'WorkoutSessionScreen not found');
const screen = workout.slice(start);

// 1. The plan, the running workout and the result are drawn in one .phone, which the screen can reach.
assert.match(screen, /return <div ref=\{phoneRef\} className=\{`phone workout-session-phone\$\{entry\?\.mode === 'completed' \? ' completed-reference-mode' : ''\}`\}>/,
  'the scrolling .phone of the workout carries phoneRef');
assert.match(screen, /const phoneRef = useRef\(null\);/);

// 2. Every change of state puts that .phone back to its top, before the browser paints the new state.
assert.match(screen, /const mode = entry\?\.mode;/);
assert.match(screen, /useLayoutEffect\(\(\) => \{ if \(phoneRef\.current\) phoneRef\.current\.scrollTop = 0; \}, \[mode\]\);/,
  'the scroll is reset in a layout effect that depends on the state of the workout only');
assert.doesNotMatch(screen, /useEffect\(\(\) => \{[^}]*phoneRef\.current\.scrollTop/, 'a plain effect would show the bottom for a frame');
// Saving an edit of a finished workout reloads the entry in the same state, so it must not jump to the top.
assert.doesNotMatch(screen, /scrollTop = 0; \}, \[entry\]\)/);

// 3. The reset is instant: the workout's .phone does not animate its scroll.
const phoneRules = rulesOf(css('src/workout-session.css')).filter(({ selectors }) => selectors.includes('.phone.workout-session-phone'));
assert.ok(phoneRules.some(({ body }) => /scroll-behavior:\s*auto/.test(body)), '.phone.workout-session-phone keeps scroll-behavior: auto');

// 4. The result has no scroll of its own, so .phone is the container that has to be reset.
for (const file of ['src/workout-session-completed-reference.css', 'src/design-system-audit.css']) {
  for (const { selectors, body } of rulesOf(css(file))) {
    if (!selectors.includes('.completed-reference-screen')) continue;
    assert.doesNotMatch(body, /overflow(-y)?:\s*(auto|scroll)/, `${file}: the result has no scroll of its own`);
    assert.doesNotMatch(body, /position:\s*(fixed|absolute)/, `${file}: the result is not a layer over the workout`);
  }
}

// 5. The decision is written down.
assert.ok(design.includes('## Workout result opens at its top — November 2026 (#125)'), 'docs/design-system.md has the #125 section');

console.log('Workout result opens at top passed.');
