import assert from 'node:assert/strict';
import fs from 'node:fs';
import { hasLaterHistory, isAllowedStartDate, nearestScheduledWorkoutId, scheduleRowStatus, startDateHint } from '../src/lib/programSchedule.js';

// #119: the «График» tab of a running program showed the same workouts twice:
// a short «date — name» list and, below it, cards with the actions. Now every
// workout is one row of one list, and its actions open under the row.
const read = (path) => fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

const screen = read('src/components/ProgramDetailScreen.jsx');
const list = read('src/components/ProgramScheduleList.jsx');
const css = read('src/program-schedule-list.css');
const refresh = read('src/program-ui-refresh.css');
const pkg = read('package.json');

// --- The tab renders the workouts once. ---
const panel = screen.slice(screen.indexOf('id="owned-schedule-panel"'), screen.indexOf('</main>'));
assert.ok(panel.length > 0, 'The schedule panel is found.');
assert.equal(panel.split('<ProgramScheduleList').length - 1, 1, 'The schedule panel renders exactly one list.');
assert.doesNotMatch(panel, /\.map\(/, 'The panel itself loops over nothing: the list owns the rows.');
assert.match(panel, /workouts=\{program\.scheduledWorkouts\}/);
assert.doesNotMatch(screen, /program-schedule-timeline|scheduled-workout-card|program-detail-schedule/, 'Both old lists are gone.');
assert.doesNotMatch(screen, /Запланированные тренировки/, 'The heading of the second list is gone.');
assert.doesNotMatch(screen, /scheduled-workout-controls\.css/);
assert.ok(!fs.existsSync('src/scheduled-workout-controls.css'), 'The stylesheet of the old cards is removed.');
assert.doesNotMatch(refresh, /program-schedule-timeline/, 'The styles of the old short list are removed.');
assert.equal(list.split('workouts.map(').length - 1, 1, 'The list walks the workouts once: one row per workout.');
assert.match(list, /<li key=\{item\.id\}/);

// --- Nothing the two lists could do is lost. ---
assert.match(panel, /onOpenResult=\{\(item\) => onOpenWorkout\?\.\(item\.id\)\}/);
assert.match(panel, /onMarkComplete=\{\(item\) => \{ setManualWorkoutId\(item\.id\);/);
assert.match(panel, /onReschedule=\{async \(item, date\) => \{ await rescheduleScheduledWorkout\(item\.id, date\); await reloadProgram\(\); \}\}/);
assert.match(panel, /onSkip=\{async \(item\) => \{ await skipScheduledWorkout\(item\.id\); await reloadProgram\(\); \}\}/);
assert.match(panel, /из \{program\.scheduledWorkouts\.length\}/, 'The «выполнено из» summary stays above the list.');
for (const label of ['Посмотреть / изменить веса', 'Отметить выполненной', 'Перенести', 'Пропустить', 'Да, пропустить', 'Сохранить']) {
  assert.ok(list.includes(label), `The list keeps «${label}».`);
}
assert.match(list, /Перенос недоступен: после этой тренировки уже сохранён результат/);

// --- A row opens its actions; the nearest workout is open from the start. ---
assert.match(list, /aria-expanded=\{open\} aria-controls=\{bodyId\}/);
assert.match(list, /const expandable = actionable \|\| item\.status === 'completed';/, 'Skipped and cancelled rows have nothing to open.');
assert.match(list, /const openId = chosenId === undefined \? nearestScheduledWorkoutId\(workouts\) : chosenId;/);
assert.match(list, /await onSkip\(item\);[\s\S]*?setChosenId\(undefined\);/, 'After a skip the next workout opens.');
assert.equal(nearestScheduledWorkoutId([{ id: 'a', status: 'completed' }, { id: 'b', status: 'skipped' }, { id: 'c', status: 'scheduled' }, { id: 'd', status: 'scheduled' }]), 'c');
assert.equal(nearestScheduledWorkoutId([{ id: 'a', status: 'completed' }]), null);

// --- Statuses of a row. ---
const today = '2026-11-16';
assert.deepEqual(scheduleRowStatus({ status: 'completed', scheduledDate: '2026-11-02' }, today), { key: 'completed', label: 'Выполнена' });
assert.deepEqual(scheduleRowStatus({ status: 'skipped', scheduledDate: '2026-11-15' }, today), { key: 'skipped', label: 'Пропущена' });
assert.deepEqual(scheduleRowStatus({ status: 'cancelled', scheduledDate: '2026-11-15' }, today), { key: 'cancelled', label: 'Отменена' });
assert.deepEqual(scheduleRowStatus({ status: 'scheduled', scheduledDate: '2026-11-15' }, today), { key: 'overdue', label: 'Просрочена' });
assert.deepEqual(scheduleRowStatus({ status: 'scheduled', scheduledDate: today }, today), { key: 'scheduled', label: '' }, 'Today is not overdue.');
assert.deepEqual(scheduleRowStatus({ status: 'scheduled', scheduledDate: '2026-11-17' }, today), { key: 'scheduled', label: '' });

// --- Rescheduling rules moved with the list, unchanged. ---
const plan = [{ sequenceNumber: 1, status: 'completed' }, { sequenceNumber: 2, status: 'scheduled' }, { sequenceNumber: 3, status: 'skipped' }, { sequenceNumber: 4, status: 'scheduled' }];
assert.equal(hasLaterHistory(plan, plan[1]), true, 'A later skipped workout closes rescheduling.');
assert.equal(hasLaterHistory(plan, plan[3]), false);
assert.equal(isAllowedStartDate('2026-11-16', 'weekly_mwf'), true, 'Monday fits Пн/Ср/Пт.');
assert.equal(isAllowedStartDate('2026-11-17', 'weekly_mwf'), false);
assert.equal(isAllowedStartDate('2026-11-17', 'weekly_tts'), true);
assert.equal(isAllowedStartDate('2026-11-17', 'custom'), true);
assert.equal(isAllowedStartDate('', 'custom'), false);
assert.equal(startDateHint('weekly_tts'), 'Выберите вторник, четверг или субботу.');
assert.equal(startDateHint('custom'), '');

// --- The list has its own stylesheet on theme tokens. ---
assert.match(list, /import '\.\.\/program-schedule-list\.css';/);
assert.match(css, /\.owned-schedule-list\{/);
assert.match(css, /html\[data-theme='dark'\] \.owned-schedule-list\{/);
assert.match(css, /\.owned-schedule-row\.status-completed \.owned-schedule-row-date\{background:var\(--ink\);color:var\(--surface\)\}/);
assert.match(css, /\.owned-schedule-action\{[^}]*min-height:44px/, 'Action buttons keep a 44px touch target.');
assert.match(css, /\.owned-schedule-row-meta\{[^}]*max-height:var\(--lh-caption\);overflow:hidden/, 'The second line of a row never wraps into two.');
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
const hexOutsideTokens = rules.split('\n').filter((line) => /#[0-9a-f]{3,8}\b/i.test(line) && !/^\s*--schedule-/.test(line));
assert.deepEqual(hexOutsideTokens, [], 'Colours come from tokens; only the --schedule-* definitions hold literals.');
// The create-program screens own .program-schedule-list and .program-schedule-error.
assert.doesNotMatch(css, /\.program-schedule-/, 'The list does not reuse class names of the create-program schedule.');

assert.match(pkg, /node tests\/program-schedule-single-list\.mjs/, 'The check is registered in package.json.');
console.log('Program schedule tab: one list, row actions and statuses verified.');
