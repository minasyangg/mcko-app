-- Диагностика ошибок группы программы по темам кодификатора — ядро агента
-- автосборки ДЗ (project_homework_agent, lib/homework-agent/diagnose.ts,
-- сигнал A «ошибки → темы» и сигнал C «прогресс по темам», та же выборка:
-- err_pct и 100-err_pct — две стороны одной агрегации).
--
-- Соединяет ошибки ученика с темой кодификатора ДВУМЯ путями одновременно:
--   1) через прямую ссылку задания на источник (test_tasks.library_problem_id
--      → library_problems.canonical_topic_id/topic_id) — для тестов,
--      собранных из библиотеки;
--   2) через exam_task_topic_map (079) по (exam_type, subject, task_number)
--      — для тестов, загруженных PDF-файлом напрямую через сайт, у которых
--      задания не имеют ссылки на источник. Проверка живой базы 2026-09-16
--      показала: 528 из 567 ошибок (93%) относятся именно к этому случаю —
--      без exam_task_topic_map агент был бы слеп на них.
-- library_problem_id, где он есть, приоритетнее exam_task_topic_map (он
-- точнее — конкретная задача, не усреднённый код номера).
--
-- security invoker (по умолчанию): вызывается агентом через admin-клиент
-- (service_role сам обходит RLS), обход прав здесь не нужен — в отличие от
-- check_roadmap_owned_by_auth и подобных, вызываемых из политик RLS.
create or replace function public.diagnose_roadmap_mistakes(
  p_roadmap_id uuid,
  p_lookback_days integer default 30
)
returns table (
  library_topic_id uuid,
  topic_name text,
  fipi_code text,
  fgos_grade text,
  wrong bigint,
  total bigint,
  err_pct numeric
)
language sql
stable
as $$
  with roadmap_students as (
    select gm.user_id
    from roadmaps rm
    join group_members gm on gm.group_id = rm.group_id
    where rm.id = p_roadmap_id
  ),
  answered as (
    select
      ata.is_correct,
      tt.task_number,
      tt.library_problem_id,
      t.exam_type,
      t.subject,
      coalesce(lp.canonical_topic_id, lp.topic_id) as direct_topic_id
    from attempt_task_answers ata
    join attempts at on at.id = ata.attempt_id
    join test_tasks tt on tt.id = ata.task_id
    join test_versions tv on tv.id = tt.test_version_id
    join tests t on t.id = tv.test_id
    left join library_problems lp on lp.id = tt.library_problem_id
    where at.student_id in (select user_id from roadmap_students)
      and at.status in ('submitted', 'checked')
      and at.submitted_at > now() - (p_lookback_days || ' days')::interval
      and ata.is_correct is not null
  ),
  resolved as (
    select
      is_correct,
      coalesce(direct_topic_id, m.library_topic_id) as topic_id
    from answered a
    left join exam_task_topic_map m
      on a.direct_topic_id is null
     and m.exam_type = a.exam_type
     and m.subject = a.subject
     and m.task_number = a.task_number
  )
  select
    lt.id as library_topic_id,
    lt.name as topic_name,
    lt.fipicod as fipi_code,
    -- fgos_grade у самой темы (для 1.x подразделов физики) отсутствует —
    -- берём из exam_task_topic_map по тому же коду, где он есть; тема без
    -- сопоставления в карте (например размеченная напрямую через
    -- library_problem_id, не через номер задания) остаётся null.
    (select ettm.fgos_grade from exam_task_topic_map ettm
     where ettm.library_topic_id = lt.id limit 1) as fgos_grade,
    count(*) filter (where not r.is_correct) as wrong,
    count(*) as total,
    round(100.0 * count(*) filter (where not r.is_correct) / count(*), 1) as err_pct
  from resolved r
  join library_topics lt on lt.id = r.topic_id
  where r.topic_id is not null
  group by lt.id, lt.name, lt.fipicod
  having count(*) >= 3 -- отсекаем случайный шум единичных попыток
  order by err_pct desc, wrong desc;
$$;

revoke all on function public.diagnose_roadmap_mistakes(uuid, integer) from public;
grant execute on function public.diagnose_roadmap_mistakes(uuid, integer) to authenticated, service_role;
