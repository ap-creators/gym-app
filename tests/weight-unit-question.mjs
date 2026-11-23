import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pastUnitPeriodsAfterSwitch, pastWeightUnit, toDisplayWeight, withUnitIfOther } from '../src/lib/weightUnits.js';

// Issue #123: switching «кг» ↔ «lbs» never converts past workouts on its own. The switch asks
// «Пересчитать прошлые тренировки?»; «Нет» leaves them in the unit they were done in.
const read = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const screen = read('src/components/WorkoutSessionScreenV3.jsx');
const resultSet = read('src/components/ResultSetV2.jsx');

// --- The issue itself: 40 kg were recorded last time, then the exercise is switched to lbs.
const lastWeek = '2026-11-16T18:00:00.000Z';
const switched = new Date('2026-11-23T17:02:00.000Z');
const shownAs = (weightKg, periods, doneAt, unit) => {
  const past = pastWeightUnit(periods, doneAt, unit);
  return withUnitIfOther(toDisplayWeight(weightKg, past), past, unit);
};
// Nothing was ever asked: the past is in the unit of the column, as before.
assert.equal(shownAs(40, undefined, lastWeek, 'kg'), '40');
// «Нет»: the recorded 40 kg stay 40 kg, and say so beside a column of lbs.
const kept = pastUnitPeriodsAfterSwitch(undefined, 'kg', false, switched);
assert.deepEqual(kept, [{ until: '2026-11-23T17:02:00.000Z', unit: 'kg' }]);
assert.equal(shownAs(40, kept, lastWeek, 'lb'), '40 кг');
// «Да»: the past is converted, as it used to be without a question.
const converted = pastUnitPeriodsAfterSwitch(undefined, 'kg', true, switched);
assert.deepEqual(converted, []);
assert.equal(shownAs(40, converted, lastWeek, 'lb'), '88.18');

// --- What is done after the switch is in the new unit: 40 lbs typed today come back as 40 next time.
const nextWorkout = '2026-11-23T17:30:00.000Z';
assert.equal(shownAs(18.144, kept, nextWorkout, 'lb'), '40');
assert.equal(shownAs(40, kept, lastWeek, 'lb'), '40 кг', 'and the older workout still stays in kilograms');

// --- Back to kilograms with «Нет»: each stretch keeps its own unit.
const back = pastUnitPeriodsAfterSwitch(kept, 'lb', false, new Date('2026-11-30T17:00:00.000Z'));
assert.equal(back.length, 2);
assert.equal(shownAs(40, back, lastWeek, 'kg'), '40', 'done in kilograms before the first switch');
assert.equal(shownAs(18.144, back, nextWorkout, 'kg'), '40 lbs', 'done in pounds between the switches');
assert.equal(shownAs(42.5, back, '2026-12-01T10:00:00.000Z', 'kg'), '42.5', 'done in kilograms after the second');
// Back to kilograms with «Да»: everything is in kilograms again.
assert.deepEqual(pastUnitPeriodsAfterSwitch(kept, 'lb', true), []);

// --- A set with no time of its own is older than any switch; broken stored data means «nothing was asked».
assert.equal(pastWeightUnit(kept, null, 'lb'), 'kg');
assert.equal(pastWeightUnit(kept, undefined, 'lb'), 'kg');
assert.equal(pastWeightUnit([], null, 'lb'), 'lb');
for (const broken of [null, 'kg', {}, [{ unit: 'kg' }], [{ until: 'yesterday', unit: 'kg' }], [{ until: lastWeek, unit: 'stone' }]]) {
  assert.equal(pastWeightUnit(broken, lastWeek, 'lb'), 'lb');
  assert.deepEqual(pastUnitPeriodsAfterSwitch(broken, 'kg', false, switched), kept);
}
assert.equal(withUnitIfOther('', 'kg', 'lb'), '', 'no value last time, no unit either');

// --- The switch only asks. The unit changes in the answer, and «Отмена» leaves everything as it was.
assert.match(screen, /onUnitChange=\{\(unit\) => requestUnit\(actionTarget, unit\)\}/);
assert.doesNotMatch(screen, /onUnitChange=\{\(unit\) => setUnit\(/, 'the switch must not change the unit by itself');
assert.match(screen, /function requestUnit\(exercise, unit\) \{ if \(unit !== getUnit\(exercise\)\) setUnitQuestion\(\{ exercise, unit \}\); \}/);
const answer = screen.slice(screen.indexOf('function answerUnitQuestion(convert)'), screen.indexOf('function getRestSeconds'));
assert.match(answer, /pastUnitPeriodsAfterSwitch\(pastWeightUnits\[key\], getUnit\(exercise\), convert\)/);
assert.match(answer, /localStorage\.setItem\(PAST_WEIGHT_UNIT_STORAGE_KEY, JSON\.stringify\(next\)\)/);
assert.match(answer, /setUnit\(exercise, unit\);\n\s*setUnitQuestion\(null\);/);
assert.equal(screen.match(/setUnit\(exercise, unit\);/g).length, 1, 'the unit is changed only by the answer');
assert.match(screen, /\{unitQuestion && <WeightUnitQuestion exercise=\{unitQuestion\.exercise\} unit=\{unitQuestion\.unit\} onAnswer=\{answerUnitQuestion\} onClose=\{\(\) => setUnitQuestion\(null\)\} \/>\}/);
assert.match(screen, /\{actionTarget && !unitQuestion && <ExerciseActionsPopup /, 'the question replaces the exercise menu while it is open');

// --- The question: its words, and the three ways out.
const question = screen.slice(screen.indexOf('function WeightUnitQuestion('), screen.indexOf('function ExerciseActionsPopup('));
assert.match(question, /<h3>Пересчитать прошлые тренировки\?<\/h3>/);
assert.match(question, /role="dialog" aria-modal="true" aria-label="Пересчитать прошлые тренировки"/);
assert.match(question, /<button className="primary" type="button" onClick=\{\(\) => onAnswer\(true\)\}>Да, пересчитать в \{next\}<\/button>/);
assert.match(question, /<button type="button" onClick=\{\(\) => onAnswer\(false\)\}>Нет, оставить как есть<\/button>/);
assert.match(question, /<button className="cancel" type="button" onClick=\{onClose\}>Отмена<\/button>/);
assert.match(question, /<button className="exercise-actions-scrim" type="button" aria-label="Отмена" onClick=\{onClose\} \/>/);
assert.match(question, /const next = weightUnitLabel\(unit\);/, 'the unit is spelled by weightUnitLabel, as everywhere');

// --- The unit and the kept periods belong to the exercise, not to its card in one workout:
// the next workout opens in the chosen unit, so the sets done since the switch are known to be in it.
assert.match(screen, /function exerciseUnitKey\(exercise\) \{ return String\(exercise\.exerciseId \?\? exercise\.id\); \}/);
assert.match(screen, /function getUnit\(exercise\) \{ return \(weightUnits\[exerciseUnitKey\(exercise\)\] \?\? weightUnits\[exerciseStorageKey\(exercise\)\]\) === 'lb' \? 'lb' : 'kg'; \}/);
assert.match(screen, /function setUnit\(exercise, unit\) \{ const key = exerciseUnitKey\(exercise\);/);
assert.match(screen, /function getPastUnits\(exercise\) \{ return pastWeightUnits\[exerciseUnitKey\(exercise\)\]; \}/);

// --- Where past workouts are shown: the grey values of both kinds of rows, and «История».
assert.match(screen, /const previousUnitOf = \(previous\) => pastWeightUnit\(getPastUnits\(exercise\), previous\?\.completedAt, unit\);/);
assert.equal(screen.match(/previousUnit=\{previousUnitOf\(previousBySet\.get\(set\.id\)\)\}/g).length, 2, 'both kinds of set rows');
assert.match(screen, /const weightHint=last\.weight!==''\?withUnitIfOther\(toDisplayWeight\(last\.weight,previousUnit\),previousUnit,unit\):'—';/);
assert.match(resultSet, /if\(!WEIGHT_FIELDS\.includes\(field\)\)return hint;/, 'reps, time and distance have no unit to keep');
// A grey value that names its unit is marked, and set smaller so that «134.99 lbs» fits a weight cell.
assert.match(screen, /placeholder=\{weightHint\} data-past-unit=\{last\.weight!==''&&previousUnit!==unit\?previousUnit:undefined\}/);
assert.match(resultSet, /data-past-unit=\{previousUnit!==unit&&WEIGHT_FIELDS\.includes\(field\)&&shownHint\(field\)!==''\?previousUnit:undefined\}/);
assert.match(screen, /import '\.\.\/workout-unit-question\.css';/);
const css = read('src/workout-unit-question.css').replace(/\/\*[\s\S]*?\*\//g, '');
assert.match(css, /\.workout-exercise-card\.v3 \.exercise-set-row input\[data-past-unit\]::placeholder,\n\.workout-exercise-card\.v3 \.result-set-v2 input\[data-past-unit\]::placeholder \{\s*font-size: var\(--text-body\);\s*\}/);
assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(/i, 'only theme tokens, so the dark theme needs no rule of its own');
assert.match(screen, /const unitAt = \(doneAt\) => pastWeightUnit\(pastUnits, doneAt, unit\);/);
assert.match(screen, /formatWeight\(data\.best\.set\.weight, unitAt\(data\.best\.set\.completedAt \?\? data\.best\.date\)\)/);
assert.match(screen, /const shownUnit = unitAt\(set\.completedAt \?\? data\.previous\.date\);/);
assert.match(screen, /set\.resultV2 \? formatResultV2\(set\.resultV2, shownUnit\) : formatWeight\(set\.weight, shownUnit\)/);
assert.match(screen, /pastUnits: getPastUnits\(exercise\), data: await getExerciseHistorySummary/);

console.log('weight unit question: ok');
