// Issue #101: weights are stored in kilograms. The unit chosen for an exercise ('kg' or 'lb')
// changes only what the workout screen shows and accepts. Pounds are written «lbs» everywhere.
export const KG_PER_LB = 0.45359237;

export const weightUnitLabel = (unit) => (unit === 'lb' ? 'lbs' : 'кг');

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

export function toDisplayWeight(weightKg, unit) {
  if (weightKg === '' || weightKg === null || weightKg === undefined) return '';
  const value = Number(weightKg);
  if (!Number.isFinite(value)) return '';
  return String(round(unit === 'lb' ? value / KG_PER_LB : value, 2));
}

export function fromDisplayWeight(value, unit) {
  if (value === '') return '';
  const parsed = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(parsed)) return '';
  return String(round(unit === 'lb' ? parsed * KG_PER_LB : parsed, 2));
}

// A results v2 weight typed in pounds, as kilograms. Three decimals, so that every pound value
// with up to two decimals comes back unchanged (22.5 lbs → 10.206 kg → 22.5 lbs; two decimals give 22.51).
// Text that is not a plain number is returned as it is: the row's own validation rejects it.
export function poundsInputToKg(value) {
  if (typeof value !== 'string' || !/^\d+(?:[.,]\d+)?$/.test(value.trim())) return value;
  return round(Number(value.trim().replace(',', '.')) * KG_PER_LB, 3);
}

// Issue #123: switching the unit of an exercise never converts past workouts on its own. The switch
// asks «Пересчитать прошлые тренировки?». «Нет» leaves every set done before that moment in the unit
// that was in use then; `periods` keeps those moments, oldest first: [{ until: ISO time, unit }].
// A set done before `until` is shown in `unit`; a set done after the last one, in the unit chosen now.
// «Да» forgets the periods, so every past workout is shown in the new unit.
const validPeriods = (periods) => (Array.isArray(periods) ? periods : [])
  .filter((period) => ['kg', 'lb'].includes(period?.unit) && Number.isFinite(Date.parse(period.until)));

export function pastWeightUnit(periods, doneAt, unit) {
  const time = Date.parse(doneAt);
  // A set with no time of its own is older than any switch.
  const period = validPeriods(periods).find((item) => !Number.isFinite(time) || time < Date.parse(item.until));
  return period ? period.unit : unit;
}

export function pastUnitPeriodsAfterSwitch(periods, from, convert, now = new Date()) {
  if (convert) return [];
  return [...validPeriods(periods), { until: new Date(now).toISOString(), unit: from === 'lb' ? 'lb' : 'kg' }];
}

// A past weight beside a column of `unit`: the number alone when it is in that unit,
// and with its own unit when it is not («40 кг» in a column of lbs).
export const withUnitIfOther = (text, shownUnit, unit) => (
  text === '' || shownUnit === unit ? text : `${text} ${weightUnitLabel(shownUnit)}`
);
