-- ============================================================
-- 019_teacher_students_many_to_many.sql
-- Ученик может быть закреплён за НЕСКОЛЬКИМИ учителями (M:N) вместо одного
-- profiles.created_by. Прикрепление аддитивное (не перезапись).
--
-- Важное следствие для видимости: тест/назначение/попытки/итоги видит только
-- сам ученик и учитель, который их СОЗДАЛ и НАЗНАЧИЛ — НЕ любой прикреплённый
-- учитель этого ученика. Поэтому политики attempts/attempt_task_answers/
-- student_final_results переориентированы с «владения учеником» на «владение
-- назначением/тестом». Admin по-прежнему видит всё в своей организации.
--
-- profiles.created_by остаётся как «первый учитель/создатель» (информационно),
-- источник правды по прикреплениям — teacher_students.
-- ============================================================

create table if not exists teacher_students (
  teacher_id uuid references profiles(id) on delete cascade,
  student_id uuid references profiles(id) on delete cascade,
  assigned_by uuid references profiles(id),
  created_at timestamptz default now(),
  primary key (teacher_id, student_id)
);
create index if not exists idx_teacher_students_student on teacher_students(student_id);
create index if not exists idx_teacher_students_teacher on teacher_students(teacher_id);

alter table teacher_students enable row level security;

create policy "teacher_students: teacher reads own" on teacher_students
  for select using (teacher_id = auth.uid());
create policy "teacher_students: admin reads org" on teacher_students
  for select using (
    auth_role() = 'admin'
    and exists (
      select 1 from profiles p
      where p.id = teacher_students.student_id and p.organization_id = auth_org()
    )
  );
create policy "teacher_students: write service role only" on teacher_students
  for all using (false);

-- Бэкфилл из существующего profiles.created_by (single → M:N)
insert into teacher_students (teacher_id, student_id, assigned_by)
select created_by, id, created_by from profiles
where role = 'student' and created_by is not null
on conflict do nothing;

-- «Ученик закреплён за текущим учителем?» — теперь через join-таблицу.
-- Используется в profiles/group_members/assignments (право работать с учеником).
create or replace function check_student_owned_by_auth(p_student_id uuid)
returns boolean as $$
  select exists (
    select 1 from teacher_students ts
    where ts.student_id = p_student_id and ts.teacher_id = auth.uid()
  )
$$ language sql security definer stable set search_path = public;

-- profiles: учитель видит всех прикреплённых учеников (через join, не created_by)
drop policy if exists "profiles: teacher read own students" on profiles;
create policy "profiles: teacher read own students" on profiles
  for select using (
    auth_role() = 'teacher' and role = 'student' and check_student_owned_by_auth(id)
  );

-- attempts / attempt_task_answers / student_final_results: видимость по владению
-- назначением/тестом, а не по прикреплению ученика.
drop policy if exists "attempts: teacher read own students" on attempts;
create policy "attempts: teacher read own assignments" on attempts
  for select using (
    auth_role() = 'teacher' and check_attempt_assignment_owned_by_auth(id)
  );

drop policy if exists "attempt_answers: teacher read own students" on attempt_task_answers;
create policy "attempt_answers: teacher read own assignments" on attempt_task_answers
  for select using (
    auth_role() = 'teacher' and check_attempt_assignment_owned_by_auth(attempt_id)
  );

drop policy if exists "sfr: teacher reads own students" on student_final_results;
create policy "sfr: teacher reads own tests" on student_final_results
  for select using (
    auth_role() = 'teacher' and check_version_owned_by_auth(test_version_id)
  );
