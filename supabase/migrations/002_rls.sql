-- ============================================================
-- 002_rls.sql — Row Level Security policies
-- ============================================================

alter table organizations enable row level security;
alter table profiles enable row level security;
alter table groups enable row level security;
alter table group_members enable row level security;
alter table tests enable row level security;
alter table test_versions enable row level security;
alter table test_documents enable row level security;
alter table test_tasks enable row level security;
alter table task_media enable row level security;
alter table task_answer_keys enable row level security;
alter table task_solutions enable row level security;
alter table solution_media enable row level security;
alter table assignments enable row level security;
alter table attempts enable row level security;
alter table attempt_task_answers enable row level security;
alter table solution_requests enable row level security;
alter table parsing_jobs enable row level security;
alter table parsing_warnings enable row level security;
alter table audit_logs enable row level security;
alter table presence_events enable row level security;

-- Helper: get current user role
create or replace function auth_role()
returns text as $$
  select role from profiles where id = auth.uid()
$$ language sql security definer stable;

-- Helper: get current user org
create or replace function auth_org()
returns uuid as $$
  select organization_id from profiles where id = auth.uid()
$$ language sql security definer stable;

-- ============================================================
-- organizations
-- ============================================================
create policy "org: members read own" on organizations
  for select using (id = auth_org());

create policy "org: admin update" on organizations
  for update using (id = auth_org() and auth_role() = 'admin');

-- ============================================================
-- profiles
-- ============================================================
create policy "profiles: read own" on profiles
  for select using (id = auth.uid());

create policy "profiles: teacher/admin read same org" on profiles
  for select using (
    auth_role() in ('teacher','admin')
    and organization_id = auth_org()
  );

create policy "profiles: update own" on profiles
  for update using (id = auth.uid());

create policy "profiles: admin manage org" on profiles
  for all using (auth_role() = 'admin' and organization_id = auth_org());

-- ============================================================
-- groups
-- ============================================================
create policy "groups: teacher/admin read own org" on groups
  for select using (
    auth_role() in ('teacher','admin')
    and organization_id = auth_org()
  );

create policy "groups: student read if member" on groups
  for select using (
    exists (
      select 1 from group_members
      where group_id = groups.id and user_id = auth.uid()
    )
  );

create policy "groups: teacher/admin manage" on groups
  for all using (
    auth_role() in ('teacher','admin')
    and organization_id = auth_org()
  );

-- ============================================================
-- group_members
-- ============================================================
create policy "group_members: teacher/admin read" on group_members
  for select using (auth_role() in ('teacher','admin'));

create policy "group_members: student read own" on group_members
  for select using (user_id = auth.uid());

create policy "group_members: teacher/admin manage" on group_members
  for all using (auth_role() in ('teacher','admin'));

-- ============================================================
-- tests
-- ============================================================
create policy "tests: teacher/admin read own org" on tests
  for select using (
    auth_role() in ('teacher','admin')
    and organization_id = auth_org()
  );

create policy "tests: student read published via assignment" on tests
  for select using (
    auth_role() = 'student'
    and exists (
      select 1 from assignments a
      join test_versions tv on tv.id = a.test_version_id
      where tv.test_id = tests.id
        and (a.student_id = auth.uid() or exists (
          select 1 from group_members gm
          where gm.group_id = a.group_id and gm.user_id = auth.uid()
        ))
    )
  );

create policy "tests: teacher/admin manage" on tests
  for all using (
    auth_role() in ('teacher','admin')
    and organization_id = auth_org()
  );

-- ============================================================
-- test_versions
-- ============================================================
create policy "test_versions: teacher/admin read" on test_versions
  for select using (
    auth_role() in ('teacher','admin')
    and exists (
      select 1 from tests t
      where t.id = test_versions.test_id and t.organization_id = auth_org()
    )
  );

create policy "test_versions: student read via assignment" on test_versions
  for select using (
    auth_role() = 'student'
    and exists (
      select 1 from assignments a
      where a.test_version_id = test_versions.id
        and (a.student_id = auth.uid() or exists (
          select 1 from group_members gm
          where gm.group_id = a.group_id and gm.user_id = auth.uid()
        ))
    )
  );

create policy "test_versions: teacher/admin manage" on test_versions
  for all using (
    auth_role() in ('teacher','admin')
    and exists (
      select 1 from tests t
      where t.id = test_versions.test_id and t.organization_id = auth_org()
    )
  );

-- ============================================================
-- test_documents (private, teacher only)
-- ============================================================
create policy "test_documents: teacher/admin only" on test_documents
  for all using (auth_role() in ('teacher','admin'));

-- ============================================================
-- test_tasks
-- ============================================================
create policy "test_tasks: teacher/admin read" on test_tasks
  for select using (auth_role() in ('teacher','admin'));

create policy "test_tasks: student read via assignment" on test_tasks
  for select using (
    auth_role() = 'student'
    and exists (
      select 1 from assignments a
      where a.test_version_id = test_tasks.test_version_id
        and (a.student_id = auth.uid() or exists (
          select 1 from group_members gm
          where gm.group_id = a.group_id and gm.user_id = auth.uid()
        ))
    )
  );

create policy "test_tasks: teacher/admin manage" on test_tasks
  for all using (auth_role() in ('teacher','admin'));

-- ============================================================
-- task_media (images — students see via signed URL check in app)
-- ============================================================
create policy "task_media: teacher/admin full" on task_media
  for all using (auth_role() in ('teacher','admin'));

create policy "task_media: student read via assignment" on task_media
  for select using (
    auth_role() = 'student'
    and exists (
      select 1 from test_tasks tt
      join assignments a on a.test_version_id = tt.test_version_id
      where tt.id = task_media.task_id
        and (a.student_id = auth.uid() or exists (
          select 1 from group_members gm
          where gm.group_id = a.group_id and gm.user_id = auth.uid()
        ))
    )
  );

-- ============================================================
-- task_answer_keys (hidden from students)
-- ============================================================
create policy "task_answer_keys: teacher/admin only" on task_answer_keys
  for all using (auth_role() in ('teacher','admin'));

-- ============================================================
-- task_solutions (hidden until grant)
-- ============================================================
create policy "task_solutions: teacher/admin full" on task_solutions
  for all using (auth_role() in ('teacher','admin'));

create policy "task_solutions: student read if approved" on task_solutions
  for select using (
    auth_role() = 'student'
    and exists (
      select 1 from solution_requests sr
      join attempts att on att.id = sr.attempt_id
      where sr.task_id = task_solutions.task_id
        and att.student_id = auth.uid()
        and sr.status = 'approved'
        and (sr.expires_at is null or sr.expires_at > now())
    )
  );

-- ============================================================
-- solution_media (same guard as task_solutions)
-- ============================================================
create policy "solution_media: teacher/admin full" on solution_media
  for all using (auth_role() in ('teacher','admin'));

create policy "solution_media: student read if approved" on solution_media
  for select using (
    auth_role() = 'student'
    and exists (
      select 1 from task_solutions ts
      join solution_requests sr on sr.task_id = ts.task_id
      join attempts att on att.id = sr.attempt_id
      where ts.id = solution_media.solution_id
        and att.student_id = auth.uid()
        and sr.status = 'approved'
        and (sr.expires_at is null or sr.expires_at > now())
    )
  );

-- ============================================================
-- assignments
-- ============================================================
create policy "assignments: teacher/admin manage" on assignments
  for all using (
    auth_role() in ('teacher','admin')
    and organization_id = auth_org()
  );

create policy "assignments: student read own" on assignments
  for select using (
    auth_role() = 'student'
    and (
      student_id = auth.uid()
      or exists (
        select 1 from group_members gm
        where gm.group_id = assignments.group_id and gm.user_id = auth.uid()
      )
    )
  );

-- ============================================================
-- attempts
-- ============================================================
create policy "attempts: student manage own" on attempts
  for all using (student_id = auth.uid());

create policy "attempts: teacher/admin read own org" on attempts
  for select using (
    auth_role() in ('teacher','admin')
    and exists (
      select 1 from assignments a
      where a.id = attempts.assignment_id and a.organization_id = auth_org()
    )
  );

-- ============================================================
-- attempt_task_answers
-- ============================================================
create policy "attempt_answers: student manage own" on attempt_task_answers
  for all using (
    exists (
      select 1 from attempts a
      where a.id = attempt_task_answers.attempt_id and a.student_id = auth.uid()
    )
  );

create policy "attempt_answers: teacher/admin read" on attempt_task_answers
  for select using (auth_role() in ('teacher','admin'));

-- ============================================================
-- solution_requests
-- ============================================================
create policy "solution_requests: student manage own" on solution_requests
  for all using (student_id = auth.uid());

create policy "solution_requests: teacher/admin manage" on solution_requests
  for all using (auth_role() in ('teacher','admin'));

-- ============================================================
-- parsing_jobs & parsing_warnings
-- ============================================================
create policy "parsing_jobs: teacher/admin" on parsing_jobs
  for all using (auth_role() in ('teacher','admin'));

create policy "parsing_warnings: teacher/admin" on parsing_warnings
  for all using (auth_role() in ('teacher','admin'));

-- ============================================================
-- audit_logs
-- ============================================================
create policy "audit_logs: admin read own org" on audit_logs
  for select using (
    auth_role() = 'admin' and organization_id = auth_org()
  );

create policy "audit_logs: system insert" on audit_logs
  for insert with check (true);

-- ============================================================
-- presence_events
-- ============================================================
create policy "presence_events: student insert own" on presence_events
  for insert with check (student_id = auth.uid());

create policy "presence_events: teacher/admin read" on presence_events
  for select using (auth_role() in ('teacher','admin'));
