-- Issue #140: two things stopped a second workout on the same day.
--
-- 1. No exercise from the shared base could be added to a workout. add_session_exercise (and the
--    older add_standalone_exercise) looked the exercise up in exercise_catalog_v2, which lists
--    'published' rows and the user's own. Since the base was rebuilt sheet by sheet its shared rows
--    are 'legacy', none is 'published', so every shared exercise was refused with
--    'Exercise not available'. A one-off workout starts empty, so it could not be filled at all.
--    Rule now: any exercise the caller can read that is not retired. Row level security already
--    limits reading to the shared base, the user's own exercises and the ones received with a
--    shared program; retired rows are the ones hidden from every picker.
--
-- 2. The next workout of a program could not be moved to a day that already holds its previous
--    workout, so after finishing today's workout the next one could not be done today.
--    Rule now: dates still follow the order of the program, but neighbours may share a day. A
--    workout can be moved to the date of the previous one and, when only it is moved, to the date
--    of the next one.
--
-- Each function below is the current definition with only these checks changed.

create or replace function public.add_session_exercise(p_session_id uuid, p_exercise_id uuid, p_scope text default 'session')
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_scheduled_workout_id uuid;
  v_template_workout_id uuid;
  v_name text;
  v_template_exercise_id uuid;
  v_target record;
  v_planned_exercise_id uuid;
  v_planned_set_id uuid;
  v_source_exercise_id uuid;
  v_source_set_id uuid;
  v_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_scope is null or p_scope not in ('session', 'program') then
    raise exception 'Invalid add scope' using errcode = '22023';
  end if;
  -- The lock lines up two quick taps, so they cannot take the same position.
  select ws.scheduled_workout_id, sw.source_program_workout_id
    into v_scheduled_workout_id, v_template_workout_id
  from public.workout_sessions ws
  left join public.scheduled_workouts sw on sw.id = ws.scheduled_workout_id
  where ws.id = p_session_id and ws.user_id = v_user_id and ws.status = 'active' and ws.paused_at is null
  for update of ws;
  if not found then
    raise exception 'Active workout session not found or access denied' using errcode = '42501';
  end if;
  if p_scope = 'program' and not exists (
    select 1
    from public.program_workouts w
    join public.program_weeks pw on pw.id = w.week_id
    join public.programs p on p.id = pw.program_id
    where w.id = v_template_workout_id and p.owner_id = v_user_id
  ) then
    raise exception 'This workout is not linked to a program workout' using errcode = '22023';
  end if;
  -- Every exercise the caller can read that is not retired: what the exercise picker shows (#140).
  select e.name into v_name from public.exercises e where e.id = p_exercise_id and e.status is distinct from 'retired';
  if not found then
    raise exception 'Exercise not available' using errcode = '22023';
  end if;

  if p_scope = 'program' then
    insert into public.program_workout_exercises (workout_id, exercise_id, exercise_name_snapshot, position)
      select v_template_workout_id, p_exercise_id, v_name, coalesce(max(pwe.position), 0) + 1
      from public.program_workout_exercises pwe where pwe.workout_id = v_template_workout_id
      returning id into v_template_exercise_id;
    insert into public.program_exercise_sets (workout_exercise_id, set_number, reps)
      values (v_template_exercise_id, 1, null);

    for v_target in
      select sw.id
      from public.scheduled_workouts sw
      join public.user_programs up on up.id = sw.user_program_id
      where up.user_id = v_user_id
        and sw.source_program_workout_id = v_template_workout_id
        and (
          sw.id = v_scheduled_workout_id
          or (up.status in ('active', 'paused') and sw.status = 'scheduled'
              and not exists (select 1 from public.workout_sessions s where s.scheduled_workout_id = sw.id))
        )
    loop
      insert into public.scheduled_workout_exercises (scheduled_workout_id, source_program_workout_exercise_id, exercise_id, exercise_name_snapshot, position)
        select v_target.id, v_template_exercise_id, p_exercise_id, v_name, coalesce(max(swe.position), 0) + 1
        from public.scheduled_workout_exercises swe where swe.scheduled_workout_id = v_target.id
        returning id into v_planned_exercise_id;
      insert into public.scheduled_sets (scheduled_workout_exercise_id, set_number, planned_reps)
        values (v_planned_exercise_id, 1, null)
        returning id into v_planned_set_id;
      if v_target.id = v_scheduled_workout_id then
        v_source_exercise_id := v_planned_exercise_id;
        v_source_set_id := v_planned_set_id;
      end if;
    end loop;
  end if;

  -- Linked to this workout's plan when it went into the program, so it can later be moved
  -- in all such workouts too.
  insert into public.workout_session_exercises (workout_session_id, source_scheduled_workout_exercise_id, exercise_id, exercise_name_snapshot, position)
    select p_session_id, v_source_exercise_id, p_exercise_id, v_name, coalesce(max(wse.position), 0) + 1
    from public.workout_session_exercises wse where wse.workout_session_id = p_session_id
    returning id into v_id;
  insert into public.performed_sets (workout_session_exercise_id, source_scheduled_set_id, set_number, set_type)
    values (v_id, v_source_set_id, 1, 'working');
  return v_id;
end;
$$;

create or replace function public.add_standalone_exercise(p_session_id uuid, p_exercise_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
  v_position integer;
  v_name text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  perform 1 from public.workout_sessions ws join public.scheduled_workouts sw on sw.id=ws.scheduled_workout_id
    where ws.id=p_session_id and ws.user_id=auth.uid() and ws.status='active' and ws.paused_at is null
      and sw.standalone_owner_id=auth.uid() and sw.user_program_id is null for update of ws;
  if not found then raise exception 'Active standalone session not found' using errcode='42501'; end if;
  select e.name into v_name from public.exercises e where e.id = p_exercise_id and e.status is distinct from 'retired';
  if not found then raise exception 'Exercise not available' using errcode='22023'; end if;
  select coalesce(max(position),0)+1 into v_position from public.workout_session_exercises where workout_session_id=p_session_id;
  insert into public.workout_session_exercises(workout_session_id,exercise_id,exercise_name_snapshot,position)
    values(p_session_id,p_exercise_id,v_name,v_position) returning id into v_id;
  -- No planned sets, weights or repetitions are copied.
  return v_id;
end;
$$;

CREATE OR REPLACE FUNCTION public.reschedule_scheduled_workout(p_scheduled_workout_id uuid, p_new_date date)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_user_program_id uuid;
  v_program_id uuid;
  v_sequence_number integer;
  v_schedule_mode text;
  v_structure_mode text;
  v_previous_date date;
  v_current_date date := p_new_date;
  v_template_count integer;
  v_template_index integer;
  v_rest_days_after integer;
  v_isodow integer;
  v_row record;
  v_weekdays integer[];
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_new_date is null then raise exception 'New workout date is required' using errcode = '22023'; end if;
  if p_new_date < current_date then raise exception 'New workout date cannot be in the past' using errcode = '22023'; end if;

  select sw.user_program_id, sw.sequence_number, up.program_id, p.schedule_mode, p.structure_mode,
         case when p.schedule_mode = 'custom' then up.training_weekdays end
  into v_user_program_id, v_sequence_number, v_program_id, v_schedule_mode, v_structure_mode, v_weekdays
  from public.scheduled_workouts sw
  join public.user_programs up on up.id = sw.user_program_id
  join public.programs p on p.id = up.program_id
  where sw.id = p_scheduled_workout_id
    and sw.status = 'scheduled'
    and up.user_id = v_user_id
    and up.status = 'active'
  for update of sw, up;

  if v_user_program_id is null then
    raise exception 'Active scheduled workout not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.workout_sessions ws
    join public.scheduled_workouts sw on sw.id = ws.scheduled_workout_id
    where sw.user_program_id = v_user_program_id
      and ws.user_id = v_user_id
      and ws.status = 'active'
  ) then
    raise exception 'Cannot reschedule during an active workout' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.scheduled_workouts sw
    where sw.user_program_id = v_user_program_id
      and sw.sequence_number > v_sequence_number
      and sw.status in ('completed', 'skipped')
  ) then
    raise exception 'Cannot reschedule before later workout history' using errcode = '22023';
  end if;

  select max(sw.scheduled_date)
  into v_previous_date
  from public.scheduled_workouts sw
  where sw.user_program_id = v_user_program_id
    and sw.sequence_number < v_sequence_number
    and sw.status <> 'cancelled';

  if v_previous_date is not null and p_new_date < v_previous_date then
    raise exception 'New workout date cannot be before the previous workout' using errcode = '22023';
  end if;

  v_isodow := extract(isodow from p_new_date)::integer;
  if v_schedule_mode = 'weekly_mwf' and v_isodow not in (1, 3, 5) then
    raise exception 'Workout date must be Monday, Wednesday or Friday' using errcode = '22023';
  end if;
  if v_schedule_mode = 'weekly_tts' and v_isodow not in (2, 4, 6) then
    raise exception 'Workout date must be Tuesday, Thursday or Saturday' using errcode = '22023';
  end if;

  select count(*)
  into v_template_count
  from public.program_weeks pw
  join public.program_workouts w on w.week_id = pw.id
  where pw.program_id = v_program_id;

  for v_row in
    select sw.id, sw.sequence_number, sw.status
    from public.scheduled_workouts sw
    where sw.user_program_id = v_user_program_id
      and sw.sequence_number >= v_sequence_number
    order by sw.sequence_number
  loop
    if v_row.status = 'scheduled' then
      update public.scheduled_workouts
      set scheduled_date = v_current_date
      where id = v_row.id;
    end if;

    if v_weekdays is not null then
      loop
        v_current_date := v_current_date + 1;
        exit when extract(isodow from v_current_date)::integer = any(v_weekdays);
      end loop;
    elsif v_schedule_mode = 'weekly_mwf' then
      loop
        v_current_date := v_current_date + 1;
        exit when extract(isodow from v_current_date)::integer in (1, 3, 5);
      end loop;
    elsif v_schedule_mode = 'weekly_tts' then
      loop
        v_current_date := v_current_date + 1;
        exit when extract(isodow from v_current_date)::integer in (2, 4, 6);
      end loop;
    elsif v_schedule_mode = 'cycle_2_2' then
      v_current_date := v_current_date + case when mod(v_row.sequence_number, 2) = 1 then 1 else 3 end;
    else
      v_template_index := case
        when v_structure_mode = 'cycle' and v_template_count > 0
          then mod(v_row.sequence_number - 1, v_template_count) + 1
        else v_row.sequence_number
      end;

      select numbered.rest_days_after
      into v_rest_days_after
      from (
        select row_number() over(order by pw.position, w.position)::integer as sequence_number,
               w.rest_days_after
        from public.program_weeks pw
        join public.program_workouts w on w.week_id = pw.id
        where pw.program_id = v_program_id
      ) numbered
      where numbered.sequence_number = v_template_index;

      v_current_date := v_current_date + (1 + coalesce(v_rest_days_after, 1));
    end if;
  end loop;

  update public.user_programs
  set start_date = case when v_sequence_number = 1 then p_new_date else start_date end,
      updated_at = now()
  where id = v_user_program_id and user_id = v_user_id;

  return p_scheduled_workout_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reschedule_scheduled_workout_scoped(p_scheduled_workout_id uuid, p_new_date date, p_scope text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_user_program_id uuid;
  v_program_id uuid;
  v_sequence_number integer;
  v_schedule_mode text;
  v_structure_mode text;
  v_current_status text;
  v_has_later_completed boolean := false;
  v_previous_date date;
  v_next_date date;
  v_current_date date := p_new_date;
  v_template_count integer;
  v_template_index integer;
  v_rest_days_after integer;
  v_isodow integer;
  v_row record;
  v_weekdays integer[];
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_new_date is null then raise exception 'New workout date is required' using errcode = '22023'; end if;
  if p_new_date < current_date then raise exception 'New workout date cannot be in the past' using errcode = '22023'; end if;
  if p_scope not in ('single', 'tail') then raise exception 'Invalid reschedule scope' using errcode = '22023'; end if;

  select sw.user_program_id, sw.sequence_number, sw.status, up.program_id, p.schedule_mode, p.structure_mode,
         case when p.schedule_mode = 'custom' then up.training_weekdays end
  into v_user_program_id, v_sequence_number, v_current_status, v_program_id, v_schedule_mode, v_structure_mode, v_weekdays
  from public.scheduled_workouts sw
  join public.user_programs up on up.id = sw.user_program_id
  join public.programs p on p.id = up.program_id
  where sw.id = p_scheduled_workout_id
    and sw.status in ('scheduled', 'skipped')
    and up.user_id = v_user_id
    and up.status = 'active'
  for update of sw, up;

  if v_user_program_id is null then
    raise exception 'Active editable workout not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.workout_sessions ws
    join public.scheduled_workouts sw on sw.id = ws.scheduled_workout_id
    where sw.user_program_id = v_user_program_id
      and ws.user_id = v_user_id
      and ws.status = 'active'
  ) then
    raise exception 'Cannot reschedule during an active workout' using errcode = '22023';
  end if;

  select exists (
    select 1
    from public.scheduled_workouts sw
    where sw.user_program_id = v_user_program_id
      and sw.sequence_number > v_sequence_number
      and sw.status = 'completed'
  ) into v_has_later_completed;

  if v_current_status = 'scheduled' and v_has_later_completed then
    raise exception 'Cannot reschedule before later workout history' using errcode = '22023';
  end if;
  if p_scope = 'tail' and v_has_later_completed then
    raise exception 'Cannot reschedule before later workout history' using errcode = '22023';
  end if;

  select max(sw.scheduled_date)
  into v_previous_date
  from public.scheduled_workouts sw
  where sw.user_program_id = v_user_program_id
    and sw.sequence_number < v_sequence_number
    and sw.status <> 'cancelled';

  if not (v_current_status = 'skipped' and v_has_later_completed) then
    if v_previous_date is not null and p_new_date < v_previous_date then
      raise exception 'New workout date cannot be before the previous workout' using errcode = '22023';
    end if;
  end if;

  if p_scope = 'single' then
    if not (v_current_status = 'skipped' and v_has_later_completed) then
      select min(sw.scheduled_date)
      into v_next_date
      from public.scheduled_workouts sw
      where sw.user_program_id = v_user_program_id
        and sw.sequence_number > v_sequence_number
        and sw.status <> 'cancelled';

      if v_next_date is not null and p_new_date > v_next_date then
        raise exception 'New workout date cannot be after the next workout' using errcode = '22023';
      end if;
    end if;

    update public.scheduled_workouts
    set scheduled_date = p_new_date,
        status = 'scheduled'
    where id = p_scheduled_workout_id
      and status in ('scheduled', 'skipped');

    update public.user_programs
    set start_date = case when v_sequence_number = 1 and not v_has_later_completed then p_new_date else start_date end,
        updated_at = now()
    where id = v_user_program_id and user_id = v_user_id;

    return p_scheduled_workout_id;
  end if;

  v_isodow := extract(isodow from p_new_date)::integer;
  if v_schedule_mode = 'weekly_mwf' and v_isodow not in (1, 3, 5) then
    raise exception 'Workout date must be Monday, Wednesday or Friday' using errcode = '22023';
  end if;
  if v_schedule_mode = 'weekly_tts' and v_isodow not in (2, 4, 6) then
    raise exception 'Workout date must be Tuesday, Thursday or Saturday' using errcode = '22023';
  end if;

  select count(*)
  into v_template_count
  from public.program_weeks pw
  join public.program_workouts w on w.week_id = pw.id
  where pw.program_id = v_program_id;

  for v_row in
    select sw.id, sw.sequence_number, sw.status
    from public.scheduled_workouts sw
    where sw.user_program_id = v_user_program_id
      and sw.sequence_number >= v_sequence_number
    order by sw.sequence_number
  loop
    if v_row.status in ('scheduled', 'skipped') then
      update public.scheduled_workouts
      set scheduled_date = v_current_date,
          status = 'scheduled'
      where id = v_row.id;
    end if;

    if v_weekdays is not null then
      loop
        v_current_date := v_current_date + 1;
        exit when extract(isodow from v_current_date)::integer = any(v_weekdays);
      end loop;
    elsif v_schedule_mode = 'weekly_mwf' then
      loop
        v_current_date := v_current_date + 1;
        exit when extract(isodow from v_current_date)::integer in (1, 3, 5);
      end loop;
    elsif v_schedule_mode = 'weekly_tts' then
      loop
        v_current_date := v_current_date + 1;
        exit when extract(isodow from v_current_date)::integer in (2, 4, 6);
      end loop;
    elsif v_schedule_mode = 'cycle_2_2' then
      v_current_date := v_current_date + case when mod(v_row.sequence_number, 2) = 1 then 1 else 3 end;
    else
      v_template_index := case
        when v_structure_mode = 'cycle' and v_template_count > 0
          then mod(v_row.sequence_number - 1, v_template_count) + 1
        else v_row.sequence_number
      end;

      select numbered.rest_days_after
      into v_rest_days_after
      from (
        select row_number() over(order by pw.position, w.position)::integer as sequence_number,
               w.rest_days_after
        from public.program_weeks pw
        join public.program_workouts w on w.week_id = pw.id
        where pw.program_id = v_program_id
      ) numbered
      where numbered.sequence_number = v_template_index;

      v_current_date := v_current_date + (1 + coalesce(v_rest_days_after, 1));
    end if;
  end loop;

  update public.user_programs
  set start_date = case when v_sequence_number = 1 then p_new_date else start_date end,
      updated_at = now()
  where id = v_user_program_id and user_id = v_user_id;

  return p_scheduled_workout_id;
end;
$function$;
