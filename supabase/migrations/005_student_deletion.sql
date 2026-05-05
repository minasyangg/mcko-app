-- ============================================================
-- 004_student_deletion.sql
-- Add student deletion support with result preservation
-- ============================================================

-- Add deleted_at timestamp to track deleted students
alter table profiles
add column deleted_at timestamptz default null;

-- Create a comment explaining the soft-delete approach
comment on column profiles.deleted_at is 'Timestamp when student was deleted. Non-null means student is deleted but results are preserved for analytics.';

-- Create a function to handle student deletion
-- When called, it:
-- 1. Saves final attempt score to a denormalized table
-- 2. Deletes all other attempts
-- 3. Deletes all assignments
-- 4. Sets deleted_at on profile
-- 5. Sets is_active to false

create table if not exists student_final_results (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  test_version_id uuid not null references test_versions(id) on delete cascade,
  final_score numeric,
  max_score numeric,
  status text,
  attempt_count integer,
  last_completed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(student_id, test_version_id)
);

comment on table student_final_results is 'Denormalized final results for deleted students. Preserves analytics data.';

-- Create function to delete a student completely
-- while preserving their final test results
create or replace function delete_student_cascade(target_student_id uuid)
returns json as $$
declare
  deleted_count integer := 0;
  v_assignment_id uuid;
  v_test_version_id uuid;
  v_final_attempt attempts%rowtype;
begin
  -- Verify student exists and belongs to current user's organization
  if not exists (
    select 1 from profiles 
    where id = target_student_id 
    and role = 'student'
  ) then
    return json_build_object('error', 'Student not found');
  end if;

  -- For each test assignment, save final attempt score
  for v_assignment_id, v_test_version_id in
    select distinct a.id, a.test_version_id
    from assignments a
    where a.student_id = target_student_id
  loop
    -- Get the final (latest) attempt
    select * into v_final_attempt
    from attempts
    where assignment_id = v_assignment_id
    and student_id = target_student_id
    order by created_at desc
    limit 1;

    -- Store final result
    if found then
      insert into student_final_results (
        student_id, test_version_id, final_score,
        max_score, status, attempt_count,
        last_completed_at
      )
      select
        target_student_id,
        v_test_version_id,
        v_final_attempt.score,
        v_final_attempt.max_score,
        v_final_attempt.status,
        (select count(*) from attempts where assignment_id = v_assignment_id),
        v_final_attempt.checked_at
      on conflict (student_id, test_version_id)
      do update set
        final_score = excluded.final_score,
        max_score = excluded.max_score,
        status = excluded.status,
        attempt_count = excluded.attempt_count,
        last_completed_at = excluded.last_completed_at,
        updated_at = now();
    end if;

    -- Delete all attempts for this assignment
    delete from attempts
    where assignment_id = v_assignment_id;

    deleted_count := deleted_count + 1;
  end loop;

  -- Delete all assignments for this student (individual ones)
  delete from assignments
  where student_id = target_student_id;

  -- Remove from all groups
  delete from group_members
  where user_id = target_student_id;

  -- Mark student as deleted
  update profiles
  set deleted_at = now(),
      is_active = false
  where id = target_student_id;

  return json_build_object(
    'success', true,
    'deleted_assignments', deleted_count,
    'message', 'Student deleted successfully'
  );
end;
$$ language plpgsql security definer;

-- Create function to safely query students (exclude deleted)
create or replace function get_active_students(org_id uuid)
returns table (
  id uuid,
  full_name text,
  grade text,
  is_active boolean,
  created_at timestamptz,
  deleted_at timestamptz
) as $$
begin
  return query
  select
    profiles.id,
    profiles.full_name,
    profiles.grade,
    profiles.is_active,
    profiles.created_at,
    profiles.deleted_at
  from profiles
  where organization_id = org_id
  and role = 'student'
  order by deleted_at desc nulls first, full_name;
end;
$$ language plpgsql;
