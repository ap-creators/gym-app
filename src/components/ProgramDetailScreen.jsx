import { useEffect, useMemo, useState } from 'react';
import { getProgram, archiveUserProgram } from '../lib/programs.js';
import { markScheduledWorkoutCompleted } from '../lib/workoutSessions.js';
import { ShareProgramButton } from './ShareProgramButton.jsx';
import { ProgramOverviewIntro, ProgramOverviewMeta, ProgramDetailTabs, ProgramOverviewDescription } from './ProgramOverview.jsx';
import { completeProgram, pauseProgram, resumeProgram } from '../lib/programParticipation.js';
import { rescheduleScheduledWorkout, skipScheduledWorkout } from '../lib/scheduledWorkoutControls.js';
import { supabase } from '../lib/supabase.js';
import '../program-detail.css';
import '../program-participation-controls.css';
import { formatRussianCount } from '../lib/formatRussianCount.js';
import { ProgramWorkoutBlock } from './ProgramWorkoutBlock.jsx';
import { ProgramScheduleList } from './ProgramScheduleList.jsx';
import { isAllowedStartDate, localToday, startDateHint } from '../lib/programSchedule.js';

function BackIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m15 5-7 7 7 7" /></svg>; }
function PencilIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M4.5 19.5 5.8 14 15.9 3.9a2.1 2.1 0 0 1 3 0l1.2 1.2a2.1 2.1 0 0 1 0 3L10 18.2l-5.5 1.3Z" /><path d="m14.7 5.1 4.2 4.2" /></svg>; }
function TrashIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M10 7V4h4v3m-8 0 1 13h10l1-13M10 11v6M14 11v6" /></svg>; }
function PauseIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M9 5v14M15 5v14" /></svg>; }
function ResumeIcon() { return <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m8 5 11 7-11 7Z" /></svg>; }
function CloseProgramIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19" /></svg>; }
function CalendarIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3.5" y="5.5" width="17" height="15" rx="3" /><path d="M8 3.5v4M16 3.5v4M3.5 10h17" /></svg>; }
function participationLabel(participation) { if (!participation) return 'Не начата'; if (participation.status === 'paused') return 'На паузе'; if (participation.status === 'completed') return 'Завершена'; if (participation.status === 'cancelled') return 'Отменена'; if (participation.startDate > localToday()) return 'Запланирована'; return 'Активна'; }

async function attachScheduledSnapshot(program) {
  if (!program?.participation || !program.scheduledWorkouts.length) return program;
  const ids = program.scheduledWorkouts.map((item) => item.id);
  const { data: rows, error } = await supabase.from('scheduled_workout_exercises').select('id, scheduled_workout_id, exercise_id, exercise_name_snapshot, prescription_snapshot, position').in('scheduled_workout_id', ids).order('position', { ascending: true });
  if (error) throw new Error('Не удалось загрузить сохранённый состав тренировок.');
  const exerciseIds = [...new Set((rows ?? []).map((row) => row.exercise_id).filter(Boolean))];
  let canonical = [];
  if (exerciseIds.length) {
    const response = await supabase.from('exercises').select('id, name, muscle_group').in('id', exerciseIds);
    if (response.error) throw new Error('Не удалось загрузить данные упражнений программы.');
    canonical = response.data ?? [];
  }
  const byId = new Map(canonical.map((item) => [item.id, item]));
  const byWorkout = new Map();
  (rows ?? []).forEach((row) => {
    const source = row.exercise_id ? byId.get(row.exercise_id) : null;
    const list = byWorkout.get(row.scheduled_workout_id) ?? [];
    list.push({ id: row.exercise_id ?? row.id, name: row.exercise_name_snapshot || source?.name || 'Упражнение', prescription: row.prescription_snapshot ?? '', muscle_group: source?.muscle_group ?? '' });
    byWorkout.set(row.scheduled_workout_id, list);
  });
  return { ...program, scheduledWorkouts: program.scheduledWorkouts.map((item) => ({ ...item, exercises: byWorkout.get(item.id) ?? [] })) };
}

export function ProgramDetailScreen({ programId, onBack, onEdit, onStart, onDeleted, onOpenWorkout }) {
  const [program, setProgram] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingStartDate, setEditingStartDate] = useState(false);
  const [startDateDraft, setStartDateDraft] = useState('');
  const [startDateSaving, setStartDateSaving] = useState(false);
  const [startDateError, setStartDateError] = useState('');
  const [participationAction, setParticipationAction] = useState('');
  const [participationError, setParticipationError] = useState('');
  const [resumeOpen, setResumeOpen] = useState(false);
  const [resumeDate, setResumeDate] = useState(localToday());
  const [resumeError, setResumeError] = useState('');
  const [completeConfirmOpen, setCompleteConfirmOpen] = useState(false);
  const [detailTab, setDetailTab] = useState('description');
  useEffect(() => {
    if (detailTab === 'schedule' && program?.participation?.status !== 'active') setDetailTab('workouts');
  }, [detailTab, program?.participation?.status]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [manualWorkoutId,setManualWorkoutId] = useState(null);
  const [manualWorkoutDate,setManualWorkoutDate] = useState(localToday());
  const [manualWorkoutBusy,setManualWorkoutBusy] = useState(false);
  const [manualWorkoutError,setManualWorkoutError] = useState('');

  async function reloadProgram() {
    const hydrated = await attachScheduledSnapshot(await getProgram(programId));
    setProgram(hydrated);
    setStartDateDraft(hydrated.participation?.startDate ?? '');
    return hydrated;
  }

  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    getProgram(programId).then(attachScheduledSnapshot).then((data) => { if (active) { setProgram(data); setStartDateDraft(data.participation?.startDate ?? ''); } }).catch((requestError) => { if (active) setError(requestError?.message || 'Не удалось открыть программу.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [programId]);

  const templateWorkouts = useMemo(() => program ? program.programWeeks.flatMap((group) => group.workouts.map((workout) => ({ sourceGroup: group.number, workout }))) : [], [program]);
  if (loading) return <div className="phone program-detail-phone"><div className="program-detail-state"><div className="exercise-list-spinner" /><span>Загружаем программу…</span></div></div>;
  if (error || !program) return <div className="phone program-detail-phone"><header className="program-detail-header"><button type="button" onClick={onBack}><BackIcon /></button><strong>Программа</strong><span /></header><div className="program-detail-state error">{error || 'Программа не найдена.'}</div></div>;

  const isCycle = program.structureMode === 'cycle';
  const participation = program.participation;
  const participationTone = participation?.status === 'completed' ? 'completed' : participation?.status === 'paused' ? 'paused' : participation?.status === 'active' ? 'active' : 'not-started';
  const isActive = participation?.status === 'active';
  const isPaused = participation?.status === 'paused';
  const liveParticipation = Boolean(isActive || isPaused);
  const canStart = !participation || ['completed', 'cancelled'].includes(participation.status);
  const isUserCreated = !program.sourceCatalogProgramId;
  const canEditProgram = !(liveParticipation && !isCycle);
  const canEditStartDate = Boolean(isActive && program.scheduledWorkouts.length && program.scheduledWorkouts.every((item) => item.status === 'scheduled'));
  const totalTemplateWorkouts = templateWorkouts.length;
  const totalPlannedWorkouts = isCycle ? totalTemplateWorkouts * program.cycleRepeatCount : totalTemplateWorkouts;
  const totalExercises = templateWorkouts.reduce((sum, item) => sum + item.workout.exercises.length, 0);
  const dateAllowed = isAllowedStartDate(startDateDraft, program.scheduleMode);
  const dateChanged = startDateDraft && startDateDraft !== participation?.startDate;
  const resumeDateAllowed = isAllowedStartDate(resumeDate, program.scheduleMode);

  async function saveStartDate() {
    if (!canEditStartDate || startDateSaving || !dateChanged) return;
    if (startDateDraft < localToday()) { setStartDateError('Дата начала не может быть в прошлом.'); return; }
    if (!dateAllowed) { setStartDateError(startDateHint(program.scheduleMode)); return; }
    setStartDateSaving(true); setStartDateError('');
    try {
      const { error: changeError } = await supabase.rpc('change_program_start_date', { p_user_program_id: participation.id, p_start_date: startDateDraft });
      if (changeError) throw changeError;
      await reloadProgram(); setEditingStartDate(false);
    } catch (changeError) {
      if (changeError?.message?.includes('already started') || changeError?.message?.includes('workout history')) setStartDateError('Программа уже фактически началась. Дату начала больше нельзя изменить.');
      else setStartDateError('Не удалось изменить дату начала.');
    } finally { setStartDateSaving(false); }
  }

  async function handlePause() {
    if (!isActive || participationAction) return;
    setParticipationAction('pause'); setParticipationError('');
    try {
      await pauseProgram(participation.id);
      await reloadProgram();
      setEditingStartDate(false);
    } catch (actionError) {
      setParticipationError(actionError?.message || 'Не удалось поставить программу на паузу.');
    } finally {
      setParticipationAction('');
    }
  }

  async function handleResume() {
    if (!isPaused || participationAction) return;
    if (resumeDate < localToday()) { setResumeError('Дата следующей тренировки не может быть в прошлом.'); return; }
    if (!resumeDateAllowed) { setResumeError(startDateHint(program.scheduleMode)); return; }
    setParticipationAction('resume'); setResumeError(''); setParticipationError('');
    try {
      await resumeProgram(participation.id, resumeDate);
      await reloadProgram();
      setResumeOpen(false);
    } catch (actionError) {
      setResumeError(actionError?.message || 'Не удалось возобновить программу.');
    } finally {
      setParticipationAction('');
    }
  }

  async function handleComplete() {
    if (!liveParticipation || participationAction) return;
    setParticipationAction('complete'); setParticipationError('');
    try {
      await completeProgram(participation.id);
      await reloadProgram();
      setCompleteConfirmOpen(false);
      setResumeOpen(false);
    } catch (actionError) {
      setParticipationError(actionError?.message || 'Не удалось завершить программу.');
    } finally {
      setParticipationAction('');
    }
  }

  async function handleDelete() {
    if (!isUserCreated || deletePending) return;
    setDeletePending(true); setDeleteError('');
    try {
      await archiveUserProgram(program.id);
      setDeleteOpen(false);
      onDeleted?.(program.id);
    } catch (error) {
      setDeleteError(error?.message || 'Не удалось удалить программу.');
    } finally {
      setDeletePending(false);
    }
  }

  async function completeManually(scheduledId) {
    if(manualWorkoutBusy)return;
    setManualWorkoutBusy(true);setManualWorkoutError('');
    try{
      const finished=await markScheduledWorkoutCompleted(scheduledId,manualWorkoutDate);
      setManualWorkoutId(null);
      await reloadProgram();
      onOpenWorkout?.(finished.workout.id);
    }catch(e){setManualWorkoutError(e?.message||'Не удалось отметить тренировку.');}
    finally{setManualWorkoutBusy(false);}
  }

  return <div className="phone program-detail-phone">
    <header className="program-detail-header program-detail-header-tabs program-detail-header-stacked">
      <div className="program-detail-topline"><button type="button" aria-label="Назад" onClick={onBack}><BackIcon /></button></div>
      <ProgramDetailTabs value={detailTab} onChange={setDetailTab} scope="owned" showSchedule={isActive} />
    </header>
    <main className="program-detail-content">
      {detailTab === 'description' && <div id="owned-description-panel" role="tabpanel" aria-labelledby="owned-description-tab">
      <ProgramOverviewIntro program={program} coverUrl={program.coverUrl} statusText={participationLabel(participation)} statusTone={participationTone} />

      <ProgramOverviewMeta program={program} />
      <ProgramOverviewDescription description={program.description} />

      {(liveParticipation || isUserCreated) && <div className="program-detail-actions-row" role="group" aria-label="Действия с программой">
        {liveParticipation && <div className={`program-participation-controls${isPaused ? ' two' : ''}`}>
          {isActive && <button className="program-participation-action secondary" type="button" aria-label="Поставить программу на паузу" title="Пауза" disabled={Boolean(participationAction)} onClick={handlePause}><PauseIcon /></button>}
          {isPaused && <button className="program-participation-action primary" type="button" aria-label="Продолжить программу" title="Продолжить" disabled={Boolean(participationAction)} onClick={() => { setResumeDate(localToday()); setResumeError(''); setResumeOpen(true); setCompleteConfirmOpen(false); }}><ResumeIcon /></button>}
          <button className="program-participation-action danger" type="button" aria-label="Завершить программу" title="Завершить программу" disabled={Boolean(participationAction)} onClick={() => { setCompleteConfirmOpen(true); setResumeOpen(false); }}><CloseProgramIcon /></button>
        </div>}
        {isUserCreated && <div className="program-detail-end-actions">
        <button type="button" className="program-detail-delete-trigger" aria-label="Удалить программу" title="Удалить программу" onClick={() => { setDeleteError(''); setDeleteOpen(true); }}><TrashIcon /></button>
        <ShareProgramButton programId={program.id} />
      </div>}
      </div>}

      {(canEditStartDate || participationError || (isPaused && resumeOpen) || (liveParticipation && completeConfirmOpen)) && <section className="program-detail-management" aria-label="Управление программой">
        {canEditStartDate && !editingStartDate && <button type="button" className="program-detail-inline-action" onClick={() => { setStartDateDraft(participation.startDate); setStartDateError(''); setEditingStartDate(true); }}>Изменить дату начала</button>}
        {canEditStartDate && editingStartDate && <div className="program-detail-date-editor">
          <label><span>Новая дата первой тренировки</span><input type="date" min={localToday()} value={startDateDraft} onChange={(event) => { setStartDateDraft(event.target.value); setStartDateError(''); }} /></label>
          {startDateHint(program.scheduleMode) && <small>{startDateHint(program.scheduleMode)}</small>}
          {startDateError && <small className="error">{startDateError}</small>}
          <div><button type="button" onClick={() => setEditingStartDate(false)}>Отмена</button><button type="button" onClick={saveStartDate} disabled={startDateSaving || !dateChanged || !dateAllowed}>{startDateSaving ? 'Сохраняем…' : 'Сохранить'}</button></div>
        </div>}
        {isPaused && resumeOpen && <div className="program-resume-editor"><label><span>Дата следующей тренировки</span><input type="date" min={localToday()} value={resumeDate} onChange={(event) => { setResumeDate(event.target.value); setResumeError(''); }} /></label>{startDateHint(program.scheduleMode) && <small>{startDateHint(program.scheduleMode)}</small>}{resumeError && <small className="error">{resumeError}</small>}<div className="program-resume-actions"><button type="button" disabled={Boolean(participationAction)} onClick={() => setResumeOpen(false)}>Отмена</button><button type="button" disabled={Boolean(participationAction) || !resumeDate || !resumeDateAllowed} onClick={handleResume}>{participationAction === 'resume' ? 'Возобновляем…' : 'Возобновить'}</button></div></div>}

        {liveParticipation && completeConfirmOpen && <div className="program-complete-confirm"><strong>Завершить программу?</strong><span>Выполненная история сохранится. Все оставшиеся невыполненные тренировки будут убраны из календаря.</span><div className="program-complete-actions"><button type="button" disabled={Boolean(participationAction)} onClick={() => setCompleteConfirmOpen(false)}>Отмена</button><button type="button" disabled={Boolean(participationAction)} onClick={handleComplete}>{participationAction === 'complete' ? 'Завершаем…' : 'Да, завершить'}</button></div></div>}

        {participationError && <div className="program-participation-message" role="alert">{participationError}</div>}

      </section>}

      </div>}
      {detailTab === 'workouts' && <div id="owned-workouts-panel" role="tabpanel" aria-labelledby="owned-workouts-tab">
        <section className="program-detail-section">
          <div className="program-detail-section-head"><h2>Один цикл тренировок</h2></div>
          <div className="catalog-workout-list">
            {templateWorkouts.map(({ workout }, index) =>
              <ProgramWorkoutBlock key={workout.id || index} workout={workout} index={index} />)}
          </div>
        </section>
      </div>}
      {detailTab === 'schedule' && isActive && <div id="owned-schedule-panel" role="tabpanel" aria-labelledby="owned-schedule-tab">
        <div className="program-schedule-summary">
          <strong>График тренировок</strong>
          <span>{formatRussianCount(program.scheduledWorkouts.filter(item => item.status === 'completed').length,['тренировка выполнена','тренировки выполнены','тренировок выполнено'])} из {program.scheduledWorkouts.length}</span>
        </div>
        <ProgramScheduleList
          workouts={program.scheduledWorkouts}
          isCycle={isCycle}
          scheduleMode={program.scheduleMode}
          onOpenResult={(item) => onOpenWorkout?.(item.id)}
          onMarkComplete={(item) => { setManualWorkoutId(item.id); setManualWorkoutDate(localToday()); setManualWorkoutError(''); }}
          onReschedule={async (item, date) => { await rescheduleScheduledWorkout(item.id, date); await reloadProgram(); }}
          onSkip={async (item) => { await skipScheduledWorkout(item.id); await reloadProgram(); }}
        />
      </div>}
    </main>
    {(canStart || canEditProgram) && <footer className={`program-detail-footer${canStart && canEditProgram ? ' two-actions' : ''}`}>
      {canStart && <button className="program-detail-start-button" type="button" onClick={() => onStart?.(program.id)}><CalendarIcon /><span>{participation ? 'Начать программу заново' : 'Начать программу'}</span></button>}
      {canEditProgram && <button className="program-detail-edit-button" type="button" onClick={() => onEdit?.(program.id)}><PencilIcon /><span>Редактировать программу</span></button>}
    </footer>}
    {manualWorkoutId && <div className="program-detail-delete-overlay" role="presentation">
      <button type="button" className="program-detail-delete-scrim" aria-label="Закрыть" onClick={()=>setManualWorkoutId(null)} disabled={manualWorkoutBusy}/>
      <section className="program-detail-delete-dialog" role="dialog" aria-modal="true" aria-label="Отметить выполненной">
        <h2>Отметить выполненной?</h2>
        <p>Веса и повторы по возможности возьмём из предыдущей тренировки. После сохранения их можно изменить.</p>
        <label className="manual-workout-date-label">Дата выполнения
          <input type="date" value={manualWorkoutDate} max={localToday()} onChange={event=>setManualWorkoutDate(event.target.value)}/>
        </label>
        {manualWorkoutError && <p className="completed-editor-error" role="alert">{manualWorkoutError}</p>}
        <div className="program-detail-delete-buttons">
          <button type="button" onClick={()=>setManualWorkoutId(null)} disabled={manualWorkoutBusy}>Отмена</button>
          <button type="button" disabled={manualWorkoutBusy || !manualWorkoutDate || manualWorkoutDate > localToday()}
            onClick={()=>completeManually(manualWorkoutId)}>{manualWorkoutBusy?'Сохраняем…':'Отметить выполненной'}</button>
        </div>
      </section>
    </div>}
    {deleteOpen && <div className="program-detail-delete-overlay" role="presentation">
      <button type="button" className="program-detail-delete-scrim" aria-label="Закрыть подтверждение" disabled={deletePending} onClick={() => setDeleteOpen(false)} />
      <section className="program-detail-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="program-delete-title">
        <h2 id="program-delete-title">Удалить программу?</h2>
        <p>«{program.name}» исчезнет из «Моих программ». История выполненных тренировок сохранится.</p>
        {liveParticipation && <p className="program-detail-delete-error" role="alert">Сначала завершите активную или приостановленную программу.</p>}
        {deleteError && <p className="program-detail-delete-error" role="alert">{deleteError}</p>}
        <div className="program-detail-delete-buttons">
          <button type="button" disabled={deletePending} onClick={() => setDeleteOpen(false)}>Отмена</button>
          <button type="button" className="danger" disabled={deletePending || liveParticipation} onClick={handleDelete}>{deletePending ? 'Удаляем…' : 'Удалить'}</button>
        </div>
      </section>
    </div>}
  </div>;
}
