-- Очная работа «только баллы» (2026-11-26).
--
-- В режиме «Очно» учитель вписывает название работы, число заданий и баллы
-- прямо в окне привязки к теме программы, а система сама регистрирует
-- обычный тест/ДЗ (он виден в «Тестах»). Условий у такого теста нет — только
-- «Задание N» с максимальным баллом, это скелет для баллов в
-- attempt_task_answers, по которым строится статистика.
--
-- Писать такую работу на сайте нечего, поэтому отсутствовавшим ставится
-- только «н»: в отличие от очной работы по тесту из системы, онлайн её не
-- начать даже отмеченному отсутствующим.

alter table tests
  add column if not exists scores_only boolean not null default false;
comment on column tests.scores_only is
  'Очная работа «только баллы» (117): задания без условий, онлайн не пишется';

-- Старт попытки: отмеченный «н» начинает очную работу онлайн, только если
-- у неё есть содержимое (тест не scores_only). Остальное — как в 116.
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
          or (
            exists (
              select 1 from assignment_absences ab
              where ab.assignment_id = a.id and ab.student_id = p_student_id
            )
            and not exists (
              select 1 from test_versions tv
              join tests t on t.id = tv.test_id
              where tv.id = a.test_version_id and t.scores_only
            )
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
