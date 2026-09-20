-- ============================================================
-- 089_fix_sharing_visibility_gaps.sql
-- Два бага, найденные при живой проверке шаринга (Дугина Яна → Ащербеков
-- Чингиз): 087 расширила RLS на attempts/attempt_task_answers/
-- student_final_results/task_answer_keys, но упустила две связанные
-- вложенные таблицы, к которым идут join прямо из клиентского кода —
-- без отдельной политики на них join молча возвращает null, а не строку.
--
-- 1) test_tasks — AttemptDrawer тянет условие задания через вложенный
--    join test_tasks(...) внутри attempt_task_answers.select(). У
--    test_tasks не было НИКАКОЙ политики для получателя гранта — ответы
--    ученицы получатель видел (attempt_task_answers сама разрешена), а
--    условия заданий (prompt_text/prompt_html) — нет. Тот же хелпер
--    check_task_shared_with_auth, что уже используется для task_answer_keys.
--
-- 2) profiles (учитель в whitelist) — ShareAssignmentDialog у ученика
--    тянет ФИО учителя через join profiles!teacher_id(full_name) внутри
--    student_share_recipients.select(), обычным (не admin) клиентом.
--    У profiles нет политики "ученик читает профиль учителя из своего
--    whitelist" — только "читает свой профиль" и "учитель читает своих
--    учеников". Получался прочерк вместо ФИО, хотя сам список получателей
--    (id) приходил верно.
-- ============================================================

create policy "test_tasks: teacher read via share" on test_tasks
  for select using (auth_role() = 'teacher' and check_task_shared_with_auth(id));

-- Ученик видит full_name ТОЛЬКО тех учителей, кого сам администратор внёс
-- в его личный whitelist (student_share_recipients) — не любого учителя
-- организации. Точечно, по аналогии с остальной моделью шаринга.
create policy "profiles: student reads own share recipients" on profiles
  for select using (
    role = 'teacher'
    and exists (
      select 1 from student_share_recipients ssr
      where ssr.teacher_id = profiles.id and ssr.student_id = auth.uid()
    )
  );
