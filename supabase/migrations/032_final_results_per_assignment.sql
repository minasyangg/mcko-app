-- ============================================================
-- 032_final_results_per_assignment.sql
-- student_final_results: ключ (student_id, test_version_id) → (student_id, assignment_id)
-- ============================================================
--
-- Проблема. Весь конвейер оценивания работает на уровне НАЗНАЧЕНИЯ
-- (assignments): попытки принадлежат assignment, max_attempts задаётся на
-- assignment, накопительный итог считается по попыткам одного assignment
-- (lib/grading/finalize.ts → updateCumulativeResult). Но запись итога
-- уникальна по (student_id, test_version_id).
--
-- Один и тот же test_version легко назначается ученику дважды: обычное
-- назначение (POST /api/assignments) и привязка того же теста к теме учебной
-- программы (POST /api/roadmaps/[id]/topics/[topicId]/items) оба берут
-- tests.current_published_version_id. Тогда два назначения делят одну строку
-- итога и затирают друг друга: показанный балл и attempt_count принадлежат
-- тому назначению, которое финализировали последним. Побочно ломается
-- «осталось попыток» на странице результата (attempt_count чужого назначения
-- против max_attempts этого) — ученика может преждевременно заблокировать.
--
-- Решение: привязать итог к assignment. test_version_id остаётся —
-- он нужен для аналитики и для legacy-строк удалённых учеников, у которых
-- назначения уже удалены (см. delete_student_cascade в 005).

alter table student_final_results
  add column if not exists assignment_id uuid
    references assignments(id) on delete cascade;

comment on column student_final_results.assignment_id is
  'Назначение, к которому относится итог. Попытки и max_attempts живут на assignment, поэтому итог тоже уникален по (student_id, assignment_id). NULL — legacy-строки удалённых учеников, чьи назначения уже удалены.';

-- Бэкфилл: если у пары (ученик, версия теста) ровно одно назначение —
-- сопоставление однозначно. Ученик достижим либо напрямую (student_id),
-- либо через группу (group_members). Пары с несколькими назначениями
-- оставляем с NULL: данные в них уже перемешаны, восстановить принадлежность
-- нельзя — они пересчитаются при следующей сдаче/проверке.
with reachable as (
  select
    a.id            as assignment_id,
    a.test_version_id,
    coalesce(a.student_id, gm.user_id) as student_id
  from assignments a
  left join group_members gm on gm.group_id = a.group_id
  where coalesce(a.student_id, gm.user_id) is not null
),
unambiguous as (
  -- агрегата min() для uuid в Postgres нет; distinct-значение здесь ровно
  -- одно (гарантирует HAVING), поэтому берём первый элемент массива
  select student_id, test_version_id, (array_agg(distinct assignment_id))[1] as assignment_id
  from reachable
  group by student_id, test_version_id
  having count(distinct assignment_id) = 1
)
update student_final_results sfr
set assignment_id = u.assignment_id
from unambiguous u
where sfr.student_id = u.student_id
  and sfr.test_version_id = u.test_version_id
  and sfr.assignment_id is null;

-- Смена уникальности. Старое ограничение снимаем полностью, иначе второе
-- назначение того же теста не сможет создать свою строку.
alter table student_final_results
  drop constraint if exists student_final_results_student_id_test_version_id_key;

-- Рабочая уникальность — по назначению (onConflict в updateCumulativeResult).
-- ВАЖНО: обычный constraint, а НЕ частичный индекс с `where assignment_id is
-- not null`. PostgREST шлёт `on_conflict=student_id,assignment_id` без
-- предиката, а вывод arbiter'а для частичного индекса требует повторить его
-- предикат в самом ON CONFLICT — иначе upsert падает с «no unique or exclusion
-- constraint matching the ON CONFLICT specification».
-- NULL-и в уникальном ограничении Postgres считает различными, поэтому
-- legacy-строки (assignment_id is null) ему не мешают — их уникальность
-- держит отдельный частичный индекс ниже.
alter table student_final_results
  drop constraint if exists student_final_results_student_id_assignment_id_key;
alter table student_final_results
  add constraint student_final_results_student_id_assignment_id_key
  unique (student_id, assignment_id);

-- Legacy-строки без назначения: сохраняем прежнюю уникальность, чтобы
-- delete_student_cascade не плодил дубли по одной версии теста.
create unique index if not exists student_final_results_student_version_legacy_key
  on student_final_results (student_id, test_version_id)
  where assignment_id is null;

-- ── RLS: убрать запись итога из-под сессии ученика ──────────────────────────
-- Политики из 017 разрешали ученику insert/update СВОЕЙ строки итога, то есть
-- прямой записью в обход API можно было выставить себе любой final_score.
-- Легитимных записей из пользовательской сессии нет: и авто-финализация
-- (lib/grading/finalize.ts), и проверка учителем (api/attempts/[id]/grade), и
-- удаление попытки (api/admin/attempts/[id]) идут через service-role клиент,
-- которому RLS не применяется. Тот же класс дыры, что закрывали в 029 для
-- attempts и attempt_task_answers.
drop policy if exists "sfr: student upserts own" on public.student_final_results;
drop policy if exists "sfr: student updates own" on public.student_final_results;
