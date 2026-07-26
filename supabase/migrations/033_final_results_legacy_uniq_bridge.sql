-- ============================================================
-- 033_final_results_legacy_uniq_bridge.sql
-- ВРЕМЕННЫЙ МОСТ СОВМЕСТИМОСТИ. Удалить после мержа dev → main.
-- ============================================================
--
-- Миграция 032 сняла unique (student_id, test_version_id) и заменила его на
-- unique (student_id, assignment_id). Но прод (ветка main) до мержа работает на
-- старом коде, который делает upsert с onConflict='student_id,test_version_id'.
-- Без этого ограничения PostgREST не может вывести arbiter и upsert падает —
-- причём старый код ошибку не проверяет, поэтому накопительные итоги просто
-- молча перестают записываться при каждой сдаче/проверке.
--
-- Возвращаем старое ограничение рядом с новым: оба выполняются одновременно,
-- пока (student_id, test_version_id) не задублирован. На момент применения
-- дубликатов 0.
--
-- ⚠️  КАК ТОЛЬКО main ПОЛУЧИТ КОД ИЗ 032 — ЭТО ОГРАНИЧЕНИЕ НУЖНО СНЯТЬ,
-- иначе оно запретит ровно тот сценарий, ради которого делалась 032 (один
-- тест, назначенный ученику дважды: обычным назначением и темой программы):
--
--   alter table student_final_results
--     drop constraint student_final_results_student_id_test_version_id_key;

alter table student_final_results
  drop constraint if exists student_final_results_student_id_test_version_id_key;
alter table student_final_results
  add constraint student_final_results_student_id_test_version_id_key
  unique (student_id, test_version_id);
