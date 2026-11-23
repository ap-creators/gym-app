import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// Windows checkouts get CRLF: the multi-line matches below are written with \n.
const read = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

// Issue #124: notes from earlier workouts are seen during a workout. The empty note field shows the
// last one in grey, like last time's weight, and a button beside the field lists them all.

// --- Loading. A stand-in for supabase-js that answers from these tables.
const tables = {
  workout_sessions: [
    { id: 'current', status: 'active', started_at: '2026-11-23T10:00:00+00:00', ended_at: null },
    { id: 'old', status: 'completed', started_at: '2026-09-01T10:00:00+00:00', ended_at: '2026-09-01T11:00:00+00:00' },
    { id: 'mid', status: 'completed', started_at: '2026-11-09T10:00:00+00:00', ended_at: '2026-11-09T11:00:00+00:00' },
    { id: 'last', status: 'completed', started_at: '2026-11-16T10:00:00+00:00', ended_at: '2026-11-16T11:00:00+00:00' },
    { id: 'gave-up', status: 'abandoned', started_at: '2026-11-20T10:00:00+00:00', ended_at: '2026-11-20T10:10:00+00:00' },
  ],
  workout_session_exercises: [
    { id: 'leg-old', workout_session_id: 'old', exercise_id: 'leg-extension', exercise_name_snapshot: 'Разгибание ног', position: 1, note: 'Сиденье 4, валик 2' },
    { id: 'leg-mid-2', workout_session_id: 'mid', exercise_id: 'leg-extension', exercise_name_snapshot: 'Разгибание ног', position: 7, note: 'Второй заход, легче' },
    { id: 'leg-mid', workout_session_id: 'mid', exercise_id: 'leg-extension', exercise_name_snapshot: 'Разгибание ног', position: 5, note: '  В следующий раз +2,5 кг \n' },
    { id: 'leg-last', workout_session_id: 'last', exercise_id: 'leg-extension', exercise_name_snapshot: 'Разгибание ног', position: 5, note: '   ' },
    { id: 'leg-gave-up', workout_session_id: 'gave-up', exercise_id: 'leg-extension', exercise_name_snapshot: 'Разгибание ног', position: 1, note: 'Из брошенной тренировки' },
    { id: 'leg-current', workout_session_id: 'current', exercise_id: 'leg-extension', exercise_name_snapshot: 'Разгибание ног', position: 5, note: 'Пишу сейчас' },
    { id: 'custom-old', workout_session_id: 'old', exercise_id: null, exercise_name_snapshot: 'Моё упражнение', position: 2, note: 'Своё: держать паузу' },
    { id: 'row-last', workout_session_id: 'last', exercise_id: 'row', exercise_name_snapshot: 'Тяга блока', position: 6, note: null },
    { id: 'squat-last', workout_session_id: 'last', exercise_id: 'squat', exercise_name_snapshot: 'Присед', position: 1, note: 'Не из этой тренировки' },
  ],
};
const requests = [];
function query(table) {
  const filters = [];
  let joined = false;
  const value = (row, key) => key.split('.').reduce((current, part) => current?.[part], row);
  const builder = {
    select(columns = '') { joined = /workout_sessions!inner\(/.test(columns); return builder; },
    eq(key, wanted) { filters.push((row) => value(row, key) === wanted); return builder; },
    neq(key, wanted) { filters.push((row) => value(row, key) !== wanted); return builder; },
    not(key, operator, wanted) { assert.equal(operator, 'is'); filters.push((row) => value(row, key) !== wanted); return builder; },
    then(resolve, reject) {
      requests.push(table);
      let rows = tables[table];
      // An inner join: a row without its session is dropped, the others carry it.
      if (joined) rows = rows.map((row) => ({ ...row, workout_sessions: tables.workout_sessions.find((session) => session.id === row.workout_session_id) })).filter((row) => row.workout_sessions);
      return Promise.resolve({ data: rows.filter((row) => filters.every((test) => test(row))), error: null }).then(resolve, reject);
    },
  };
  return builder;
}
globalThis.__pastNotesTest = { client: { from: query }, resilience: await import('../src/lib/requestResilience.js'), results: await import('../src/lib/exerciseResultsV2.js') };
const sessionsSource = read('src/lib/workoutSessions.js')
  .replace("import { supabase } from './supabase.js';", 'const supabase=globalThis.__pastNotesTest.client;')
  .replace("import { validateResultV2 } from './exerciseResultsV2.js';", 'const {validateResultV2}=globalThis.__pastNotesTest.results;')
  .replace(/import \{([^}]*)\} from '\.\/requestResilience\.js';/, 'const {$1}=globalThis.__pastNotesTest.resilience;');
const { getPastExerciseNotes } = await import(`data:text/javascript;base64,${Buffer.from(sessionsSource).toString('base64')}`);

const found = await getPastExerciseNotes(['leg-extension', 'snapshot:Моё упражнение', 'row', 'new-exercise', 'leg-extension'], 'current');
assert.deepEqual(requests, ['workout_session_exercises'], 'one request for the whole workout');
assert.deepEqual(found.get('leg-extension'), [
  { id: 'leg-mid', date: '2026-11-09T11:00:00+00:00', note: 'В следующий раз +2,5 кг' },
  { id: 'leg-mid-2', date: '2026-11-09T11:00:00+00:00', note: 'Второй заход, легче' },
  { id: 'leg-old', date: '2026-09-01T11:00:00+00:00', note: 'Сиденье 4, валик 2' },
], 'newest first, two cards of one workout in their order; an empty note, an abandoned workout and the open one do not count');
assert.deepEqual(found.get('snapshot:Моё упражнение'), [{ id: 'custom-old', date: '2026-09-01T11:00:00+00:00', note: 'Своё: держать паузу' }], 'an exercise without a catalog id is found by its name');
assert.equal(found.has('row'), false, 'an exercise without notes gets nothing');
assert.equal(found.has('new-exercise'), false, 'an exercise never done gets nothing');
assert.equal(found.has('squat'), false, 'only the exercises of this workout');
requests.length = 0;
assert.equal((await getPastExerciseNotes([], 'current')).size, 0);
assert.deepEqual(requests, [], 'a workout without exercises asks for nothing');

// --- Wiring on the workout screen.
const screen = read('src/components/WorkoutSessionScreenV3.jsx');
assert.match(screen, /import '\.\.\/workout-past-notes\.css';/);
assert.match(screen, /const \[pastNotes, setPastNotes\] = useState\(null\);/, 'null until the notes load');
assert.match(screen, /getPastExerciseNotes\(JSON\.parse\(previousKeys\), session\.id\)\.then\(\(found\) => \{ if \(active\) setPastNotes\(found\); \}\)\.catch\(\(\) => \{\}\)/,
  'past notes load once per workout and a failure leaves the field with its ellipsis, without an error');
assert.match(screen, /const exerciseNotes = pastNotes\?\.get\(String\(exercise\.exerciseId\)\) \?\? \[\];/);
const cardStart = screen.indexOf('<article className="workout-exercise-card v3"');
const card = screen.slice(cardStart, screen.indexOf('</article>', cardStart));
// The last note is laid over the field while it is empty: typing removes it, and it is never saved by itself.
assert.match(card, /<\/label>\{exerciseNotes\[0\] && !exercise\.note && <span className="exercise-card-note-last">\{exerciseNotes\[0\]\.note\}<\/span>\}<button/);
assert.match(card, /<textarea className="exercise-card-note" rows="1" value=\{exercise\.note \?\? ''\} placeholder="…"/, 'the field keeps its own placeholder');
assert.doesNotMatch(screen, /note: exerciseNotes|note: pastNotes/, 'a past note is never copied into the new workout');
// The button with the notes icon sits beside the field, in the same row, and ends the card.
assert.match(card, /<div className="exercise-card-note-row"><label className="exercise-card-note-field">/);
assert.match(card, /<\/span>\}<button className=\{`exercise-card-past-notes\$\{exerciseNotes\.length \? '' : ' empty'\}`\} type="button" aria-label="Прошлые заметки" onClick=\{\(\) => openPastNotes\(exercise\)\}><NotesHistoryIcon \/><\/button><\/div>$/);
// Its icon is its own: neither the clock of «История» nor the info icon.
assert.match(screen, /function NotesHistoryIcon\(\) \{ return <svg viewBox="0 0 24 24"/);
assert.equal(card.match(/<HistoryIcon \/>/g).length, 1, '«История» keeps its own icon');
// Notes that did not load with the workout are asked for again before the sheet says there are none.
const open = screen.slice(screen.indexOf('async function openPastNotes('), screen.indexOf('async function openHistory('));
assert.match(open, /if \(!notes\) \{ try \{ notes = await getPastExerciseNotes\(JSON\.parse\(previousKeys\), session\.id\); setPastNotes\(notes\); \} catch \(e\) \{ setLocalError\(e\.message\); return; \} \}/);
assert.match(open, /setPastNotesView\(\{ exerciseName: exercise\.name, notes: notes\.get\(String\(exercise\.exerciseId\)\) \?\? \[\] \}\);/);
// The sheet: every note in full under its date, or a line saying there are none.
const modal = screen.slice(screen.indexOf('function PastNotesModal('), screen.indexOf('function HistoryModal('));
assert.match(modal, /<span>Прошлые заметки<\/span><h3>\{exerciseName\}<\/h3>/);
assert.match(modal, /notes\.length === 0 \? <p className="history-empty">В прошлых тренировках заметок к этому упражнению нет\.<\/p>/);
assert.match(modal, /<ul className="past-notes-list">\{notes\.map\(\(item\) => <li key=\{item\.id\}><span>\{formatHistoryDate\(item\.date\)\}<\/span><p>\{item\.note\}<\/p><\/li>\)\}<\/ul>/);
assert.match(screen, /\{pastNotesView && <PastNotesModal exerciseName=\{pastNotesView\.exerciseName\} notes=\{pastNotesView\.notes\} onClose=\{\(\) => setPastNotesView\(null\)\} \/>\}/);
// «История» still shows results only.
assert.doesNotMatch(screen.slice(screen.indexOf('function HistoryModal('), screen.indexOf('function WeightUnitQuestion(')), /notes/i);

// --- Styles: the type scale and theme tokens only, so everything follows the dark theme.
const css = read('src/workout-past-notes.css');
const rule = (selector) => {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `missing rule ${selector}`);
  return css.slice(start, css.indexOf('}', start));
};
// The button is as high as the one-line field (36px) and level with it, under the caption.
assert.match(rule('.exercise-card-note-row'), /grid-template-columns: minmax\(0, 1fr\) 36px;[\s\S]*align-items: start;/);
assert.match(rule('.exercise-card-past-notes'), /width: 36px;\s*height: 36px;\s*margin-top: calc\(var\(--lh-micro\) \+ var\(--space-1\)\);[\s\S]*border: 0;[\s\S]*background: var\(--surface-2\);\s*color: var\(--ink\);/);
assert.match(rule('.exercise-card-past-notes.empty'), /color: var\(--muted\);/);
assert.match(read('src/workout-exercise-card.css'), /\.exercise-card-note \{[^}]*min-height: 36px;/);
// The grey note looks like the grey weights (#100) and stays one line with an ellipsis: the field keeps its height.
const last = rule('.exercise-card-note-last');
assert.match(last, /position: absolute;/);
assert.match(rule('.exercise-card-note-row'), /position: relative;/);
assert.match(last, /overflow: hidden;[\s\S]*white-space: nowrap;\s*text-overflow: ellipsis;/);
assert.match(last, /color: var\(--muted\);[\s\S]*font-weight: var\(--weight-medium\);[\s\S]*opacity: \.75;/);
// It starts where the field's text starts and never takes a tap from the field.
assert.match(last, /top: calc\(var\(--lh-micro\) \+ var\(--space-1\) \+ 8px\);\s*left: 13px;\s*right: calc\(36px \+ 6px \+ 13px\);/);
assert.match(last, /font-size: 16px;\s*line-height: 20px;/);
assert.match(last, /pointer-events: none;/);
assert.match(read('src/workout-exercise-card.css'), /\.exercise-card-note \{[^}]*padding: 7px 12px;\s*border: 1px solid var\(--line\);[^}]*font-size: 16px;\s*line-height: 20px;/);
// The field's own «…» is hidden under it.
assert.match(css, /\.exercise-card-note-row:has\(\.exercise-card-note-last\) \.exercise-card-note::placeholder \{ color: transparent; \}/);
assert.match(read('src/workout-previous-hints.css'), /font-weight: var\(--weight-medium\);\s*opacity: \.75;/);
// In the sheet a note is never cut and keeps its line breaks.
assert.match(rule('.past-notes-list p'), /white-space: pre-line;\s*overflow-wrap: anywhere;/);
assert.doesNotMatch(css, /line-clamp/);
for (const [, selector, size] of css.matchAll(/([^{}]+)\{[^}]*font-size: ([^;]+);/g)) {
  // 16px only for the grey note, which repeats the field's text size.
  if (size === '16px') assert.match(selector, /\.exercise-card-note-last\s*$/, `${selector.trim()} must use the scale`);
  else assert.match(size, /^var\(--text-(micro|caption|body)\)$/, `font-size ${size} is outside the scale`);
}
for (const [, weight] of css.matchAll(/font-weight: ([^;]+);/g)) assert.match(weight, /^var\(--weight-/);
assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /#[0-9a-f]{3,8}\b|rgba?\(/i, 'colours come from theme tokens');

// --- The stand shows it with `previous=1`.
assert.match(read('tests/ui/workout-mock-services.js'), /export async function getPastExerciseNotes\(exerciseKeys\)/);

console.log('workout past notes ok');
