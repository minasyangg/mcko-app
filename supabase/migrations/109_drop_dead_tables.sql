-- 109: убрать две таблицы, которые ничем не используются (аудит 2026-11-11).
--
-- doska_student_boards — первая версия привязки «учитель — ученик — доска»
-- (037). С 041 источник правды — doska_boards и doska_board_participants,
-- строки перенесены туда, таблица была оставлена «как след миграции». Ни
-- mcko-app, ни doska к ней не обращаются (в коде осталась только в
-- сгенерированном types/database.ts), функции и политики других таблиц на неё
-- не ссылаются.
--
-- _rls_policy_backup_095 — снимок выражений политик до 095, сделанный для
-- отката. С тех пор политики менялись (096–108), так что восстановление из
-- снимка вернуло бы устаревшее состояние; оригиналы политик есть в миграциях.
--
-- Содержимое и устройство обеих таблиц перед удалением выгружено в
-- _local/dropped-tables-109.json (вне git), откат — _local/109_rollback.sql.

-- Страховка: удаляем doska_student_boards, только если каждая её доска
-- действительно есть в doska_boards. Иначе миграция откатывается целиком.
do $$
declare
  v_missing int;
begin
  select count(*) into v_missing
  from public.doska_student_boards s
  where not exists (select 1 from public.doska_boards b where b.id = s.board_id);
  if v_missing > 0 then
    raise exception 'doska_student_boards: % досок нет в doska_boards — перенос неполный, таблицу не удаляю', v_missing;
  end if;
end $$;

drop table public.doska_student_boards;
drop table public._rls_policy_backup_095;
