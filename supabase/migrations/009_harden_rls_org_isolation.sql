-- 009_harden_rls_org_isolation.sql
-- Add organization isolation to task_media, test_tasks, task_answer_keys RLS policies.
-- Previously these allowed any teacher/admin to access data from other organizations.

drop policy if exists "task_media: teacher/admin full" on task_media;
create policy "task_media: teacher/admin full" on task_media
  for all using (
    auth_role() in ('teacher','admin')
    and (
      task_id is null
      or exists (
        select 1 from test_tasks tt
        join test_versions tv on tv.id = tt.test_version_id
        join tests t on t.id = tv.test_id
        where tt.id = task_media.task_id
          and t.organization_id = auth_org()
      )
    )
  );

drop policy if exists "test_tasks: teacher/admin manage" on test_tasks;
create policy "test_tasks: teacher/admin manage" on test_tasks
  for all using (
    auth_role() in ('teacher','admin')
    and exists (
      select 1 from test_versions tv
      join tests t on t.id = tv.test_id
      where tv.id = test_tasks.test_version_id
        and t.organization_id = auth_org()
    )
  );

drop policy if exists "task_answer_keys: teacher/admin only" on task_answer_keys;
create policy "task_answer_keys: teacher/admin only" on task_answer_keys
  for all using (
    auth_role() in ('teacher','admin')
    and exists (
      select 1 from test_tasks tt
      join test_versions tv on tv.id = tt.test_version_id
      join tests t on t.id = tv.test_id
      where tt.id = task_answer_keys.task_id
        and t.organization_id = auth_org()
    )
  );
