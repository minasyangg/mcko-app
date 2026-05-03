-- ============================================================
-- Fix: infinite recursion in RLS policies
-- Cause: tests ↔ test_versions cross-reference
-- Fix: SECURITY DEFINER functions bypass RLS on inner queries
-- ============================================================

-- Helper: check test belongs to auth user's org (bypasses RLS on tests)
create or replace function check_test_in_auth_org(p_test_id uuid)
returns boolean as $$
  select exists (
    select 1 from tests
    where id = p_test_id
    and organization_id = auth_org()
  )
$$ language sql security definer stable;

-- Helper: check student has assignment for this test (bypasses RLS on test_versions)
create or replace function student_has_test_assignment(p_test_id uuid)
returns boolean as $$
  select exists (
    select 1 from assignments a
    join test_versions tv on tv.id = a.test_version_id
    where tv.test_id = p_test_id
      and (
        a.student_id = auth.uid()
        or exists (
          select 1 from group_members gm
          where gm.group_id = a.group_id and gm.user_id = auth.uid()
        )
      )
  )
$$ language sql security definer stable;

-- Helper: check student has assignment for this test_version
create or replace function student_has_version_assignment(p_version_id uuid)
returns boolean as $$
  select exists (
    select 1 from assignments a
    where a.test_version_id = p_version_id
      and (
        a.student_id = auth.uid()
        or exists (
          select 1 from group_members gm
          where gm.group_id = a.group_id and gm.user_id = auth.uid()
        )
      )
  )
$$ language sql security definer stable;

-- ============================================================
-- Rebuild tests policies
-- ============================================================

drop policy if exists "tests: student read published via assignment" on tests;
drop policy if exists "tests: teacher/admin read own org" on tests;
drop policy if exists "tests: teacher/admin manage" on tests;

create policy "tests: teacher/admin read own org" on tests
  for select using (
    auth_role() in ('teacher','admin')
    and organization_id = auth_org()
  );

create policy "tests: student read published via assignment" on tests
  for select using (
    auth_role() = 'student'
    and student_has_test_assignment(tests.id)
  );

create policy "tests: teacher/admin manage" on tests
  for all using (
    auth_role() in ('teacher','admin')
    and organization_id = auth_org()
  );

-- ============================================================
-- Rebuild test_versions policies
-- ============================================================

drop policy if exists "test_versions: teacher/admin read" on test_versions;
drop policy if exists "test_versions: student read via assignment" on test_versions;
drop policy if exists "test_versions: teacher/admin manage" on test_versions;

create policy "test_versions: teacher/admin read" on test_versions
  for select using (
    auth_role() in ('teacher','admin')
    and check_test_in_auth_org(test_versions.test_id)
  );

create policy "test_versions: student read via assignment" on test_versions
  for select using (
    auth_role() = 'student'
    and student_has_version_assignment(test_versions.id)
  );

create policy "test_versions: teacher/admin manage" on test_versions
  for all using (
    auth_role() in ('teacher','admin')
    and check_test_in_auth_org(test_versions.test_id)
  );

-- ============================================================
-- Rebuild test_tasks policies
-- ============================================================

drop policy if exists "test_tasks: teacher/admin read" on test_tasks;
drop policy if exists "test_tasks: student read via assignment" on test_tasks;
drop policy if exists "test_tasks: teacher/admin manage" on test_tasks;

create or replace function student_has_task_assignment(p_version_id uuid)
returns boolean as $$
  select student_has_version_assignment(p_version_id)
$$ language sql security definer stable;

create policy "test_tasks: teacher/admin read" on test_tasks
  for select using (auth_role() in ('teacher','admin'));

create policy "test_tasks: student read via assignment" on test_tasks
  for select using (
    auth_role() = 'student'
    and student_has_task_assignment(test_tasks.test_version_id)
  );

create policy "test_tasks: teacher/admin manage" on test_tasks
  for all using (auth_role() in ('teacher','admin'));
