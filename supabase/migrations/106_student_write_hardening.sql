-- 106: правила, которые приложение проверяло только в своём коде, перенесены
-- в базу (аудит 2026-11-11).
--
-- У ученика есть свой токен и публичный ключ сайта, поэтому он может слать
-- запросы в PostgREST напрямую, мимо страниц и роутов. До этой миграции так
-- можно было:
--   * создавать попытки сверх assignments.max_attempts и перебирать ответы
--     (лимит считался только в app/student/attempt/[id]/page.tsx);
--   * удалять свои попытки;
--   * вернуть сданную попытку в in_progress (status + score = null проходили
--     триггер 029) и править ответы в сданной работе;
--   * одобрить собственную заявку на регистрацию (profiles.moderation_status),
--     снять с себя удаление, переписать ник Telegram родителя;
--   * читать страницы книг вместе с разделами ответов.
--
-- Всё, что делает само приложение под сессией ученика, остаётся разрешено:
-- создание попытки, переход not_started → in_progress, heartbeat
-- (current_task_number, last_activity_at), upsert ответа в незавершённой
-- попытке. Сервисный ключ (auth.uid() is null) триггеры не затрагивают —
-- проверка, финализация, перенос ответов и админские роуты работают как раньше.

-- ── 1. Попытки: лимит при создании ──────────────────────────────────────
-- Та же формула, что на странице попытки: завершённых (submitted/checked)
-- меньше max_attempts. Попытки в статусе expired в счёт не идут — как и там.
--
-- Незавершённых разрешаем до двух, а не одну: страница при двух одновременных
-- открытиях создаёт две попытки (в базе такие пары есть, разрыв 20–100 мс), и
-- строгий запрет превратил бы эту гонку в редирект на список заданий. После
-- того как страница научится переиспользовать попытку при отказе вставки,
-- порог можно ужать до одной и закрепить уникальным индексом.
create or replace function public.check_attempt_startable(p_assignment_id uuid, p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from assignments a
      where a.id = p_assignment_id
        and a.closed_at is null
        and (
          a.student_id = p_student_id
          or student_sees_group_assignment(a.id, p_student_id)
        )
        and (
          select count(*) from attempts t
          where t.assignment_id = a.id
            and t.student_id = p_student_id
            and t.status in ('submitted', 'checked')
        ) < greatest(coalesce(a.max_attempts, 1), 1)
    )
    and not exists (
      select 1 from student_final_results sfr
      where sfr.assignment_id = p_assignment_id
        and sfr.student_id = p_student_id
        and sfr.closed_reason is not null
    )
    and (
      select count(*) from attempts t
      where t.assignment_id = p_assignment_id
        and t.student_id = p_student_id
        and t.status in ('in_progress', 'not_started')
    ) < 2
$$;

-- В коде приложения ученик попытки не удаляет: все удаления идут сервисным
-- ключом (lib/assignments/cleanup.ts, админские роуты).
-- Откат: create policy "attempts: student deletes own" on attempts
--   for delete using (student_id = (select auth.uid()));
drop policy if exists "attempts: student deletes own" on public.attempts;

-- ── 2. Попытки: что ученик может менять ─────────────────────────────────
create or replace function public.prevent_student_self_attempt_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    if NEW.status not in ('not_started','in_progress') then
      raise exception 'Статус попытки меняется только через сдачу/проверку';
    end if;
    if NEW.score is not null or NEW.max_score is not null then
      raise exception 'Балл выставляется только при проверке';
    end if;

    if TG_OP = 'INSERT' then
      if NEW.submitted_at is not null or NEW.checked_at is not null
         or NEW.teacher_comment is not null or NEW.teacher_reviewed_at is not null
         or coalesce(NEW.submitted_late, false) then
        raise exception 'Поля сдачи и проверки заполняются только при сдаче/проверке';
      end if;
    else
      -- сданную попытку нельзя «открыть обратно»: раньше status = in_progress
      -- вместе со score = null проходили проверки выше
      if OLD.status not in ('not_started','in_progress') then
        raise exception 'Завершённую попытку изменить нельзя';
      end if;
      if NEW.id is distinct from OLD.id
         or NEW.assignment_id is distinct from OLD.assignment_id
         or NEW.student_id is distinct from OLD.student_id
         or NEW.created_at is distinct from OLD.created_at
         or NEW.grade_at_attempt is distinct from OLD.grade_at_attempt
         or NEW.submitted_at is distinct from OLD.submitted_at
         or NEW.checked_at is distinct from OLD.checked_at
         or NEW.teacher_comment is distinct from OLD.teacher_comment
         or NEW.teacher_reviewed_at is distinct from OLD.teacher_reviewed_at
         or NEW.submitted_late is distinct from OLD.submitted_late then
        raise exception 'Это поле попытки ученик менять не может';
      end if;
      -- время начала ставится один раз, при переходе not_started → in_progress
      if NEW.started_at is distinct from OLD.started_at and OLD.status <> 'not_started' then
        raise exception 'Время начала попытки изменить нельзя';
      end if;
    end if;
  end if;
  return NEW;
end;
$$;

-- ── 3. Ответы: только в незавершённой попытке ───────────────────────────
create or replace function public.prevent_student_self_grading()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if auth.uid() is not null then
    if TG_OP = 'INSERT' then
      if NEW.is_correct is not null or NEW.awarded_score is not null or NEW.is_locked is true then
        raise exception 'Оценка выставляется только при проверке задания';
      end if;
      if NEW.teacher_comment is not null or NEW.teacher_checked_at is not null
         or NEW.auto_checked_at is not null or NEW.locked_in_attempt_id is not null then
        raise exception 'Поля проверки заполняются только при проверке задания';
      end if;
    elsif TG_OP = 'UPDATE' then
      if NEW.is_correct is distinct from OLD.is_correct
         or NEW.awarded_score is distinct from OLD.awarded_score
         or NEW.is_locked is distinct from OLD.is_locked then
        raise exception 'Оценка выставляется только при проверке задания';
      end if;
      if OLD.is_locked then
        raise exception 'Ответ зафиксирован, изменить нельзя';
      end if;
      if NEW.id is distinct from OLD.id
         or NEW.attempt_id is distinct from OLD.attempt_id
         or NEW.task_id is distinct from OLD.task_id
         or NEW.teacher_comment is distinct from OLD.teacher_comment
         or NEW.teacher_checked_at is distinct from OLD.teacher_checked_at
         or NEW.auto_checked_at is distinct from OLD.auto_checked_at
         or NEW.locked_in_attempt_id is distinct from OLD.locked_in_attempt_id then
        raise exception 'Это поле ответа ученик менять не может';
      end if;
    end if;

    -- роут /api/attempts/[id]/answers проверяет то же самое, но прямой запрос
    -- в PostgREST его обходит
    select a.status into v_status from attempts a where a.id = NEW.attempt_id;
    if v_status is distinct from 'in_progress' then
      raise exception 'Ответ можно менять только в незавершённой попытке';
    end if;
  end if;
  return NEW;
end;
$$;

-- Политика ALL давала ученику ещё и DELETE своих ответов; приложение под
-- сессией ученика ответы только читает и делает upsert.
-- Откат: drop три политики ниже и
--   create policy "attempt_answers: student manage own" on attempt_task_answers
--   for all using (exists (select 1 from attempts a
--     where a.id = attempt_task_answers.attempt_id and a.student_id = (select auth.uid())));
drop policy if exists "attempt_answers: student manage own" on public.attempt_task_answers;

create policy "attempt_answers: student reads own" on public.attempt_task_answers
  for select using (exists (
    select 1 from attempts a
    where a.id = attempt_task_answers.attempt_id and a.student_id = (select auth.uid())));

create policy "attempt_answers: student inserts own" on public.attempt_task_answers
  for insert with check (exists (
    select 1 from attempts a
    where a.id = attempt_task_answers.attempt_id and a.student_id = (select auth.uid())));

create policy "attempt_answers: student updates own" on public.attempt_task_answers
  for update
  using (exists (
    select 1 from attempts a
    where a.id = attempt_task_answers.attempt_id and a.student_id = (select auth.uid())))
  with check (exists (
    select 1 from attempts a
    where a.id = attempt_task_answers.attempt_id and a.student_id = (select auth.uid())));

-- ── 4. Профиль: служебные поля своей строки ─────────────────────────────
-- Политика «profiles: update own» остаётся (на неё может опираться код вне
-- этого репозитория), но в своей строке теперь нельзя менять то, что ставят
-- только админ, модерация и webhook Telegram — все они пишут сервисным ключом.
-- Имя, свой ник Telegram, телефон и флаг уведомлений менять по-прежнему можно.
create or replace function public.prevent_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    if NEW.role is distinct from OLD.role then
      raise exception 'Изменение роли недоступно';
    end if;
    if NEW.organization_id is distinct from OLD.organization_id then
      raise exception 'Изменение организации недоступно';
    end if;
    if NEW.created_by is distinct from OLD.created_by then
      raise exception 'Изменение привязки к учителю недоступно';
    end if;
    if NEW.is_active is distinct from OLD.is_active then
      raise exception 'Изменение статуса активности недоступно';
    end if;

    if auth.uid() = OLD.id then
      if NEW.moderation_status is distinct from OLD.moderation_status
         or NEW.moderation_note is distinct from OLD.moderation_note
         or NEW.moderated_by is distinct from OLD.moderated_by
         or NEW.moderated_at is distinct from OLD.moderated_at then
        raise exception 'Статус заявки меняет только администратор';
      end if;
      if NEW.deleted_at is distinct from OLD.deleted_at then
        raise exception 'Изменение статуса удаления недоступно';
      end if;
      if NEW.parent_telegram_username is distinct from OLD.parent_telegram_username
         or NEW.parent_telegram_chat_id is distinct from OLD.parent_telegram_chat_id
         or NEW.telegram_chat_id is distinct from OLD.telegram_chat_id then
        raise exception 'Привязка Telegram меняется через настройки профиля или администратором';
      end if;
      if NEW.id is distinct from OLD.id
         or NEW.email is distinct from OLD.email
         or NEW.grade is distinct from OLD.grade
         or NEW.study_stage is distinct from OLD.study_stage
         or NEW.pd_consent_at is distinct from OLD.pd_consent_at
         or NEW.created_at is distinct from OLD.created_at then
        raise exception 'Это поле профиля меняет только администратор';
      end if;
    end if;
  end if;
  return NEW;
end;
$$;

-- ── 5. Книги: страницы и оглавление — только учителю и админу ───────────
-- Как у book_problems и book_index_terms. Без проверки роли страницы всех
-- книг (включая разделы ответов) читал любой вошедший: ученик и заявитель,
-- ещё не прошедший модерацию. Страницы и роуты учеников эти таблицы не читают.
-- Откат: те же политики без условия на auth_role().
drop policy if exists "book_pages: read via book" on public.book_pages;
create policy "book_pages: read via book" on public.book_pages
  for select using (
    (select auth_role()) in ('teacher', 'admin')
    and book_id in (
      select books.id from books
      where books.organization_id is null or books.organization_id = (select auth_org())));

drop policy if exists "book_sections: read via book" on public.book_sections;
create policy "book_sections: read via book" on public.book_sections
  for select using (
    (select auth_role()) in ('teacher', 'admin')
    and book_id in (
      select books.id from books
      where books.organization_id is null or books.organization_id = (select auth_org())));

-- ── 6. Права на функции ─────────────────────────────────────────────────
-- Триггерные функции вызывать через /rest/v1/rpc незачем. Срабатыванию
-- триггера право EXECUTE у вызывающей роли не нужно — так уже живут
-- handle_new_user и prevent_* (029).
revoke execute on function public.handle_new_session() from public, anon, authenticated;
revoke execute on function public.set_attempt_grade_snapshot() from public, anon, authenticated;
revoke execute on function public.trg_group_members_sync_roadmaps() from public, anon, authenticated;
revoke execute on function public.trg_teacher_students_sync_roadmaps() from public, anon, authenticated;

alter function public.current_school_year(date) set search_path = public;
alter function public.book_problem_stats() set search_path = public;
