-- 107: у ученика по одному назначению — не больше одной незавершённой попытки.
--
-- Двойники появлялись, когда страница попытки открывалась дважды в одно
-- мгновение: оба запроса не видели открытой попытки и каждый создавал свою
-- (три случая в базе, разрыв 20–100 мс). Ученик решал и сдавал одну, вторая
-- оставалась пустой и «открытой». При следующем заходе страница подхватывала
-- её вместо создания новой, а ответы прошлой попытки переносятся только при
-- создании — ученик видел задание без зафиксированных ответов.
--
-- 106 временно разрешала две незавершённые, пока страница не умела переживать
-- отказ вставки. Теперь умеет (app/student/attempt/[id]/page.tsx подхватывает
-- попытку, созданную параллельным запросом), поэтому порог ужат до одной и
-- закреплён уникальным индексом: проверка в политике видит только
-- закоммиченные строки и от настоящей гонки сама по себе не спасает.
--
-- ПОРЯДОК ВЫКЛАДКИ: применять только после того, как правка страницы дошла до
-- продакшена. Со старой страницей гонка заканчивалась бы редиректом на список.

-- ── 1. Убрать пустых двойников ──────────────────────────────────────────
-- Только там, где незавершённых больше одной, и только попытки без единого
-- ответа и без фото решения — терять в них нечего, следующая попытка создастся
-- штатно, с переносом ответов. Если у пары останутся две НЕпустые
-- незавершённые, индекс ниже не создастся и миграция откатится целиком —
-- такой случай нужно разбирать руками, а не молча удалять.
delete from attempts a
where a.status in ('in_progress', 'not_started')
  and (
    select count(*) from attempts b
    where b.assignment_id = a.assignment_id
      and b.student_id = a.student_id
      and b.status in ('in_progress', 'not_started')
  ) > 1
  and not exists (select 1 from attempt_task_answers x where x.attempt_id = a.id)
  and not exists (select 1 from attempt_answer_media m where m.attempt_id = a.id)
  and not exists (select 1 from solution_requests r where r.attempt_id = a.id);

-- ── 2. Одна незавершённая попытка на ученика и назначение ───────────────
create unique index attempts_one_active_per_assignment
  on public.attempts (assignment_id, student_id)
  where status in ('in_progress', 'not_started');

-- ── 3. Проверка при создании: порог незавершённых — одна ────────────────
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
    and not exists (
      select 1 from attempts t
      where t.assignment_id = p_assignment_id
        and t.student_id = p_student_id
        and t.status in ('in_progress', 'not_started')
    )
$$;
