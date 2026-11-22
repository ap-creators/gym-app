import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read=p=>readFileSync(p,'utf8');
const legs=JSON.parse(read('data/exercise-catalog/rebuilt-legs-from-sheet.json'));
const chest=JSON.parse(read('data/exercise-catalog/rebuilt-chest-from-sheet.json'));
const legSql=read('data/exercise-catalog/rebuild-legs-upsert.sql');
const chestSql=read('data/exercise-catalog/rebuild-chest-upsert.sql');
const library=read('src/lib/exerciseLibrary.js');
const details=read('src/components/ExerciseDetailsContent.jsx');
for(const {snap,sheet,gid,count,axes,opts} of [
 {snap:legs,sheet:'Упражнения (Ноги) список',gid:598353243,count:113,axes:128,opts:308},
 {snap:chest,sheet:'Упражнения (Грудь) список',gid:598353244,count:63,axes:70,opts:158},
]){
 assert.equal(snap.source_sheet,sheet);
 assert.equal(snap.source_sheet_gid,gid);
 assert.equal(snap.imported_count,count);
 assert.equal(snap.exercises.length,count);
 assert.equal(snap.movement_source_column,'J');
 assert.equal(snap.description_source_columns,'K; L:N; O:Q');
 assert.equal(new Set(snap.exercises.map(e=>e.name.toLocaleLowerCase('ru'))).size,count);
 assert.equal(new Set(snap.exercises.map(e=>e.source_row)).size,count);
 assert(snap.exercises.every(e=>e.name&&e.description&&e.equipment_tag&&e.movement_filter_type));
 assert(snap.exercises.every(e=>Array.isArray(e.muscle_tags)&&e.muscle_tags.length>=1&&e.muscle_tags.length<=3));
 assert.equal(snap.exercises.reduce((n,e)=>n+e.variation_axes.length,0),axes);
 assert.equal(snap.exercises.reduce((n,e)=>n+e.variation_axes.reduce((m,a)=>m+a.options.length,0),0),opts);
 assert(snap.exercises.every(e=>e.variation_axes.every(a=>a.label&&a.options.every(o=>
   o.label&&o.variation_description&&o.technique_change&&o.description.includes(o.technique_change)))));
}
assert.equal(legs.exercises.find(e=>e.source_row===91).source_number,null,'Uncertain source number 92? is not silently corrected');
assert.equal(legs.exercises.find(e=>e.source_row===13).name,'Приседания на BOSU');
assert.equal(legs.exercises.find(e=>e.source_row===108).name,'Power Runner');
assert.equal(legs.exercises.reduce((n,e)=>n+e.muscle_tags.length,0),249);
assert.equal(chest.exercises[0].name,'Жим штанги лёжа на горизонтальной скамье');
assert.equal(chest.exercises.at(-1).name,'Отжимания на гимнастических кольцах');
assert.deepEqual(chest.exercises[0].muscle_tags,['Грудные','Трицепс','Передняя дельта']);
assert.match(legSql,/private\.exercise_catalog_v1_archive/);
assert.match(legSql,/source_sheet not in \('Упражнения \(Ноги\) список','Упражнения \(Грудь\) список'\)/);
assert.match(legSql,/on conflict\(canonical_key\) do update/);
assert.match(chestSql,/rebuild_chest_/);
assert.match(chestSql,/on conflict\(canonical_key\) do update/);
assert.doesNotMatch(legSql+'\n'+chestSql,/delete from public\.exercises|truncate|cascade/i);
assert.match(read('supabase/migrations/20261122135000_exercise_movement_filter_type.sql'),/add column if not exists movement_filter_type text/);
assert.match(library,/REBUILT_BASE_SHEETS = \['Упражнения \(Ноги\) список', 'Упражнения \(Грудь\) список'\]/);
assert.match(library,/if \(!isAvailableExercise\(row\)\) continue;/);
assert.match(details,/training-exercise-variation-axes/);
assert.match(details,/variation=\{variation\}/);
const {defaultVariationSelection,variationPresentation,exerciseEquipmentTags,signVariationMedia}
 = await import('../src/lib/exerciseVariationSelection.js');
const sample={name:'Жим',video_url:'https://example.test/default.mp4',
 variation_axes:[{label:'Хват',options:['прямой',{label:'обратный',description:'Повернуть кисти',video_url:'https://example.test/other.mp4'}]}]};
assert.deepEqual(defaultVariationSelection(sample),['прямой']);
assert.equal(variationPresentation(sample,['прямой']).video,'https://example.test/default.mp4');
assert.equal(variationPresentation(sample,['обратный']).video,'https://example.test/other.mp4');
assert.match(variationPresentation(sample,['обратный']).notes,/Повернуть кисти/);
const lunge=legs.exercises.find(e=>e.source_row===21);
assert.deepEqual(exerciseEquipmentTags(lunge),['Свой вес','Штанга']);
assert.deepEqual(exerciseEquipmentTags(lunge,['пол','гантели']),['Свой вес','Гантели']);
assert.match(variationPresentation(lunge,['пол','гантели']).notes,/Изменение техники:/);
const signed=await signVariationMedia([{label:'Хват',options:['прямой',{label:'обратный',video_path:'other.mp4'}]}],
 async path=>'signed://'+path);
assert.equal(signed[0].options[1].resolvedVideoUrl,'signed://other.mp4');
console.log('Rebuilt exercise catalog: 176 rows, 198 axes, 466 exact explanations and technique changes verified.');
