import { useState } from 'react';
import { formatExerciseCount } from '../lib/formatRussianCount.js';
import { hasLaterHistory, isAllowedStartDate, localToday, nearestScheduledWorkoutId, scheduleRowStatus, startDateHint } from '../lib/programSchedule.js';
import '../program-schedule-list.css';

const DAY_FORMAT = new Intl.DateTimeFormat('ru-RU', { day: 'numeric' });
const MONTH_FORMAT = new Intl.DateTimeFormat('ru-RU', { month: 'short' });

function ChevronIcon() { return <svg className="owned-schedule-row-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>; }

// The «График» tab of a running program: every scheduled workout is one row
// of one list. The row shows the date, the name and the status; its actions
// open under it, one row at a time (#119).
export function ProgramScheduleList({ workouts, isCycle, scheduleMode, onOpenResult, onMarkComplete, onReschedule, onSkip }) {
  const today = localToday();
  // undefined: the user has not chosen a row yet, so the nearest workout is open.
  const [chosenId, setChosenId] = useState(undefined);
  const [panel, setPanel] = useState(null);
  const [rescheduleDate, setRescheduleDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const openId = chosenId === undefined ? nearestScheduledWorkoutId(workouts) : chosenId;
  const hint = startDateHint(scheduleMode);

  function toggle(item) {
    if (busy) return;
    setChosenId(openId === item.id ? null : item.id);
    setPanel(null); setError('');
  }

  async function submitReschedule(item) {
    if (busy || !rescheduleDate) return;
    if (rescheduleDate < today) { setError('Новая дата не может быть в прошлом.'); return; }
    if (!isAllowedStartDate(rescheduleDate, scheduleMode)) { setError(hint); return; }
    setBusy(true); setError('');
    try {
      await onReschedule(item, rescheduleDate);
      setPanel(null);
    } catch (actionError) {
      setError(actionError?.message || 'Не удалось перенести тренировку.');
    } finally {
      setBusy(false);
    }
  }

  async function submitSkip(item) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await onSkip(item);
      // The skipped row has nothing left to do: open the next workout instead.
      setPanel(null); setChosenId(undefined);
    } catch (actionError) {
      setError(actionError?.message || 'Не удалось пропустить тренировку.');
    } finally {
      setBusy(false);
    }
  }

  return <ol className="owned-schedule-list" aria-label="График тренировок">
    {workouts.map((item) => {
      const status = scheduleRowStatus(item, today);
      const actionable = item.status === 'scheduled';
      const expandable = actionable || item.status === 'completed';
      const open = expandable && openId === item.id;
      const laterHistory = actionable && hasLaterHistory(workouts, item);
      const date = item.scheduledDate ? new Date(`${item.scheduledDate}T12:00:00`) : null;
      const bodyId = `owned-schedule-row-${item.id}`;
      const head = <>
        <span className="owned-schedule-row-date">{date
          ? <><strong>{DAY_FORMAT.format(date)}</strong><small>{MONTH_FORMAT.format(date)}</small></>
          : <strong>№ {item.sequenceNumber}</strong>}</span>
        <span className="owned-schedule-row-copy">
          <strong>{item.workoutName}</strong>
          <span className="owned-schedule-row-meta">
            {status.label && <span className="owned-schedule-row-status">{status.label}</span>}
            <span>{isCycle ? `Цикл ${item.cycleNumber ?? 1}` : `Этап ${item.weekNumber}`}</span>
            <span>{formatExerciseCount((item.exercises ?? []).length)}</span>
          </span>
        </span>
        {expandable && <ChevronIcon />}
      </>;
      return <li key={item.id} className={`owned-schedule-row status-${status.key}${open ? ' open' : ''}`}>
        {expandable
          ? <button type="button" className="owned-schedule-row-head" aria-expanded={open} aria-controls={bodyId} onClick={() => toggle(item)}>{head}</button>
          : <div className="owned-schedule-row-head">{head}</div>}
        {open && <div className="owned-schedule-row-body" id={bodyId}>
          {item.status === 'completed' && <button type="button" className="owned-schedule-action" onClick={() => onOpenResult(item)}>Посмотреть / изменить веса</button>}
          {actionable && panel === null && <>
            <button type="button" className="owned-schedule-action" disabled={busy} onClick={() => onMarkComplete(item)}>Отметить выполненной</button>
            <div className={`owned-schedule-action-pair${laterHistory ? ' single' : ''}`}>
              {!laterHistory && <button type="button" className="owned-schedule-action" disabled={busy} onClick={() => { setRescheduleDate(item.scheduledDate < today ? today : item.scheduledDate); setPanel('reschedule'); setError(''); }}>Перенести</button>}
              <button type="button" className="owned-schedule-action danger" disabled={busy} onClick={() => { setPanel('skip'); setError(''); }}>Пропустить</button>
            </div>
            {laterHistory && <p className="owned-schedule-note">Перенос недоступен: после этой тренировки уже сохранён результат. Её можно только пропустить.</p>}
          </>}
          {actionable && panel === 'reschedule' && !laterHistory && <div className="owned-schedule-confirm">
            <label><span>Новая дата</span><input type="date" min={today} value={rescheduleDate} onChange={(event) => { setRescheduleDate(event.target.value); setError(''); }} /></label>
            {hint && <small>{hint}</small>}
            <p>Эта и все следующие невыполненные тренировки будут пересчитаны по ритму программы.</p>
            <div className="owned-schedule-action-pair">
              <button type="button" className="owned-schedule-action" disabled={busy} onClick={() => setPanel(null)}>Отмена</button>
              <button type="button" className="owned-schedule-action primary" disabled={busy || !rescheduleDate || !isAllowedStartDate(rescheduleDate, scheduleMode)} onClick={() => submitReschedule(item)}>{busy ? 'Переносим…' : 'Сохранить'}</button>
            </div>
          </div>}
          {actionable && panel === 'skip' && <div className="owned-schedule-confirm">
            <strong>Пропустить тренировку?</strong>
            <p>Она останется в истории со статусом «Пропущена». Остальные даты не изменятся.</p>
            <div className="owned-schedule-action-pair">
              <button type="button" className="owned-schedule-action" disabled={busy} onClick={() => setPanel(null)}>Отмена</button>
              <button type="button" className="owned-schedule-action danger" disabled={busy} onClick={() => submitSkip(item)}>{busy ? 'Пропускаем…' : 'Да, пропустить'}</button>
            </div>
          </div>}
          {error && <div className="owned-schedule-error" role="alert">{error}</div>}
        </div>}
      </li>;
    })}
  </ol>;
}
