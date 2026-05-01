-- ============================================================
-- 001_initial_schema.sql
-- Full database schema for ExamPlatform
-- ============================================================

-- ============================================================
-- SECTION 1: Users & Organization
-- ============================================================

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  settings jsonb default '{}',
  created_at timestamptz default now()
);

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid references organizations(id),
  full_name text not null,
  role text not null check (role in ('student','teacher','admin')),
  grade text,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) not null,
  name text not null,
  description text,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

create table if not exists group_members (
  group_id uuid references groups(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  added_at timestamptz default now(),
  primary key (group_id, user_id)
);

-- ============================================================
-- SECTION 2: Tests & Versions
-- ============================================================

create table if not exists tests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) not null,
  title text not null,
  subject text,
  grade text,
  exam_type text,
  description text,
  status text not null default 'draft'
    check (status in ('draft','in_review','published','archived')),
  current_published_version_id uuid,
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists test_versions (
  id uuid primary key default gen_random_uuid(),
  test_id uuid references tests(id) on delete cascade,
  version_number integer not null,
  status text not null default 'draft'
    check (status in ('draft','in_review','published','archived')),
  time_limit_sec integer,
  max_attempts integer default 1,
  shuffle_tasks boolean default false,
  result_visibility text default 'after_submit'
    check (result_visibility in ('instant','after_submit','after_teacher_review','never')),
  scoring_policy jsonb default '{}',
  published_at timestamptz,
  published_by uuid references profiles(id),
  created_at timestamptz default now()
);

-- Forward reference: tests.current_published_version_id → test_versions
alter table tests
  add constraint fk_tests_current_version
  foreign key (current_published_version_id)
  references test_versions(id);

create table if not exists test_documents (
  id uuid primary key default gen_random_uuid(),
  test_version_id uuid references test_versions(id) on delete cascade,
  doc_type text not null
    check (doc_type in ('tasks','answers','solutions','mixed')),
  original_filename text,
  storage_path text not null,
  page_count integer,
  extracted_text jsonb,
  extracted_images_count integer default 0,
  parse_status text default 'pending'
    check (parse_status in ('pending','processing','done','failed')),
  created_at timestamptz default now()
);

-- ============================================================
-- SECTION 3: Tasks
-- ============================================================

create table if not exists test_tasks (
  id uuid primary key default gen_random_uuid(),
  test_version_id uuid references test_versions(id) on delete cascade,
  task_number integer not null,
  title text,
  prompt_text text not null,
  prompt_html text,
  task_type text not null default 'short_text'
    check (task_type in (
      'single_choice','multiple_choice','short_text',
      'numeric','composite','manual_review'
    )),
  answer_format_hint text,
  answer_parts jsonb default '[]',
  options jsonb default '[]',
  has_images boolean default false,
  max_score numeric default 1,
  source_doc_id uuid references test_documents(id),
  source_pages integer[],
  parse_confidence numeric,
  review_status text default 'pending'
    check (review_status in ('pending','approved','needs_fix','rejected')),
  review_note text,
  sort_order integer not null,
  created_at timestamptz default now(),
  unique (test_version_id, task_number)
);

create table if not exists task_media (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references test_tasks(id) on delete cascade,
  media_type text not null default 'image'
    check (media_type in ('image')),
  storage_path text not null,
  original_filename text,
  width_px integer,
  height_px integer,
  file_size_bytes integer,
  format text default 'webp',
  placement text default 'above_text'
    check (placement in ('above_text','below_text','inline')),
  sort_order integer default 0,
  alt_text text,
  source_page integer,
  source_bbox jsonb,
  is_manually_uploaded boolean default false,
  created_at timestamptz default now()
);

create table if not exists task_answer_keys (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references test_tasks(id) on delete cascade unique,
  correct_answer jsonb not null,
  grading_method text not null default 'exact'
    check (grading_method in (
      'exact','normalized','numeric_tolerance',
      'set_match','contains','regex','manual'
    )),
  grading_config jsonb default '{}',
  partial_score_rules jsonb,
  parse_confidence numeric,
  created_at timestamptz default now()
);

create table if not exists task_solutions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references test_tasks(id) on delete cascade unique,
  solution_text text,
  solution_html text,
  has_images boolean default false,
  access_policy text default 'by_request'
    check (access_policy in ('by_request','after_finish','always_hidden')),
  created_at timestamptz default now()
);

create table if not exists solution_media (
  id uuid primary key default gen_random_uuid(),
  solution_id uuid references task_solutions(id) on delete cascade,
  media_type text not null default 'image'
    check (media_type in ('image')),
  storage_path text not null,
  original_filename text,
  width_px integer,
  height_px integer,
  file_size_bytes integer,
  format text default 'webp',
  sort_order integer default 0,
  alt_text text,
  source_page integer,
  created_at timestamptz default now()
);

-- ============================================================
-- SECTION 4: Assignments
-- ============================================================

create table if not exists assignments (
  id uuid primary key default gen_random_uuid(),
  test_version_id uuid references test_versions(id) not null,
  organization_id uuid references organizations(id) not null,
  group_id uuid references groups(id),
  student_id uuid references profiles(id),
  starts_at timestamptz,
  ends_at timestamptz,
  max_attempts integer default 1,
  time_limit_override_sec integer,
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  check (group_id is not null or student_id is not null)
);

-- ============================================================
-- SECTION 5: Attempts & Answers
-- ============================================================

create table if not exists attempts (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid references assignments(id) not null,
  student_id uuid references profiles(id) not null,
  status text not null default 'not_started'
    check (status in (
      'not_started','in_progress','submitted',
      'under_review','checked','expired'
    )),
  started_at timestamptz,
  submitted_at timestamptz,
  checked_at timestamptz,
  last_activity_at timestamptz,
  current_task_number integer default 1,
  score numeric,
  max_score numeric,
  teacher_comment text,
  created_at timestamptz default now()
);

create table if not exists attempt_task_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid references attempts(id) on delete cascade,
  task_id uuid references test_tasks(id),
  answer_json jsonb,
  normalized_answer_json jsonb,
  is_correct boolean,
  awarded_score numeric,
  auto_checked_at timestamptz,
  teacher_comment text,
  teacher_checked_at timestamptz,
  answer_version integer default 1,
  updated_at timestamptz default now(),
  unique (attempt_id, task_id)
);

-- ============================================================
-- SECTION 6: Solution Requests
-- ============================================================

create table if not exists solution_requests (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid references attempts(id) not null,
  task_id uuid references test_tasks(id) not null,
  student_id uuid references profiles(id) not null,
  student_message text,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected')),
  resolved_by uuid references profiles(id),
  resolved_at timestamptz,
  teacher_note text,
  expires_at timestamptz,
  created_at timestamptz default now(),
  unique (attempt_id, task_id)
);

-- ============================================================
-- SECTION 7: Service Tables
-- ============================================================

create table if not exists parsing_jobs (
  id uuid primary key default gen_random_uuid(),
  test_version_id uuid references test_versions(id) not null,
  status text not null default 'queued'
    check (status in ('queued','processing','needs_review','done','failed')),
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  result_summary jsonb,
  created_at timestamptz default now()
);

create table if not exists parsing_warnings (
  id uuid primary key default gen_random_uuid(),
  parsing_job_id uuid references parsing_jobs(id) on delete cascade,
  task_id uuid references test_tasks(id),
  warning_type text not null,
  description text,
  source_text_snippet text,
  source_page integer,
  is_resolved boolean default false,
  resolved_by uuid references profiles(id),
  resolved_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id),
  actor_id uuid references profiles(id),
  action text not null,
  entity_type text,
  entity_id uuid,
  meta jsonb default '{}',
  created_at timestamptz default now()
);

create table if not exists presence_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid references attempts(id) on delete cascade,
  student_id uuid references profiles(id),
  event_type text not null,
  current_task_number integer,
  meta jsonb default '{}',
  created_at timestamptz default now()
);

-- ============================================================
-- SECTION 8: Indexes
-- ============================================================

create index if not exists idx_profiles_organization on profiles(organization_id);
create index if not exists idx_profiles_role on profiles(role);
create index if not exists idx_tests_organization on tests(organization_id);
create index if not exists idx_test_versions_test on test_versions(test_id);
create index if not exists idx_test_tasks_version on test_tasks(test_version_id);
create index if not exists idx_task_media_task on task_media(task_id);
create index if not exists idx_assignments_version on assignments(test_version_id);
create index if not exists idx_assignments_group on assignments(group_id);
create index if not exists idx_assignments_student on assignments(student_id);
create index if not exists idx_attempts_assignment on attempts(assignment_id);
create index if not exists idx_attempts_student on attempts(student_id);
create index if not exists idx_attempt_answers_attempt on attempt_task_answers(attempt_id);
create index if not exists idx_solution_requests_student on solution_requests(student_id);
create index if not exists idx_solution_requests_status on solution_requests(status);
create index if not exists idx_parsing_jobs_version on parsing_jobs(test_version_id);
create index if not exists idx_presence_events_attempt on presence_events(attempt_id);
create index if not exists idx_audit_logs_organization on audit_logs(organization_id);
create index if not exists idx_audit_logs_actor on audit_logs(actor_id);

-- ============================================================
-- SECTION 9: Auto-update updated_at for tests
-- ============================================================

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger tests_updated_at
  before update on tests
  for each row execute function update_updated_at();

-- ============================================================
-- SECTION 10: Auto-create profile on signup
-- ============================================================

create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', 'User'),
    coalesce(new.raw_user_meta_data->>'role', 'student')
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
