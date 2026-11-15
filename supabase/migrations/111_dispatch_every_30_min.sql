-- 111: рассылка уведомлений об открывшихся назначениях — каждые 30 минут
-- с 7:00 до 23:30 по Москве (решение пользователя 2026-11-15; в 110 было
-- раз в 3 часа). pg_cron считает время в UTC (Москва = UTC+3): 04:00–20:30.
--
-- Сайт по-прежнему вызывается только когда есть открывшиеся, но ещё не
-- уведомлённые назначения: без них задание отрабатывает внутри базы и наружу
-- ничего не шлёт. Открывшееся после 23:30 уведомляется в 7:00.
--
-- cron.schedule с тем же именем заменяет расписание и команду задания.
-- Откат — то же задание с расписанием '0 4,7,10,13,16,19,22 * * *'.
select cron.schedule(
  'dispatch-assignment-notifications',
  '*/30 4-20 * * *',
  $job$
  select net.http_post(
    url := 'https://mcko-app.vercel.app/api/notifications/dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dispatch-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notification_dispatch_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  )
  where exists (
    select 1 from public.assignments
    where notified_at is null and closed_at is null
      and (starts_at is null or starts_at <= now())
  );
  $job$
);
