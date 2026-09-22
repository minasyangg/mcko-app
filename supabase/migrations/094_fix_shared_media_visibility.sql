-- ============================================================
-- 094_fix_shared_media_visibility.sql
-- Тот же класс упущения, что 089-091 закрыли для test_tasks/profiles/
-- assignments/test_versions/tests: AttemptDrawer, открытый получателем
-- гранта (readOnly, из "Расшарено мне"), также напрямую запрашивает
-- task_media (картинки условия задания) и attempt_answer_media (фото
-- письменного решения ученика) — ни у той, ни у другой таблицы не было
-- политики "teacher read via share", поэтому оба запроса под RLS получателя
-- молча возвращали 0 строк без ошибки, и обе картинки просто не
-- отображались в единственном экране, ради которого эта фича существует.
-- ============================================================

create policy "task_media: teacher read via share" on task_media
  for select using (
    auth_role() = 'teacher'
    and task_id is not null
    and check_task_shared_with_auth(task_id)
  );

create policy "attempt_answer_media: teacher read via share" on attempt_answer_media
  for select using (
    auth_role() = 'teacher'
    and check_attempt_shared_with_auth(attempt_id)
  );
