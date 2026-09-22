-- ============================================================
-- 088_fix_assignment_shares_group_leak.sql
-- Найдено при верификации 087: assignment_shares.assignment_id может быть
-- ГРУППОВЫМ назначением (assignments.group_id не null, student_id null) —
-- один assignment_id общий для всех учеников группы, каждый со своими
-- attempts/attempt_task_answers/student_final_results. Хелперы
-- check_assignment_shared_with_auth/check_attempt_shared_with_auth
-- проверяли только совпадение assignment_id, не студента — из-за этого
-- грант одной ученицы (Дугина Яна расшарила СВОЮ работу) открывал
-- получателю попытки И РЕЗУЛЬТАТЫ ВСЕХ ОСТАЛЬНЫХ учеников той же группы
-- по тому же назначению. Живой тест: группа из 4 учеников, грант одной —
-- получатель видел attempts трёх (не только той, кто поделилась).
--
-- Фикс: все проверки идут не просто "есть активный грант на этот
-- assignment_id", а "есть активный грант ИМЕННО на этого student_id по
-- этому assignment_id" — сверяем student_id читаемой строки с
-- assignment_shares.student_id, не только assignment_id.
-- ============================================================

-- Сначала снимаем политики, использующие старую сигнатуру функции —
-- иначе DROP FUNCTION откажет ("policy depends on function").
drop policy if exists "attempts: teacher read via share" on attempts;
drop policy if exists "sfr: teacher reads via share" on student_final_results;
drop policy if exists "attempt_answers: teacher read via share" on attempt_task_answers;

drop function if exists check_assignment_shared_with_auth(uuid);
drop function if exists check_attempt_shared_with_auth(uuid);

create function check_assignment_shared_with_auth(p_assignment_id uuid, p_student_id uuid)
returns boolean as $$
  select exists (
    select 1 from assignment_shares
    where assignment_id = p_assignment_id
      and student_id = p_student_id
      and teacher_id = auth.uid()
      and revoked_at is null
      and now() < expires_at
  )
$$ language sql security definer stable set search_path = public;

create function check_attempt_shared_with_auth(p_attempt_id uuid)
returns boolean as $$
  select exists (
    select 1 from attempts a
    join assignment_shares s
      on s.assignment_id = a.assignment_id and s.student_id = a.student_id
    where a.id = p_attempt_id
      and s.teacher_id = auth.uid()
      and s.revoked_at is null
      and now() < s.expires_at
      and a.status in ('submitted','checked')
  )
$$ language sql security definer stable set search_path = public;

revoke execute on function check_assignment_shared_with_auth(uuid, uuid) from anon;
revoke execute on function check_attempt_shared_with_auth(uuid) from anon;

-- Пересоздаём политики с новой сигнатурой (2 аргумента — assignment_id и
-- student_id строки, не только assignment_id).
create policy "attempts: teacher read via share" on attempts
  for select using (
    auth_role() = 'teacher' and check_assignment_shared_with_auth(assignment_id, student_id)
    and status in ('submitted', 'checked')
  );

create policy "sfr: teacher reads via share" on student_final_results
  for select using (
    auth_role() = 'teacher' and check_assignment_shared_with_auth(assignment_id, student_id)
  );

create policy "attempt_answers: teacher read via share" on attempt_task_answers
  for select using (
    auth_role() = 'teacher' and check_attempt_shared_with_auth(attempt_id)
  );

-- task_answer_keys: не меняется — check_task_shared_with_auth (087) уже
-- проверяет через join assignment_shares.assignment_id, а test_tasks/эталон
-- ответа не персональные данные конкретного ученика (общие для всех
-- участников назначения), так что и без student_id это не источник утечки
-- персональных данных — только структуры теста, которую составитель и так
-- разрешил бы увидеть любому участнику расшаренного назначения.
