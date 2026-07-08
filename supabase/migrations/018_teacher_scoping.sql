-- ============================================================
-- 018_teacher_scoping.sql — скоуп учителя: «мои ученики/группы/тесты»
-- вместо «вся организация».
--
-- До этой миграции роль teacher была эквивалентна «любой сотрудник
-- организации»: учитель видел и правил учеников, группы, тесты и
-- назначения любого другого учителя. Теперь:
--   * учеников создаёт и привязывает к учителю только admin
--     (profiles.created_by = ответственный учитель);
--   * учитель видит/правит только созданное им (группы, тесты,
--     назначения) и результаты только своих учеников;
--   * книги: поверх owner-паттерна (created_by) admin может выдать
--     точечный грант на редактирование чужой книги (book_editors);
--   * учитель не может менять роль (свою или чужую) — триггер.
-- Admin-политики остаются organization_id = auth_org() (объём прав
-- админа не меняется). library_problems не трогаем — общая база.
-- ============================================================

-- ============================================================
-- 1. profiles.created_by — какой учитель отвечает за ученика.
--    Nullable, бэкфилла нет: существующие ученики без владельца
--    видны только админу, он назначает учителя вручную через UI.
-- ============================================================

alter table profiles add column if not exists created_by uuid references profiles(id);

create index if not exists idx_profiles_created_by on profiles(created_by);

-- ============================================================
-- 2. Защита от смены роли обычным клиентом.
--    "profiles: update own" позволяла проставить себе role='admin'.
--    RLS не умеет per-колоночных ограничений — закрываем триггером.
--    auth.uid() is null только у service-role соединений (админ-клиент
--    в серверных роутах) — обычные пользовательские сессии всегда её видят.
-- ============================================================

create or replace function prevent_role_change()
returns trigger as $$
begin
  if auth.uid() is not null and NEW.role is distinct from OLD.role then
    raise exception 'Изменение роли недоступно';
  end if;
  return NEW;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.prevent_role_change() from anon, authenticated, public;

drop trigger if exists trg_prevent_role_change on profiles;
create trigger trg_prevent_role_change
  before update on profiles
  for each row execute function prevent_role_change();

-- ============================================================
-- 3. book_editors — точечный грант admin'а на редактирование чужой книги.
--    Запись — только через серверный роут (service role), как и вся
--    запись в модуле книг.
-- ============================================================

create table if not exists book_editors (
  book_id    uuid references books(id) on delete cascade,
  teacher_id uuid references profiles(id) on delete cascade,
  granted_by uuid references profiles(id),
  created_at timestamptz default now(),
  primary key (book_id, teacher_id)
);

alter table book_editors enable row level security;

create policy "book_editors: read own or admin org" on book_editors
  for select using (
    teacher_id = auth.uid()
    or (
      auth_role() = 'admin'
      and exists (
        select 1 from books b
        where b.id = book_editors.book_id
          and (b.organization_id = auth_org() or b.organization_id is null)
      )
    )
  );

create policy "book_editors: write service role only" on book_editors
  for all using (false);

-- ============================================================
-- 4. Helper-функции (security definer — обходят RLS во вложенных
--    запросах политик, как в 004_fix_rls_recursion.sql; search_path
--    закреплён по паттерну 017_security_fixes.sql).
-- ============================================================

-- Ученик закреплён за текущим учителем?
create or replace function check_student_owned_by_auth(p_student_id uuid)
returns boolean as $$
  select exists (
    select 1 from profiles
    where id = p_student_id
      and created_by = auth.uid()
      and role = 'student'
  )
$$ language sql security definer stable set search_path = public;

-- Ученик в организации текущего пользователя?
create or replace function check_student_in_auth_org(p_student_id uuid)
returns boolean as $$
  select exists (
    select 1 from profiles
    where id = p_student_id and organization_id = auth_org()
  )
$$ language sql security definer stable set search_path = public;

-- Группа создана текущим пользователем?
create or replace function check_group_owned_by_auth(p_group_id uuid)
returns boolean as $$
  select exists (
    select 1 from groups
    where id = p_group_id and created_by = auth.uid()
  )
$$ language sql security definer stable set search_path = public;

-- Группа в организации текущего пользователя?
create or replace function check_group_in_auth_org(p_group_id uuid)
returns boolean as $$
  select exists (
    select 1 from groups
    where id = p_group_id and organization_id = auth_org()
  )
$$ language sql security definer stable set search_path = public;

-- Тест создан текущим пользователем?
create or replace function check_test_owned_by_auth(p_test_id uuid)
returns boolean as $$
  select exists (
    select 1 from tests
    where id = p_test_id and created_by = auth.uid()
  )
$$ language sql security definer stable set search_path = public;

-- Версия теста принадлежит тесту текущего пользователя?
create or replace function check_version_owned_by_auth(p_version_id uuid)
returns boolean as $$
  select exists (
    select 1 from test_versions tv
    join tests t on t.id = tv.test_id
    where tv.id = p_version_id and t.created_by = auth.uid()
  )
$$ language sql security definer stable set search_path = public;

-- Версия теста в организации текущего пользователя?
create or replace function check_version_in_auth_org(p_version_id uuid)
returns boolean as $$
  select exists (
    select 1 from test_versions tv
    join tests t on t.id = tv.test_id
    where tv.id = p_version_id and t.organization_id = auth_org()
  )
$$ language sql security definer stable set search_path = public;

-- Задание принадлежит тесту текущего пользователя?
create or replace function check_task_owned_by_auth(p_task_id uuid)
returns boolean as $$
  select exists (
    select 1 from test_tasks tt
    join test_versions tv on tv.id = tt.test_version_id
    join tests t on t.id = tv.test_id
    where tt.id = p_task_id and t.created_by = auth.uid()
  )
$$ language sql security definer stable set search_path = public;

-- Задание в организации текущего пользователя?
create or replace function check_task_in_auth_org(p_task_id uuid)
returns boolean as $$
  select exists (
    select 1 from test_tasks tt
    join test_versions tv on tv.id = tt.test_version_id
    join tests t on t.id = tv.test_id
    where tt.id = p_task_id and t.organization_id = auth_org()
  )
$$ language sql security definer stable set search_path = public;

-- Назначение в организации текущего пользователя?
create or replace function check_assignment_in_auth_org(p_assignment_id uuid)
returns boolean as $$
  select exists (
    select 1 from assignments
    where id = p_assignment_id and organization_id = auth_org()
  )
$$ language sql security definer stable set search_path = public;

-- Попытка принадлежит ученику текущего учителя?
create or replace function check_attempt_student_owned_by_auth(p_attempt_id uuid)
returns boolean as $$
  select exists (
    select 1 from attempts a
    join profiles p on p.id = a.student_id
    where a.id = p_attempt_id and p.created_by = auth.uid()
  )
$$ language sql security definer stable set search_path = public;

-- Попытка в организации текущего пользователя (через назначение)?
create or replace function check_attempt_in_auth_org(p_attempt_id uuid)
returns boolean as $$
  select exists (
    select 1 from attempts a
    join assignments s on s.id = a.assignment_id
    where a.id = p_attempt_id and s.organization_id = auth_org()
  )
$$ language sql security definer stable set search_path = public;

-- Назначение попытки создано текущим учителем?
create or replace function check_attempt_assignment_owned_by_auth(p_attempt_id uuid)
returns boolean as $$
  select exists (
    select 1 from attempts a
    join assignments s on s.id = a.assignment_id
    where a.id = p_attempt_id and s.created_by = auth.uid()
  )
$$ language sql security definer stable set search_path = public;

-- ============================================================
-- 5. profiles: teacher видит только своих учеников (read-only),
--    admin — всю организацию (как раньше).
-- ============================================================

drop policy if exists "profiles: teacher/admin read same org" on profiles;

create policy "profiles: admin read org" on profiles
  for select using (
    auth_role() = 'admin' and organization_id = auth_org()
  );

create policy "profiles: teacher read own students" on profiles
  for select using (
    auth_role() = 'teacher'
    and role = 'student'
    and created_by = auth.uid()
  );

-- "profiles: read own", "profiles: update own", "profiles: admin manage org"
-- остаются без изменений (роль защищена триггером из п.2).

-- ============================================================
-- 6. groups
-- ============================================================

drop policy if exists "groups: teacher/admin read own org" on groups;
drop policy if exists "groups: teacher/admin manage" on groups;

create policy "groups: admin manage org" on groups
  for all
  using (auth_role() = 'admin' and organization_id = auth_org())
  with check (auth_role() = 'admin' and organization_id = auth_org());

create policy "groups: teacher manage own" on groups
  for all
  using (
    auth_role() = 'teacher'
    and created_by = auth.uid()
    and organization_id = auth_org()
  )
  with check (
    auth_role() = 'teacher'
    and created_by = auth.uid()
    and organization_id = auth_org()
  );

-- "groups: student read if member" остаётся.

-- ============================================================
-- 7. group_members: учитель управляет составом только своих групп
--    и может добавлять только закреплённых за ним учеников.
-- ============================================================

drop policy if exists "group_members: teacher/admin read" on group_members;
drop policy if exists "group_members: teacher/admin manage" on group_members;

create policy "group_members: admin manage org" on group_members
  for all
  using (auth_role() = 'admin' and check_group_in_auth_org(group_id))
  with check (
    auth_role() = 'admin'
    and check_group_in_auth_org(group_id)
    and check_student_in_auth_org(user_id)
  );

create policy "group_members: teacher manage own" on group_members
  for all
  using (auth_role() = 'teacher' and check_group_owned_by_auth(group_id))
  with check (
    auth_role() = 'teacher'
    and check_group_owned_by_auth(group_id)
    and check_student_owned_by_auth(user_id)
  );

-- "group_members: student read own" остаётся.

-- ============================================================
-- 8. tests
-- ============================================================

drop policy if exists "tests: teacher/admin read own org" on tests;
drop policy if exists "tests: teacher/admin manage" on tests;

create policy "tests: admin manage org" on tests
  for all
  using (auth_role() = 'admin' and organization_id = auth_org())
  with check (auth_role() = 'admin' and organization_id = auth_org());

create policy "tests: teacher manage own" on tests
  for all
  using (auth_role() = 'teacher' and created_by = auth.uid())
  with check (
    auth_role() = 'teacher'
    and created_by = auth.uid()
    and organization_id = auth_org()
  );

-- "tests: student read published via assignment" остаётся.

-- ============================================================
-- 9. test_versions
-- ============================================================

drop policy if exists "test_versions: teacher/admin read" on test_versions;
drop policy if exists "test_versions: teacher/admin manage" on test_versions;

create policy "test_versions: admin manage org" on test_versions
  for all
  using (auth_role() = 'admin' and check_test_in_auth_org(test_id))
  with check (auth_role() = 'admin' and check_test_in_auth_org(test_id));

create policy "test_versions: teacher manage own" on test_versions
  for all
  using (auth_role() = 'teacher' and check_test_owned_by_auth(test_id))
  with check (auth_role() = 'teacher' and check_test_owned_by_auth(test_id));

-- "test_versions: student read via assignment" остаётся.

-- ============================================================
-- 10. test_tasks
-- ============================================================

drop policy if exists "test_tasks: teacher/admin read" on test_tasks;
drop policy if exists "test_tasks: teacher/admin manage" on test_tasks;

create policy "test_tasks: admin manage org" on test_tasks
  for all
  using (auth_role() = 'admin' and check_version_in_auth_org(test_version_id))
  with check (auth_role() = 'admin' and check_version_in_auth_org(test_version_id));

create policy "test_tasks: teacher manage own" on test_tasks
  for all
  using (auth_role() = 'teacher' and check_version_owned_by_auth(test_version_id))
  with check (auth_role() = 'teacher' and check_version_owned_by_auth(test_version_id));

-- "test_tasks: student read via assignment" остаётся.

-- ============================================================
-- 11. task_media (task_id is null — «неприкреплённые» файлы парсинга,
--     поведение как в 009: доступны обеим ролям)
-- ============================================================

drop policy if exists "task_media: teacher/admin full" on task_media;

create policy "task_media: admin manage org" on task_media
  for all
  using (
    auth_role() = 'admin'
    and (task_id is null or check_task_in_auth_org(task_id))
  )
  with check (
    auth_role() = 'admin'
    and (task_id is null or check_task_in_auth_org(task_id))
  );

create policy "task_media: teacher manage own" on task_media
  for all
  using (
    auth_role() = 'teacher'
    and (task_id is null or check_task_owned_by_auth(task_id))
  )
  with check (
    auth_role() = 'teacher'
    and (task_id is null or check_task_owned_by_auth(task_id))
  );

-- "task_media: student read via assignment" остаётся.

-- ============================================================
-- 12. task_answer_keys
-- ============================================================

drop policy if exists "task_answer_keys: teacher/admin only" on task_answer_keys;

create policy "task_answer_keys: admin manage org" on task_answer_keys
  for all
  using (auth_role() = 'admin' and check_task_in_auth_org(task_id))
  with check (auth_role() = 'admin' and check_task_in_auth_org(task_id));

create policy "task_answer_keys: teacher manage own" on task_answer_keys
  for all
  using (auth_role() = 'teacher' and check_task_owned_by_auth(task_id))
  with check (auth_role() = 'teacher' and check_task_owned_by_auth(task_id));

-- ============================================================
-- 13. assignments: учитель создаёт назначения только на свои
--     группы/своих учеников.
-- ============================================================

drop policy if exists "assignments: teacher/admin manage" on assignments;

create policy "assignments: admin manage org" on assignments
  for all
  using (auth_role() = 'admin' and organization_id = auth_org())
  with check (auth_role() = 'admin' and organization_id = auth_org());

create policy "assignments: teacher manage own" on assignments
  for all
  using (auth_role() = 'teacher' and created_by = auth.uid())
  with check (
    auth_role() = 'teacher'
    and created_by = auth.uid()
    and organization_id = auth_org()
    and (group_id is null or check_group_owned_by_auth(group_id))
    and (student_id is null or check_student_owned_by_auth(student_id))
  );

-- "assignments: student read own" остаётся.

-- ============================================================
-- 14. attempts: результаты — только своих учеников.
-- ============================================================

drop policy if exists "attempts: teacher/admin read own org" on attempts;

create policy "attempts: admin read org" on attempts
  for select using (
    auth_role() = 'admin' and check_assignment_in_auth_org(assignment_id)
  );

create policy "attempts: teacher read own students" on attempts
  for select using (
    auth_role() = 'teacher' and check_student_owned_by_auth(student_id)
  );

-- "attempts: student manage own" остаётся.

-- ============================================================
-- 15. attempt_task_answers: ответы — в том же скоупе, что попытки
--     (старая политика была вообще без org-изоляции).
-- ============================================================

drop policy if exists "attempt_answers: teacher/admin read" on attempt_task_answers;

create policy "attempt_answers: admin read org" on attempt_task_answers
  for select using (
    auth_role() = 'admin' and check_attempt_in_auth_org(attempt_id)
  );

create policy "attempt_answers: teacher read own students" on attempt_task_answers
  for select using (
    auth_role() = 'teacher' and check_attempt_student_owned_by_auth(attempt_id)
  );

-- "attempt_answers: student manage own" остаётся.

-- ============================================================
-- 16. student_final_results: замена org-политики из 017 на
--     admin-org + teacher-own.
-- ============================================================

drop policy if exists "sfr: teachers read org students" on student_final_results;

create policy "sfr: admin reads org students" on student_final_results
  for select using (
    auth_role() = 'admin' and check_student_in_auth_org(student_id)
  );

create policy "sfr: teacher reads own students" on student_final_results
  for select using (
    auth_role() = 'teacher' and check_student_owned_by_auth(student_id)
  );

-- "sfr: student reads own" / "sfr: student upserts own" /
-- "sfr: student updates own" остаются.

-- ============================================================
-- 17. solution_requests: учитель работает только с запросами по
--     своим назначениям (attempt → assignment.created_by).
-- ============================================================

drop policy if exists "solution_requests: teacher/admin manage" on solution_requests;

create policy "solution_requests: admin manage org" on solution_requests
  for all
  using (auth_role() = 'admin' and check_attempt_in_auth_org(attempt_id))
  with check (auth_role() = 'admin' and check_attempt_in_auth_org(attempt_id));

create policy "solution_requests: teacher manage own" on solution_requests
  for all
  using (
    auth_role() = 'teacher'
    and check_attempt_assignment_owned_by_auth(attempt_id)
  )
  with check (
    auth_role() = 'teacher'
    and check_attempt_assignment_owned_by_auth(attempt_id)
  );

-- "solution_requests: student manage own" остаётся.
