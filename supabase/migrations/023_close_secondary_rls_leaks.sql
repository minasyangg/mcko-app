-- Аудит: у 6 таблиц политики были `auth_role() in ('teacher','admin')` —
-- без границы организации и без владения: любой учитель видел/правил решения,
-- документы и парсинг-джобы ЧУЖИХ тестов и события присутствия чужих учеников.
-- Перетаргет на паттерн 018: teacher — только своё (через цепочку владения
-- тестом/назначением), admin — своя организация. Студенческие политики
-- (read if approved, insert own) не меняются. Запись в эти таблицы идёт
-- сервис-роулом из API-роутов — на него RLS не действует.

-- ── Хелперы ──
-- solution_media → task_solutions → test_tasks → ... → tests.created_by
create or replace function check_solution_owned_by_auth(p_solution_id uuid)
returns boolean as $$
  select exists (
    select 1 from task_solutions ts
    where ts.id = p_solution_id and check_task_owned_by_auth(ts.task_id)
  )
$$ language sql security definer stable set search_path = public;

create or replace function check_solution_in_auth_org(p_solution_id uuid)
returns boolean as $$
  select exists (
    select 1 from task_solutions ts
    where ts.id = p_solution_id and check_task_in_auth_org(ts.task_id)
  )
$$ language sql security definer stable set search_path = public;

-- parsing_warnings → parsing_jobs → test_versions → tests.created_by
create or replace function check_parsing_job_owned_by_auth(p_job_id uuid)
returns boolean as $$
  select exists (
    select 1 from parsing_jobs pj
    where pj.id = p_job_id and check_version_owned_by_auth(pj.test_version_id)
  )
$$ language sql security definer stable set search_path = public;

create or replace function check_parsing_job_in_auth_org(p_job_id uuid)
returns boolean as $$
  select exists (
    select 1 from parsing_jobs pj
    where pj.id = p_job_id and check_version_in_auth_org(pj.test_version_id)
  )
$$ language sql security definer stable set search_path = public;

-- ── task_solutions ──
drop policy if exists "task_solutions: teacher/admin full" on task_solutions;
create policy "task_solutions: teacher manage own" on task_solutions
  for all
  using (auth_role() = 'teacher' and check_task_owned_by_auth(task_id))
  with check (auth_role() = 'teacher' and check_task_owned_by_auth(task_id));
create policy "task_solutions: admin manage org" on task_solutions
  for all
  using (auth_role() = 'admin' and check_task_in_auth_org(task_id))
  with check (auth_role() = 'admin' and check_task_in_auth_org(task_id));

-- ── solution_media ──
drop policy if exists "solution_media: teacher/admin full" on solution_media;
create policy "solution_media: teacher manage own" on solution_media
  for all
  using (auth_role() = 'teacher' and check_solution_owned_by_auth(solution_id))
  with check (auth_role() = 'teacher' and check_solution_owned_by_auth(solution_id));
create policy "solution_media: admin manage org" on solution_media
  for all
  using (auth_role() = 'admin' and check_solution_in_auth_org(solution_id))
  with check (auth_role() = 'admin' and check_solution_in_auth_org(solution_id));

-- ── test_documents ──
drop policy if exists "test_documents: teacher/admin only" on test_documents;
create policy "test_documents: teacher manage own" on test_documents
  for all
  using (auth_role() = 'teacher' and check_version_owned_by_auth(test_version_id))
  with check (auth_role() = 'teacher' and check_version_owned_by_auth(test_version_id));
create policy "test_documents: admin manage org" on test_documents
  for all
  using (auth_role() = 'admin' and check_version_in_auth_org(test_version_id))
  with check (auth_role() = 'admin' and check_version_in_auth_org(test_version_id));

-- ── presence_events (student insert own — без изменений) ──
drop policy if exists "presence_events: teacher/admin read" on presence_events;
create policy "presence_events: teacher read own assignments" on presence_events
  for select
  using (auth_role() = 'teacher' and check_attempt_assignment_owned_by_auth(attempt_id));
create policy "presence_events: admin read org" on presence_events
  for select
  using (auth_role() = 'admin' and check_attempt_in_auth_org(attempt_id));

-- ── parsing_jobs ──
drop policy if exists "parsing_jobs: teacher/admin" on parsing_jobs;
create policy "parsing_jobs: teacher manage own" on parsing_jobs
  for all
  using (auth_role() = 'teacher' and check_version_owned_by_auth(test_version_id))
  with check (auth_role() = 'teacher' and check_version_owned_by_auth(test_version_id));
create policy "parsing_jobs: admin manage org" on parsing_jobs
  for all
  using (auth_role() = 'admin' and check_version_in_auth_org(test_version_id))
  with check (auth_role() = 'admin' and check_version_in_auth_org(test_version_id));

-- ── parsing_warnings ──
drop policy if exists "parsing_warnings: teacher/admin" on parsing_warnings;
create policy "parsing_warnings: teacher manage own" on parsing_warnings
  for all
  using (auth_role() = 'teacher' and check_parsing_job_owned_by_auth(parsing_job_id))
  with check (auth_role() = 'teacher' and check_parsing_job_owned_by_auth(parsing_job_id));
create policy "parsing_warnings: admin manage org" on parsing_warnings
  for all
  using (auth_role() = 'admin' and check_parsing_job_in_auth_org(parsing_job_id))
  with check (auth_role() = 'admin' and check_parsing_job_in_auth_org(parsing_job_id));
