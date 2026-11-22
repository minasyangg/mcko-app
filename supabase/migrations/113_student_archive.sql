-- ============================================================
-- 113_student_archive.sql
-- Архив заданий в кабинете ученика
-- ============================================================
--
-- Старые назначения (например, ОГЭ прошлого года) остаются у ученика в «Мои
-- задания» навсегда и заслоняют актуальную программу. Ученик может убрать в
-- архив назначение, открытое больше полугода назад (порог — в коде,
-- lib/assignments/archive.ts). Архив — это не только скрытие из списка:
-- назначение закрывается, а итог пишется в student_final_results, как при
-- завершении учителем. Не дал ни одного ответа — строка «0 баллов, 0 попыток».
--
-- Метка живёт в строке итога, а не в отдельной таблице: архивирование всегда
-- создаёт эту строку (updateCumulativeResult делает upsert), и пересчёт итога
-- сохраняет archived_at, как сохраняет «липкое» решение учителя.

alter table student_final_results
  add column if not exists archived_at timestamptz;

comment on column student_final_results.archived_at is
  'Ученик убрал назначение в архив (кабинет ученика, вкладка «Архив»). Пока не NULL, назначение закрыто для ученика: closed_reason = archived, если не закрыто по другой причине. Снимается возвратом из архива учеником или «Открыть» у учителя.';

alter table student_final_results
  drop constraint if exists student_final_results_closed_reason_check;
alter table student_final_results
  add constraint student_final_results_closed_reason_check
  check (closed_reason is null or closed_reason in ('max_score', 'attempts_exhausted', 'forced', 'archived'));

comment on column student_final_results.closed_reason is
  'Почему назначение закрыто для ученика: max_score — набран полный балл, attempts_exhausted — израсходованы попытки, forced — принудительно завершено учителем, archived — ученик убрал в архив (и других причин нет). NULL — не закрыто. Пересчитывается в updateCumulativeResult (lib/grading/finalize.ts); forced и archived_at «липкие» — расчёт их не снимает.';

-- RLS: новых политик не нужно. Архив пишется service-role клиентом
-- (app/api/student/archive), чтение — по 'sfr: student reads own'. Начать
-- попытку в архивном назначении не даёт уже существующая проверка
-- sfr.closed_reason is not null (039 → 110).
