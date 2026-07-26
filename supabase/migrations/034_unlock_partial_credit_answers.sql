-- ============================================================
-- 034_unlock_partial_credit_answers.sql
-- Ремонт данных: снять блокировку с частично верных ответов
-- ============================================================
--
-- components/teacher/AttemptDrawer.tsx слал is_correct = (балл > 0), а не
-- (балл == максимум). Роут проверки (app/api/attempts/[id]/grade) вешал по
-- этому флагу вечную блокировку — частично верные ответы (3 из 4, 2 из 4)
-- запирались, и ученик не мог дотянуть их до максимума в следующей попытке,
-- ради чего попытки и даются.
--
-- Затронуло 36 ответов у 10 учеников в 20 попытках.
--
-- Снимаем блокировку и приводим is_correct к его настоящему смыслу («набран
-- полный балл» — именно так его выставляет авто-проверка, см.
-- lib/grading/checker.ts). Баллы НЕ трогаем: awarded_score сохраняется, а
-- накопительный итог берёт MAX по каждому заданию среди всех попыток
-- (updateCumulativeResult), поэтому потерять уже заработанное ученик не может —
-- только улучшить.
--
-- Код, который порождал битые данные, исправлен в том же коммите:
--   - AttemptDrawer: is_correct = score >= max_score
--   - grade/route.ts: блокировка считается на сервере от awarded_score,
--     а не по флагу из браузера
--   - finalize.ts: то же условие в авто-проверке

-- Снимок для отката. Дропнуть, когда убедимся, что всё в порядке:
--   drop table _backup_034_wrongly_locked;
-- Откат:
--   update attempt_task_answers a
--   set is_correct = b.is_correct, is_locked = b.is_locked,
--       locked_in_attempt_id = b.locked_in_attempt_id
--   from _backup_034_wrongly_locked b where b.id = a.id;
create table if not exists _backup_034_wrongly_locked as
select ata.id, ata.is_correct, ata.is_locked, ata.locked_in_attempt_id, now() as backed_up_at
from attempt_task_answers ata
join test_tasks tt on tt.id = ata.task_id
where ata.is_locked = true
  and ata.awarded_score < coalesce(tt.max_score, 1);

update attempt_task_answers ata
set is_locked = false,
    locked_in_attempt_id = null,
    is_correct = false
from test_tasks tt
where tt.id = ata.task_id
  and ata.is_locked = true
  and ata.awarded_score < coalesce(tt.max_score, 1);
