-- Автозапуск ежегодного перевода классов.
-- pg_cron живёт в самой БД: не зависит ни от деплоя приложения, ни от того,
-- зашёл ли кто-то в систему 1 сентября. Функция идемпотентна по учебному году
-- (grade_promotions.school_year UNIQUE), поэтому ежедневный прогон в сентябре
-- безопасен: сработает только первый, остальные вернут skipped_already_done.
-- Ежедневно, а не раз в год, — чтобы перевод состоялся даже если ровно
-- 1 сентября база была недоступна.
create extension if not exists pg_cron with schema pg_catalog;

select cron.unschedule('promote-student-grades')
where exists (select 1 from cron.job where jobname = 'promote-student-grades');

select cron.schedule(
  'promote-student-grades',
  '0 3 1-30 9 *',            -- каждый день сентября в 03:00 UTC
  $$select promote_student_grades()$$
);
