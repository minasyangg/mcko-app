-- ============================================================
-- 093_fix_task_shared_with_auth_group_leak.sql
-- Тот же класс утечки, что 088 закрыла для attempts/attempt_task_answers/
-- student_final_results — check_task_shared_with_auth (087) остался
-- незакрытым: проверял только совпадение assignment_id, не student_id.
--
-- Для ГРУППОВОГО назначения (assignments.group_id не null, один
-- assignment_id общий для всех учеников группы) это означало: грант ОДНОГО
-- ученика группы открывал получателю (task_answer_keys/test_tasks через
-- check_task_shared_with_auth, политики 087/089) эталонные ответы и условия
-- ВСЕХ заданий версии теста — не только тех, что видел расшаривший ученик.
-- Комментарий 088 объяснял отказ чинить это тем, что "эталон не персональные
-- данные конкретного ученика" — верно с точки зрения приватности содержимого
-- задания (составитель и так раскрывает его любому участнику назначения),
-- но не с точки зрения ГРАНУЛЯРНОСТИ ГРАНТА: один ученик группы не должен
-- своим односторонним решением открывать доступ к структуре ВСЕЙ группы
-- целиком без ведома остальных участников — согласуется с принципом,
-- который уже применён к самим попыткам/ответам.
--
-- Фикс: ограничить видимость заданиями, на которые расшаривший СТУДЕНТ
-- реально отвечал (через attempt_task_answers своих попыток по этому же
-- assignment_id) — не всеми заданиями версии теста.
-- ============================================================

drop policy if exists "task_answer_keys: teacher read via share" on task_answer_keys;
drop policy if exists "test_tasks: teacher read via share" on test_tasks;
drop function if exists check_task_shared_with_auth(uuid);

create function check_task_shared_with_auth(p_task_id uuid)
returns boolean as $$
  select exists (
    select 1
    from attempt_task_answers ata
    join attempts at on at.id = ata.attempt_id
    join assignment_shares s
      on s.assignment_id = at.assignment_id and s.student_id = at.student_id
    where ata.task_id = p_task_id
      and s.teacher_id = auth.uid()
      and s.revoked_at is null
      and now() < s.expires_at
      and at.status in ('submitted','checked')
  )
$$ language sql security definer stable set search_path = public;

revoke execute on function check_task_shared_with_auth(uuid) from anon;

create policy "task_answer_keys: teacher read via share" on task_answer_keys
  for select using (auth_role() = 'teacher' and check_task_shared_with_auth(task_id));

create policy "test_tasks: teacher read via share" on test_tasks
  for select using (auth_role() = 'teacher' and check_task_shared_with_auth(id));
