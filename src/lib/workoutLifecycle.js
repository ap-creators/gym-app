export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// The server refuses to reschedule while a session is live, so asking a user with a
// running workout to move it first would leave them unable to reach "finish" at all.
export function needsWorkoutDateMove({ standalone, status, scheduledDate, hasActiveSession }, today) {
  if (hasActiveSession || standalone) return false;
  return status === 'scheduled' && Boolean(scheduledDate) && scheduledDate !== today;
}

// The server rejects starting a future workout, so offer the move instead of a dead end.
// Overdue workouts stay startable: they cannot always be moved, and completing one
// late is already reported as "По плану: <date>".
export function plannedWorkoutIsInFuture({ status, scheduledDate }, today) {
  return status === 'scheduled' && Boolean(scheduledDate) && scheduledDate > today;
}

// Issue #140: one day can hold several workouts, from two programs or two of the same program
// moved onto one date. The home card shows one of them: the first still to do, so a finished
// workout does not hide the next one. With nothing left to do, the first of the day.
// `rows` are that day's workouts in the order of the program.
export function pickWorkoutOfDay(rows) {
  const list = rows ?? [];
  return list.find((row) => row.status === 'scheduled') ?? list[0] ?? null;
}

// The session was finished elsewhere, for example by the 3-hour auto-completion.
export function isStaleSessionError(error) {
  return error?.code === 'P0002' || /session not found/i.test(error?.message ?? '');
}
