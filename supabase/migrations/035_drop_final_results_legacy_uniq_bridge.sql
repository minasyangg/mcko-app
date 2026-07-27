-- ============================================================
-- 035_drop_final_results_legacy_uniq_bridge.sql
-- Снятие временного моста из 033
-- ============================================================
--
-- 033 возвращал старое ограничение unique (student_id, test_version_id) на
-- время, пока прод (main) работал на коде, который делал upsert с
-- onConflict='student_id,test_version_id'. Прод обновлён (коммит 8094660),
-- обе ветки используют ключ (student_id, assignment_id).
--
-- Держать мост дальше нельзя: он запрещает ровно тот сценарий, ради которого
-- делалась 032 — один тест, назначенный ученику дважды (обычным назначением и
-- темой учебной программы). Второе назначение не смогло бы создать свою строку
-- итога.
--
-- Уникальность legacy-строк (assignment_id is null, удалённые ученики) держит
-- частичный индекс student_final_results_student_version_legacy_key из 032 —
-- он остаётся.

alter table student_final_results
  drop constraint if exists student_final_results_student_id_test_version_id_key;
