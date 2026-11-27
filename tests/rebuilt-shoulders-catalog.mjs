import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = file => readFileSync(file, 'utf8');
const shoulder = JSON.parse(read('data/exercise-catalog/rebuilt-shoulders-from-sheet.json'));
const legs = JSON.parse(read('data/exercise-catalog/rebuilt-legs-from-sheet.json'));
const chest = JSON.parse(read('data/exercise-catalog/rebuilt-chest-from-sheet.json'));
const arms = JSON.parse(read('data/exercise-catalog/rebuilt-arms-from-sheet.json'));
const sql = read('data/exercise-catalog/rebuild-shoulders-upsert.sql');
const library = read('src/lib/exerciseLibrary.js');
const techniqueLibrary = read('src/lib/exerciseVariationSelection.js');

const {
  defaultVariationSelection, variationPresentation, exerciseTechniqueText,
  exerciseEquipmentTags, isRebuiltTechniqueExercise,
} = await import('../src/lib/exerciseVariationSelection.js');

assert.equal(shoulder.source_sheet, 'Упражнения (Плечи) список');
assert.equal(shoulder.source_sheet_gid, 1986848443);
assert.equal(shoulder.imported_count, 58);
assert.equal(shoulder.exercises.length, 58);
assert.equal(shoulder.description_source_columns, 'K');
assert.equal(shoulder.variation_technique_source_columns, 'L:S; T:AA');
assert.equal(new Set(shoulder.exercises.map(item => item.name.toLocaleLowerCase('ru'))).size, 58);
assert.equal(new Set(shoulder.exercises.map(item => item.canonical_key)).size, 58);
assert.equal(shoulder.exercises.reduce((total, item) => total + item.variation_axes.length, 0), 63);
assert.equal(shoulder.exercises.reduce((total, item) =>
  total + item.variation_axes.reduce((sum, axis) => sum + axis.options.length, 0), 0), 135);
assert.equal(shoulder.exercises[0].name, 'Жим штанги стоя');
assert.equal(shoulder.exercises.at(-1).name, 'Around the world');
assert.match(library, /'Упражнения \(Плечи\) список'/);
assert.match(library, /'Задняя дельта'/);
assert.match(techniqueLibrary, /'Упражнения \(Плечи\) список'/);
assert.match(sql, /on conflict\(canonical_key\) do update/);
assert.doesNotMatch(sql, /delete from public\.exercises|truncate|cascade/i);

for (const exercise of shoulder.exercises) {
  assert(exercise.name && exercise.description && exercise.equipment_tag
    && exercise.movement_filter_type);
  assert(exercise.description.startsWith('1. '));
  assert(exercise.muscle_tags.length >= 1 && exercise.muscle_tags.length <= 3);
  assert(exercise.variation_axes.length <= 3);

  const asDatabaseRow = {
    ...exercise, source_sheet: shoulder.source_sheet, technique: exercise.description,
  };
  assert(isRebuiltTechniqueExercise(asDatabaseRow));
  const initial = defaultVariationSelection(asDatabaseRow);
  if (!exercise.variation_axes.length) {
    assert.equal(exerciseTechniqueText(asDatabaseRow,
      variationPresentation(asDatabaseRow, initial)), exercise.description);
  }
  for (let axis = 0; axis < exercise.variation_axes.length; axis++) {
    for (const option of exercise.variation_axes[axis].options) {
      assert(option.technique_full.startsWith('1. '));
      const selected = [...initial];
      selected[axis] = option.label;
      const text = exerciseTechniqueText(asDatabaseRow,
        variationPresentation(asDatabaseRow, selected), axis);
      assert.equal(text, option.technique_full,
        `${exercise.name}: ${exercise.variation_axes[axis].label} — ${option.label}`);
      assert(!text.includes('Изменение техники:'));
    }
  }
}

const ezExercise = shoulder.exercises.find(item =>
  item.variation_axes.some(axis => axis.label === 'Гриф' && axis.options.some(opt => opt.label === 'EZ')));
if (ezExercise) {
  const options = defaultVariationSelection(ezExercise);
  const index = ezExercise.variation_axes.findIndex(axis => axis.label === 'Гриф');
  options[index] = 'EZ';
  assert(exerciseEquipmentTags(ezExercise, options).includes('EZ-гриф'));
}

const active = [legs, chest, arms, shoulder].flatMap(snapshot => snapshot.exercises);
assert.equal(active.length, 288);
assert.equal(new Set(active.map(exercise => exercise.name.toLocaleLowerCase('ru'))).size, 288);
assert.equal(new Set(active.map(exercise => exercise.canonical_key)).size, 288);
assert.deepEqual(arms.retired_canonical_keys, ['rebuild_arms_36']);
const shifted = arms.exercises.find(exercise => exercise.name === 'Разгибание одной руки с гантелью лёжа');
assert.equal(shifted.source_row, 36);
assert.equal(shifted.canonical_key, 'rebuild_arms_37',
  'Removing an earlier row must not replace the identity of a later exercise');

console.log('Four-sheet catalog: 288 available exercises; 58 shoulder cards, 135 full variation techniques, stable identities.');
