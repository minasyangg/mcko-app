-- 086A: revoke_public_sync_function_grants
--
-- Файл восстановлен 2026-11-12 из истории миграций базы
-- (supabase_migrations.schema_migrations, версия 20260920115710): миграция была
-- применена, но в репозиторий не попала. Текст ниже — дословно из истории.

revoke execute on function public.sync_group_to_roadmaps(uuid) from public;
revoke execute on function public.sync_student_to_roadmaps_from_group(uuid, uuid) from public;
