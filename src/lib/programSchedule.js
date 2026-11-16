// Dates and statuses of a program's schedule, shared by the program screen
// and the single schedule list of the «График» tab (#119).

const WEEKLY_DAYS = { weekly_mwf: [1, 3, 5], weekly_tts: [2, 4, 6] };

export function localToday() {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function isAllowedStartDate(value, mode) {
  if (!value) return false;
  const allowed = WEEKLY_DAYS[mode];
  return !allowed || allowed.includes(new Date(`${value}T12:00:00`).getDay());
}

export function startDateHint(mode) {
  if (mode === 'weekly_mwf') return 'Выберите понедельник, среду или пятницу.';
  if (mode === 'weekly_tts') return 'Выберите вторник, четверг или субботу.';
  return '';
}

// What a schedule row says about its workout. A workout that is simply
// planned for today or later carries no label: its date already says so.
export function scheduleRowStatus(item, today) {
  if (item.status === 'completed') return { key: 'completed', label: 'Выполнена' };
  if (item.status === 'skipped') return { key: 'skipped', label: 'Пропущена' };
  if (item.status === 'cancelled') return { key: 'cancelled', label: 'Отменена' };
  if (item.scheduledDate && item.scheduledDate < today) return { key: 'overdue', label: 'Просрочена' };
  return { key: 'scheduled', label: '' };
}

// The workout the user is most likely to act on: the earliest one still to do.
export function nearestScheduledWorkoutId(workouts) {
  return workouts.find((item) => item.status === 'scheduled')?.id ?? null;
}

// Rescheduling shifts the rest of the plan, so it is closed once a later
// workout already has a saved outcome.
export function hasLaterHistory(workouts, item) {
  return workouts.some((candidate) => candidate.sequenceNumber > item.sequenceNumber
    && ['completed', 'skipped'].includes(candidate.status));
}
