// #127: the muscle-group line under an exercise name («Трицепс· Грудные· Передняя дельта· Свой вес»)
// used a middle dot that stuck to the word before it. Muscle groups are a comma list,
// a thin vertical line separates them from the equipment, extra equipment follows a comma.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const css = read('src/exercise-library-picker.css');
const line = read('src/components/ExerciseMuscleTagLine.jsx');

const tagRules = css.split('\n').filter(row => row.includes('.exercise-library-row-tags')).join('\n');
assert.doesNotMatch(css, /\.exercise-library-row-tags[^{]*\{[^}]*content:\s*"·"/, 'No middle dot between exercise tags');
assert.doesNotMatch(css, /\.exercise-library-row-tags > span:not\(:first-child\)::before/, 'The one-size-fits-all dot rule is gone');

assert.match(line, /className=\{index === 0 \? 'is-primary' : 'is-secondary'\}/, 'Secondary muscle groups keep their class');
assert.match(line, /className=\{index \? 'is-equipment-extra' : 'is-equipment'\}/, 'Equipment tags keep their classes');

const comma = css.match(/\.exercise-library-row-copy \.exercise-library-row-tags > span\.is-secondary::before,\n\.exercise-library-row-copy \.exercise-library-row-tags > span\.is-equipment-extra::before \{([^}]*)\}/);
assert.ok(comma, 'Secondary muscle groups and extra equipment share one separator rule');
assert.match(comma[1], /content:", ";/, 'Muscle groups are separated by a comma and a space');

const bar = css.match(/\.exercise-library-row-copy \.exercise-library-row-tags > span\.is-equipment:not\(:first-child\)::before \{([^}]*)\}/);
assert.ok(bar, 'Equipment is separated from the muscle groups by its own rule');
assert.match(bar[1], /content:"";/);
assert.match(bar[1], /display:inline-block;/);
assert.match(bar[1], /width:1px;/, 'The muscle/equipment separator is a thin vertical line');
assert.match(bar[1], /margin:0 7px;/, 'Space on both sides, so nothing sticks to a word');
assert.match(bar[1], /background:color-mix\(in srgb,var\(--muted\) 50%,transparent\);/, 'Separator is half-strength caption grey, so it reads on both themes');
assert.ok(tagRules.includes('span::before'), 'Tag separators are drawn by CSS, not by text in the component');
assert.doesNotMatch(line, />\s*[·,|]\s*<|\{['"][^'"]*[·,|]/, 'The component renders no separator characters of its own');

const script = read('package.json').match(/"test:ui-audit": "([^"]*)"/)[1];
assert.ok(script.includes('node tests/exercise-tag-separators.mjs'), 'Registered in test:ui-audit');
console.log('Exercise tag separators verified: commas between muscle groups, a thin line before the equipment, no middle dots.');
