import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(path, 'utf8');
const source = JSON.parse(read('data/exercise-catalog/rebuilt-arms-from-sheet.json'));
const library = read('src/lib/exerciseLibrary.js');
const techniqueLibrary = read('src/lib/exerciseVariationSelection.js');
const sql = read('data/exercise-catalog/rebuild-arms-upsert.sql');
const browser = read('src/components/TrainingExerciseBrowser.jsx');
const {
  defaultVariationSelection, variationPresentation, exerciseTechniqueText,
  exerciseEquipmentTags, isRebuiltTechniqueExercise,
} = await import('../src/lib/exerciseVariationSelection.js');

assert.equal(source.source_sheet, 'Упражнения (Руки) список');
assert.equal(source.source_sheet_gid, 598353245);
assert.equal(source.imported_count, 53);
assert.equal(source.exercises.length, 53);
assert.equal(source.description_source_columns, 'K');
assert.equal(source.variation_technique_source_columns, 'L:U; V:AE');
assert.equal(new Set(source.exercises.map(item => item.name.toLocaleLowerCase('ru'))).size, 53);
assert.equal(new Set(source.exercises.map(item => item.source_row)).size, 53);
assert.equal(source.exercises.reduce((sum, item) => sum + item.variation_axes.length, 0), 72);
assert.equal(source.exercises.reduce((sum, item) =>
  sum + item.variation_axes.reduce((count, axis) => count + axis.options.length, 0), 0), 175);
assert.match(library, /'Упражнения \(Руки\) список'/);
assert.match(library, /'Предплечья'/);
assert.match(techniqueLibrary, /'Упражнения \(Руки\) список'/);
assert.match(browser, /equipmentOptions\.map/);
assert.match(sql, /on conflict\(canonical_key\) do update/);
assert.doesNotMatch(sql, /delete from public\.exercises|truncate/i);

for (const exercise of source.exercises) {
  assert(exercise.name && exercise.description && exercise.equipment_tag &&
    exercise.movement_filter_type);
  assert(exercise.description.startsWith('1. '));
  assert(exercise.muscle_tags.length > 0 && exercise.muscle_tags.length <= 3);
  assert(exercise.variation_axes.length <= 3);

  const row = {
    ...exercise,
    source_sheet: source.source_sheet,
    technique: exercise.description,
  };
  assert(isRebuiltTechniqueExercise(row));
  const selection = defaultVariationSelection(row);
  if (!exercise.variation_axes.length) {
    assert.equal(exerciseTechniqueText(row, variationPresentation(row, selection)),
      exercise.description);
  }
  for (let axisIndex = 0; axisIndex < exercise.variation_axes.length; axisIndex++) {
    const axis = exercise.variation_axes[axisIndex];
    assert(axis.label && axis.options.length);
    for (const option of axis.options) {
      assert(option.label && option.technique_full.startsWith('1. '));
      const chosen = [...selection];
      chosen[axisIndex] = option.label;
      const shown = exerciseTechniqueText(row, variationPresentation(row, chosen), axisIndex);
      assert.equal(shown, option.technique_full,
        `${exercise.name} — ${axis.label}: ${option.label}`);
      assert(!shown.includes('Изменение техники:') && !shown.includes('Вариация:'));
    }
  }
}

const withArmblaster = source.exercises[0];
assert(exerciseEquipmentTags(withArmblaster, ['с', 'прямой']).includes('Армбластер'));
assert(exerciseEquipmentTags(withArmblaster, ['без', 'EZ']).includes('EZ-гриф'));

console.log('Rebuilt arms catalog: 53 cards, 72 axes, 175 complete option techniques verified.');
