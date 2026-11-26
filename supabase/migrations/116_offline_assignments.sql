-- Очные работы в программе (2026-11-26).
--
-- Учитель проводит тест очно (на бумаге) с учениками программы и вносит
-- результаты на сайт. Очная работа — ОБЫЧНОЕ назначение на системную группу
-- программы (assignments.mode = 'offline'), её результаты — обычные попытки
-- (attempts.is_offline = true, статус checked) с баллами по заданиям в
-- attempt_task_answers. Поэтому статистика, итог по назначению
-- (student_final_results), прогресс программы и кабинет ученика учитывают
-- очную работу без отдельной ветки кода — они строятся по тем же таблицам.
--
-- Отсутствовавшие («н») — отдельная таблица assignment_absences: это не
-- попытка и не ноль, на баллы и статистику не влияет. Отмеченный «н» может
-- написать тест онлайн (одна обычная попытка); остальные ученики очную
-- работу онлайн начать не могут — иначе присутствовавший переписал бы её
-- дома, пока учитель ещё не внёс его баллы.

alter table assignments
  add column if not exists mode text not null default 'online';
alter table assignments drop constraint if exists assignments_mode_check;
alter table assignments
  add constraint assignments_mode_check check (mode in ('online', 'offline'));
alter table assignments
  add column if not exists conducted_on date;

comment on column assignments.mode is
  'online — ученики проходят на сайте; offline — работа проведена очно, результаты вносит учитель (116)';
comment on column assignments.conducted_on is
  'Дата проведения очной работы (mode = offline)';

alter table attempts
  add column if not exists is_offline boolean not null default false;

comment on column attempts.is_offline is
  'Результат очной работы, внесённый учителем (116): ответов ученика нет, только баллы по заданиям';

create table if not exists assignment_absences (
  assignment_id uuid not null references assignments(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  marked_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (assignment_id, student_id)
);

create index if not exists idx_assignment_absences_student
  on assignment_absences (student_id);

comment on table assignment_absences is
  'Отметка «н» — ученик отсутствовал на очной работе (116). Запись только через API (service role)';

alter table assignment_absences enable row level security;

-- Чтение: ученик — свои отметки (кабинет показывает «вы отсутствовали»),
-- учитель — по своим назначениям, админ — по организации. Записи нет ни у
-- кого: отметки ставит API-роут очных результатов admin-клиентом после
-- проверки владения назначением.
drop policy if exists "assignment_absences: student read own" on assignment_absences;
create policy "assignment_absences: student read own" on assignment_absences
  for select using (student_id = (select auth.uid()));

drop policy if exists "assignment_absences: teacher read own" on assignment_absences;
create policy "assignment_absences: teacher read own" on assignment_absences
  for select using (
    (select auth_role()) = 'teacher'
    and exists (
      select 1 from assignments a
      where a.id = assignment_absences.assignment_id
        and a.created_by = (select auth.uid())
    )
  );

drop policy if exists "assignment_absences: admin read org" on assignment_absences;
create policy "assignment_absences: admin read org" on assignment_absences
  for select using (
    (select auth_role()) = 'admin'
    and check_assignment_in_auth_org(assignment_id)
  );

-- Старт попытки: очную работу онлайн может начать только отмеченный «н».
-- Остальное — без изменений (см. 107 и последующие правки).
create or replace function public.check_attempt_startable(p_assignment_id uuid, p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    exists (
      select 1 from assignments a
      where a.id = p_assignment_id
        and a.closed_at is null
        and (a.starts_at is null or a.starts_at <= now())
        and (
          a.student_id = p_student_id
          or student_sees_group_assignment(a.id, p_student_id)
        )
        and (
          a.mode = 'online'
          or exists (
            select 1 from assignment_absences ab
            where ab.assignment_id = a.id and ab.student_id = p_student_id
          )
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
    and not exists (
      select 1 from attempts t
      where t.assignment_id = p_assignment_id
        and t.student_id = p_student_id
        and t.status in ('in_progress', 'not_started')
    )
$function$;

-- ── Работа по PDF: бланк ответов (116, этап 2) ─────────────────────────────
-- Учитель прикрепляет PDF работы и задаёт число заданий с баллами (и, по
-- желанию, ключ ответов). Задания — «Задание N» без условия: условие в PDF.
-- Ученик на сайте смотрит PDF, вводит только ответы и может приложить до 3
-- фото решения на всю работу. Работает в обоих форматах: онлайн-назначение
-- пишут все, очное — учитель вносит баллы, отсутствовавшие пишут на сайте.

alter table tests
  add column if not exists answer_sheet boolean not null default false;
comment on column tests.answer_sheet is
  'Бланк ответов по PDF (116): условия в прикреплённых файлах (test_documents doc_type=variant), задания без текста';

-- Файлы работы для ученика — отдельный тип документа: 'tasks' и прочие —
-- исходники импорта, их конвейер парсинга удаляет после разбора
alter table test_documents drop constraint if exists test_documents_doc_type_check;
alter table test_documents add constraint test_documents_doc_type_check
  check (doc_type in ('tasks', 'answers', 'solutions', 'mixed', 'variant'));

-- Фото решения на всю работу (а не на задание): task_id = null
alter table attempt_answer_media alter column task_id drop not null;
create unique index if not exists attempt_answer_media_sheet_slot_idx
  on attempt_answer_media (attempt_id, sort_order) where task_id is null;
