// Issue #140: after one finished workout the user could not do another the same day.
//   * A one-off workout stayed empty: add_session_exercise refused every exercise of the shared
//     base, whose rows are 'legacy' since its rebuild and never 'published'.
//   * The next workout of the program could not be moved to today, the date of the finished one.
// Runs the live schema (fixture), the catalog and the migrations in a disposable PGlite, and first
// reproduces both refusals on the functions as they were.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { buildCatalogRelease } from '../scripts/exercise-catalog-release.mjs';
import { pickWorkoutOfDay } from '../src/lib/workoutLifecycle.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const schema = JSON.parse(read('./fixtures/catalog-live-schema-20261015.json'));
const legacy = JSON.parse(read('../docs/exercise-catalog-v2/legacy-shared-catalog.json'));
const migrationsBefore = [
  '20261015115110_standalone_workouts.sql',
  '20261108140000_start_program_with_selected_weekdays.sql',
  '20261109145203_sync_not_started_workouts_with_program_edits.sql',
  '20261109170000_keep_chosen_training_weekdays.sql',
  '20261109190000_add_session_exercise.sql',
  '20261109200000_add_exercise_to_program_from_workout.sql',
].map((name) => read(`../supabase/migrations/${name}`));
const migration = read('../supabase/migrations/20261127120000_second_workout_same_day.sql');

const db = new PGlite();
const alice = '00000000-0000-4000-8000-000000000001';
const bob = '00000000-0000-4000-8000-000000000002';
// The shared base as it is live: a row of a rebuilt sheet is 'legacy', an old card is 'retired'.
const sharedBase = '00000000-0000-4000-8000-0000000000c1';
const sharedRetired = '00000000-0000-4000-8000-0000000000c2';
const aliceOwn = '00000000-0000-4000-8000-0000000000a1';
const aliceRemoved = '00000000-0000-4000-8000-0000000000a2';
const bobOwn = '00000000-0000-4000-8000-0000000000b1';
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const scalar = async (sql, args = []) => (await q(sql, args))[0]?.value;
const login = async (id) => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); await db.exec('set role authenticated'); };
const asAdmin = async (run) => { await db.exec('reset role'); try { return await run(); } finally { await db.exec('set role authenticated'); } };
const quote = (value) => '"' + value.replaceAll('"', '""') + '"';
const rejects = async (promise, pattern, label) => {
  await assert.rejects(promise, (error) => { assert.match(error.message, pattern, label); return true; }, label);
};
const add = (sessionId, exerciseId) => scalar('select add_session_exercise($1, $2) value', [sessionId, exerciseId]);
const move = (workoutId, date, scope) => scalar('select reschedule_scheduled_workout_scoped($1, $2::date, $3) value', [workoutId, date, scope]);
const moveWithTail = (workoutId, date) => scalar('select reschedule_scheduled_workout($1, $2::date) value', [workoutId, date]);
const plan = (participationId) => q(`select id, sequence_number::int seq, status, scheduled_date::text date
  from scheduled_workouts where user_program_id = $1 order by sequence_number`, [participationId]);
const dates = async (participationId) => (await plan(participationId)).map((row) => row.date);
const names = (sessionId) => q('select exercise_name_snapshot name from workout_session_exercises where workout_session_id = $1 order by position', [sessionId])
  .then((rows) => rows.map((row) => row.name));

try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create schema private;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon,service_role;
    insert into auth.users values('${alice}'),('${bob}');`);
  for (const table of schema.tables) await db.exec(table.ddl);
  for (const constraint of [...schema.constraints].sort((a, b) => Number(a.foreign) - Number(b.foreign))) await db.exec(constraint.sql);
  for (const sql of schema.indexes) await db.exec(sql);
  for (const fn of schema.functions) await db.exec(fn.sql);
  for (const sql of schema.triggers) await db.exec(sql);
  for (const p of schema.policies) await db.exec(`create policy ${quote(p.name)} on public.${quote(p.table)} as ${p.permissive} for ${p.cmd} to ${p.roles.map(quote).join(',')} ${p.qual ? 'using (' + p.qual + ')' : ''} ${p.check ? 'with check (' + p.check + ')' : ''}`);
  for (const table of schema.tables) if (table.rls) await db.exec(`alter table public.${quote(table.name)} enable row level security`);
  for (const grant of schema.grants) await db.exec(`grant ${grant.privilege} on public.${quote(grant.table)} to ${quote(grant.role)}`);
  await db.exec("alter table public.programs add column if not exists details jsonb not null default '{}'::jsonb");
  for (const e of legacy) await db.query('insert into exercises(id,name,muscle_group,exercise_type,movement_type,technique,equipment) values($1,$2,$3,$4,$5,$6,$7)', [e.id, e.name, e.muscle_group, e.exercise_type, e.movement_type, e.technique, e.equipment]);
  await db.exec(buildCatalogRelease({ publish: true }));
  for (const sql of migrationsBefore) await db.exec(sql);
  await db.query(`insert into exercises(id,name,muscle_group,exercise_type,movement_type,source_sheet,owner_id,status) values
    ($1,'Присед из общей базы','Ноги','Базовое','Присед','Упражнения (Ноги) список',null,'legacy'),
    ($2,'Старая карточка','Ноги','Базовое','Присед','Зал',null,'retired'),
    ($3,'Свой жим Алисы','Грудь','Базовое','Жим','Зал',$6,'legacy'),
    ($4,'Удалённое упражнение Алисы','Грудь','Базовое','Жим','Зал',$6,'retired'),
    ($5,'Свой жим Боба','Грудь','Базовое','Жим','Зал',$7,'legacy')`,
  [sharedBase, sharedRetired, aliceOwn, aliceRemoved, bobOwn, alice, bob]);

  await login(alice);
  const published = (await q("select id, name from exercise_catalog_v2 where status = 'published' order by name limit 1"))[0];
  assert.ok(published, 'the published catalog has exercises');
  const today = await scalar('select current_date::text value');
  const day = (offset) => scalar('select (current_date + $1::int)::text value', [offset]);

  // A program of one workout every other day, six of them: today, +2, +4, +6, +8, +10.
  const payload = { name: 'Программа', week_count: 1, structure_mode: 'cycle', cycle_repeat_count: 6, schedule_mode: 'custom',
    weeks: [{ workouts: [{ name: 'День', rest_days_after: 1, exercises: [{ exercise_id: published.id, exercise_name_snapshot: published.name, prescription_snapshot: '2×8', sets: [{ reps: 8 }, { reps: 8 }] }] }] }] };
  const program = await scalar('select create_program_with_schedule($1::jsonb) value', [JSON.stringify(payload)]);
  const participation = await scalar('select start_program($1,current_date) value', [program]);
  const days = await plan(participation);
  assert.deepEqual(days.map((row) => row.date), [today, await day(2), await day(4), await day(6), await day(8), await day(10)]);

  // Today's workout is done.
  await q('select complete_workout($1)', [await scalar('select start_workout($1) value', [days[0].id])]);

  // --- The functions as they were: both ways to a second workout today are closed. ---
  await rejects(move(days[1].id, today, 'single'), /must be after the previous workout/, 'before #140: the next workout cannot join today');
  await rejects(moveWithTail(days[1].id, today), /must be after the previous workout/, 'before #140: nor with the rest of the schedule');
  const oneOffDay = await scalar('select start_standalone_workout() value');
  const oneOff = await scalar('select id value from workout_sessions where scheduled_workout_id = $1', [oneOffDay]);
  await rejects(add(oneOff, sharedBase), /Exercise not available/, 'before #140: the shared base is refused, so the one-off workout stays empty');
  await rejects(scalar('select add_standalone_exercise($1, $2) value', [oneOff, sharedBase]), /Exercise not available/, 'before #140: the older function too');

  await asAdmin(() => db.exec(migration));

  // --- 1. A one-off workout after a finished one takes every exercise the picker shows. ---
  await add(oneOff, sharedBase);
  await add(oneOff, aliceOwn);
  await add(oneOff, published.id);
  assert.deepEqual(await names(oneOff), ['Присед из общей базы', 'Свой жим Алисы', published.name]);
  assert.deepEqual(await q(`select ps.set_number::int n, ps.set_type type, ps.completed done from performed_sets ps
    join workout_session_exercises wse on wse.id = ps.workout_session_exercise_id where wse.workout_session_id = $1 order by wse.position`, [oneOff]),
  Array(3).fill({ n: 1, type: 'working', done: false }), 'each with one empty working set');
  // What no picker shows stays refused, and changes nothing.
  await rejects(add(oneOff, sharedRetired), /Exercise not available/, 'a retired card of the old base');
  await rejects(add(oneOff, aliceRemoved), /Exercise not available/, 'an own exercise the user removed');
  await rejects(add(oneOff, bobOwn), /Exercise not available/, 'another user\'s own exercise');
  await rejects(add(oneOff, '00000000-0000-4000-8000-00000000ffff'), /Exercise not available/, 'an unknown exercise');
  assert.equal((await names(oneOff)).length, 3);
  // The older function, for app builds that still call it.
  await scalar('select add_standalone_exercise($1, $2) value', [oneOff, sharedBase]);
  await rejects(scalar('select add_standalone_exercise($1, $2) value', [oneOff, sharedRetired]), /Exercise not available/, 'the older function refuses a retired card');
  assert.equal((await names(oneOff)).length, 4);
  await q('select complete_workout($1)', [oneOff]);

  // --- 2. The next workout of the program moves to today and is done today. ---
  await move(days[1].id, today, 'single');
  assert.deepEqual(await dates(participation), [today, today, await day(4), await day(6), await day(8), await day(10)], 'only this workout moved');
  await q('select complete_workout($1)', [await scalar('select start_workout($1) value', [days[1].id])]);
  assert.equal(await scalar(`select count(*)::int value from workout_sessions where user_id = $1 and status = 'completed' and ended_at::date = current_date`, [alice]), 3,
    'three workouts finished today: two of the program and the one-off');

  // «Эту и все оставшиеся»: the third joins today, the rest keep the rhythm after it.
  await move(days[2].id, today, 'tail');
  assert.deepEqual(await dates(participation), [today, today, today, await day(2), await day(4), await day(6)]);
  // The program schedule screen moves a workout with its tail the same way.
  await moveWithTail(days[3].id, today);
  assert.deepEqual(await dates(participation), [today, today, today, today, await day(2), await day(4)]);

  // --- 3. Dates still follow the order of the program. ---
  await asAdmin(() => db.query("update scheduled_workouts set scheduled_date = current_date + 3 where id = $1", [days[3].id]));
  // Now: today ×3, +3, +2, +4. Fix the order by hand first: #5 to +5, #6 to +7.
  await asAdmin(() => db.query("update scheduled_workouts set scheduled_date = current_date + 5 where id = $1", [days[4].id]));
  await asAdmin(() => db.query("update scheduled_workouts set scheduled_date = current_date + 7 where id = $1", [days[5].id]));
  const ordered = [today, today, today, await day(3), await day(5), await day(7)];
  assert.deepEqual(await dates(participation), ordered);
  await rejects(move(days[4].id, await day(2), 'single'), /cannot be before the previous workout/, 'earlier than the previous workout');
  await rejects(move(days[4].id, await day(2), 'tail'), /cannot be before the previous workout/, 'with the tail too');
  await rejects(moveWithTail(days[4].id, await day(2)), /cannot be before the previous workout/, 'and from the program schedule');
  await rejects(move(days[4].id, await day(8), 'single'), /cannot be after the next workout/, 'later than the next workout, when only this one moves');
  assert.deepEqual(await dates(participation), ordered, 'a refused move changes nothing');
  // The neighbours' own dates are allowed on both sides.
  await move(days[4].id, await day(7), 'single');
  assert.deepEqual(await dates(participation), [today, today, today, await day(3), await day(7), await day(7)]);
  await move(days[4].id, await day(3), 'single');
  assert.deepEqual(await dates(participation), [today, today, today, await day(3), await day(3), await day(7)]);
  await rejects(move(days[4].id, await day(-1), 'single'), /cannot be in the past/, 'the past stays closed');

  // The functions keep their settings and access.
  assert.deepEqual(await asAdmin(() => q(`select p.proname name, p.prosecdef definer, p.proconfig config,
      has_function_privilege('authenticated', p.oid, 'execute') auth, has_function_privilege('anon', p.oid, 'execute') anon
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('add_session_exercise','add_standalone_exercise','reschedule_scheduled_workout','reschedule_scheduled_workout_scoped')
    order by p.proname`)),
  ['add_session_exercise', 'add_standalone_exercise', 'reschedule_scheduled_workout', 'reschedule_scheduled_workout_scoped']
    .map((name) => ({ name, definer: false, config: ['search_path=""'], auth: true, anon: false })));

  // --- 4. The app. ---
  // The home card shows one workout of the day: the first still to do, so a finished one does not hide it.
  const row = (id, status) => ({ id, status });
  assert.equal(pickWorkoutOfDay([row('a', 'completed'), row('b', 'scheduled'), row('c', 'scheduled')]).id, 'b');
  assert.equal(pickWorkoutOfDay([row('a', 'scheduled'), row('b', 'completed')]).id, 'a');
  assert.equal(pickWorkoutOfDay([row('a', 'skipped'), row('b', 'completed'), row('c', 'scheduled')]).id, 'c');
  assert.equal(pickWorkoutOfDay([row('a', 'completed'), row('b', 'completed')]).id, 'a', 'nothing left to do: the first of the day');
  assert.equal(pickWorkoutOfDay([row('a', 'skipped')]).id, 'a');
  assert.equal(pickWorkoutOfDay([]), null);
  assert.equal(pickWorkoutOfDay(null), null);
  const home = read('../src/components/HomeScreen.jsx');
  const dayQuery = home.match(/\.eq\('scheduled_date', dateKey\)[^;]*;/)?.[0] ?? '';
  assert.match(dayQuery, /\.order\('sequence_number', \{ ascending: true \}\);$/, 'the day is read whole, in the order of the program');
  assert.doesNotMatch(dayQuery, /\.limit\(/, 'not only its first workout');
  assert.match(home, /workoutRow = pickWorkoutOfDay\(response\.data\);/);
  // Refusals of a move are named for both the new and the earlier wording of the server.
  const controls = read('../src/lib/scheduledWorkoutControls.js');
  for (const wording of ['before the previous workout', 'after the previous workout']) {
    assert.match(controls, new RegExp(`message\\.includes\\('${wording}'\\)[^\\n]*Выберите дату не раньше предыдущей тренировки программы\\.`));
  }
  for (const wording of ['after the next workout', 'before the next workout']) {
    assert.match(controls, new RegExp(`message\\.includes\\('${wording}'\\)[^\\n]*выберите дату не позже следующей\\.`));
  }
  assert.doesNotMatch(controls, /позже предыдущей|раньше следующей\./, 'the earlier texts asked for a different day');

  console.log('Second workout on the same day passed: shared-base exercises in a one-off workout, the next program workout moved to today, order of dates, home card.');
} finally {
  await db.close();
}
