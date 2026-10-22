-- Мёртвые объекты, найденные при разборе графа зависимостей (2026-10-22).
--
-- presence_events: пульс плеера теста раз в 30 с писал сюда событие, но таблицу
-- никто не читал (монитор берёт current_task_number/last_activity_at из
-- attempts), триггеров и зависимых функций/представлений нет. Пульс теперь
-- обновляет саму попытку. На момент удаления — 12,6 тыс. строк, только
-- event_type='heartbeat'.
--
-- diagnose_roadmap_mistakes: вызывалась только из lib/homework-agent/diagnose.ts
-- (диагностика для удалённой автосборки ДЗ по cron), модуль удалён.

drop table if exists public.presence_events;

drop function if exists public.diagnose_roadmap_mistakes(uuid, integer);
