-- 015B: drop_orphaned_tracker_tables
--
-- Файл восстановлен 2026-11-12 из истории миграций базы
-- (supabase_migrations.schema_migrations, версия 20260704110257): миграция была
-- применена, но в репозиторий не попала. Текст ниже — дословно из истории.

-- tracker_assignments/tracker_progress belong to an unrelated project
-- (github.com/minasyangg/tracker, separate Vercel project "app", now on its
-- own dedicated Supabase project). Confirmed 0 rows in both tables — never
-- used against this database. Dropping as orphaned leftovers.
drop table if exists public.tracker_progress;
drop table if exists public.tracker_assignments;
