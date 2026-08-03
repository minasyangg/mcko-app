-- ============================================================
-- 038_assignment_completion.sql
-- Завершение назначения: автоматическое (полный балл) и принудительное (учитель)
-- ============================================================
--
-- До сих пор единственной причиной «тест завершён» был израсходованный лимит
-- попыток (attempt_count >= max_attempts в lib/grading/finalize.ts). Отсюда две
-- дыры:
--
-- 1. Ученик, набравший максимум с первой попытки, продолжал видеть «Пройти ещё
--    раз» и мог перерешивать тест, у которого уже нечего улучшать: итог
--    считается как MAX(awarded_score) по заданию среди всех попыток, поэтому
--    новые попытки физически не могут изменить балл — только шумят в
--    мониторинге и статистике.
-- 2. Учитель не мог закрыть назначение досрочно. Принудительное завершение
--    существовало только для ОДНОЙ попытки (api/admin/attempts/[id]/finish) и
--    только у админа: попытка сдавалась и проверялась, но ученик тут же начинал
--    следующую, потому что лимит не был исчерпан.
--
-- Решение — явное состояние «закрыто» на двух уровнях:
--   • student_final_results.closed_* — закрыто для КОНКРЕТНОГО ученика
--     (полный балл, исчерпанные попытки, точечное решение учителя);
--   • assignments.closed_at — закрыто для ВСЕХ адресатов назначения
--     (групповое назначение закрывается одним действием учителя).
-- Оба проверяются там, где ученик начинает попытку.

-- ── 1. Закрытие на уровне ученика ───────────────────────────────────────────
-- status ('completed'/'in_progress') остаётся производным полем для
-- совместимости с уже существующими чтениями; closed_reason объясняет ПОЧЕМУ
-- закрыто, и это единственный способ отличить решение учителя (не выводится
-- ни из баллов, ни из счётчика попыток) от расчётных причин.

alter table student_final_results
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references profiles(id) on delete set null,
  add column if not exists closed_reason text;

alter table student_final_results
  drop constraint if exists student_final_results_closed_reason_check;
alter table student_final_results
  add constraint student_final_results_closed_reason_check
  check (closed_reason is null or closed_reason in ('max_score', 'attempts_exhausted', 'forced'));

comment on column student_final_results.closed_reason is
  'Почему назначение закрыто для ученика: max_score — набран полный балл, attempts_exhausted — израсходованы попытки, forced — принудительно завершено учителем. NULL — не закрыто. Пересчитывается в updateCumulativeResult (lib/grading/finalize.ts); forced «липкий» — расчёт его не снимает.';
comment on column student_final_results.closed_by is
  'Кто закрыл принудительно (closed_reason = forced). NULL для автоматических причин.';

-- Бэкфилл: строки, уже помеченные completed, закрыты исчерпанием попыток —
-- других причин до этой миграции не существовало.
update student_final_results
set closed_reason = 'attempts_exhausted',
    closed_at = coalesce(last_completed_at, updated_at, now())
where status = 'completed' and closed_reason is null;

-- Бэкфилл нового правила: ученики, уже набравшие полный балл, но с остатком
-- попыток. Без этого правило начало бы действовать только с их СЛЕДУЮЩЕЙ сдачи
-- (итог пересчитывается по событию) — то есть ровно с той попытки, которую оно
-- и должно предотвратить.
update student_final_results
set closed_reason = 'max_score',
    closed_at = coalesce(last_completed_at, updated_at, now()),
    status = 'completed'
where closed_reason is null
  and max_score > 0
  and final_score >= max_score;

-- ── 2. Закрытие всего назначения ────────────────────────────────────────────
-- Нужно отдельно от per-student строк: у групповых назначений ученик может не
-- иметь ни одной попытки и ни одной строки итога, но начать тест после
-- «завершить для всех» он всё равно не должен.

alter table assignments
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references profiles(id) on delete set null;

comment on column assignments.closed_at is
  'Назначение принудительно завершено учителем/админом для всех адресатов: новые попытки не начинаются, активные были финализированы в момент закрытия. NULL — назначение открыто.';

-- ── 3. RLS ──────────────────────────────────────────────────────────────────
-- Новых политик не требуется: закрытие пишется service-role клиентом
-- (см. app/api/assignments/[id]/close), а чтение идёт по уже существующим
-- select-политикам ('assignments: student read own', 'sfr: student reads own',
-- teacher/admin-скоуп из 018). Запись итога из сессии ученика закрыта в 032.
