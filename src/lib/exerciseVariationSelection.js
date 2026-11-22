// Existing string options and authored option objects share the same contract:
// {label, description?, video_url?, video_path?}, without new exercise IDs.
function toOption(raw) {
  if (typeof raw === 'string') return { label:raw.trim() };
  if (!raw || typeof raw !== 'object') return { label:'' };
  return { ...raw, label:String(raw.label ?? raw.value ?? raw.name ?? '').trim() };
}

export function normalizedVariationAxes(exercise) {
  return (Array.isArray(exercise?.variation_axes) ? exercise.variation_axes : [])
    .filter(axis => axis && typeof axis.label === 'string' && Array.isArray(axis.options))
    .map(axis => ({ label:axis.label, options:axis.options.map(toOption).filter(o => o.label) }))
    .filter(axis => axis.options.length > 0);
}

// Keep the equipment type from the source sheet; show a further tag when the
// selected resistance or apparatus variation specifies a different implement.
export function exerciseEquipmentTags(exercise, selection) {
  const main = String(exercise?.equipment_tag || exercise?.equipment || '').trim();
  const axes = normalizedVariationAxes(exercise);
  const tags = main ? [main] : [];
  axes.forEach((axis, i) => {
    const selected = axis.options.find(option => option.label === selection?.[i]) || axis.options[0];
    const specific = String(selected?.equipment_tag || '').trim();
    if (specific && !tags.some(tag => tag.toLocaleLowerCase('ru') === specific.toLocaleLowerCase('ru'))) {
      tags.push(specific);
    }
  });
  return tags;
}

export function defaultVariationSelection(exercise) {
  return normalizedVariationAxes(exercise).map(axis => axis.options[0].label);
}

export function variationPresentation(exercise, selection) {
  const axes = normalizedVariationAxes(exercise);
  const chosen = axes.map((axis, i) => axis.options.find(o => o.label === selection?.[i]) || axis.options[0]);
  const changed = chosen.some((option, i) => option !== axes[i].options[0]);
  const override = chosen.filter(option => option.resolvedVideoUrl || option.video_url).at(-1);
  const video = override ? (override.resolvedVideoUrl || override.video_url)
    : changed ? null : (exercise?.resolvedVideoUrl || exercise?.video_url || null);
  const notes = chosen.map(option => String(option.description || '').trim()).filter(Boolean);
  const techniqueChanges = chosen.flatMap((option, index) => {
    const text = String(option.technique_change || '').trim();
    return text ? [{ axis: axes[index].label, option: option.label, text }] : [];
  });
  return {
    axes,
    selection:chosen.map(o => o.label),
    summary:axes.map((axis, i) => axis.label + ' — ' + chosen[i].label).join('; '),
    notes:[...new Set(notes)].join('\n\n'),
    techniqueChanges,
    hasVariation:axes.length > 0,
    isAlternate:changed,
    video,
    missingVideo:Boolean(changed && !video),
  };
}

// A private video can be signed at either catalog load or session-detail load.
// Unmodified strings are left as strings for the old imported sheet.
export async function signVariationMedia(axes, signVideoPath) {
  if (!Array.isArray(axes)) return axes;
  return Promise.all(axes.map(async axis => {
    if (!Array.isArray(axis?.options)) return axis;
    const options = await Promise.all(axis.options.map(async option => {
      if (!option || typeof option !== 'object' || !option.video_path) return option;
      const resolvedVideoUrl = await signVideoPath(option.video_path);
      return { ...option, resolvedVideoUrl };
    }));
    return { ...axis, options };
  }));
}


// Rebuilt sheets provide a complete technique in K for exercises without
// variations and an independent complete technique in L:S for every option.
// T:AA identify the corresponding variation values.
const REBUILT_TECHNIQUE_SHEETS = new Set([
  'Упражнения (Ноги) список',
  'Упражнения (Грудь) список',
]);

export function isRebuiltTechniqueExercise(exercise) {
  return REBUILT_TECHNIQUE_SHEETS.has(exercise?.source_sheet);
}

export function exerciseTechniqueText(exercise, variation, activeAxisIndex = 0) {
  if (isRebuiltTechniqueExercise(exercise)) {
    const axis = variation?.axes?.[activeAxisIndex] ?? variation?.axes?.[0];
    const selectedLabel = variation?.selection?.[activeAxisIndex] ?? axis?.options?.[0]?.label;
    const option = axis?.options?.find(item => item.label === selectedLabel);
    // Each sheet variation holds its own complete text, not a delta to K.
    // Multiple variation axes are independent: show the full technique for
    // the most recently interacted-with axis, never concatenate instructions.
    const text = option?.technique_full || exercise.technique || exercise.description;
    return String(text || 'Техника выполнения пока не добавлена.').trim();
  }
  const base = exercise.short_description || exercise.description || exercise.technique
    || exercise.notes || 'Техника выполнения пока не добавлена.';
  return [
    variation?.summary ? 'Вариация: ' + variation.summary + '.' : '',
    variation?.notes,
    base,
  ].filter(Boolean).join('\n\n');
}
