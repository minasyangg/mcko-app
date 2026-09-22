-- ============================================================
-- 091_fix_shared_with_me_sender_profile.sql
-- «Учитель» (составитель расшаренного назначения) не отображался на
-- странице «Расшарено мне» — app/teacher/shared-with-me/page.tsx делает
-- ОТДЕЛЬНЫЙ SELECT profiles.in(senderIds) для составителей, и у profiles не
-- было политики, разрешающей получателю гранта читать профиль отправителя.
--
-- На тесте это не проявлялось для ФИО УЧЕНИКА (student_id внутри join
-- assignment_shares) только потому, что тестовый получатель (Ащербеков)
-- случайно уже прикреплён к этой ученице через teacher_students — политика
-- "teacher read own students" срабатывала независимо от гранта. Для
-- получателя, не прикреплённого к ученику, то же самое было бы пусто и там
-- тоже — поэтому здесь закрываем сразу оба случая, симметрично 089
-- ("student reads own share recipients"), не только тот, что видно на
-- скриншоте.
-- ============================================================

-- Получатель гранта видит профиль СОСТАВИТЕЛЯ расшаренного назначения
-- (assignments.created_by) — нужно для колонки «Учитель».
create policy "profiles: teacher reads sender via share" on profiles
  for select using (
    role = 'teacher'
    and exists (
      select 1 from assignments a
      join assignment_shares s on s.assignment_id = a.id
      where a.created_by = profiles.id
        and s.teacher_id = auth.uid()
        and s.revoked_at is null
        and now() < s.expires_at
    )
  );

-- Получатель гранта видит профиль УЧЕНИКА, который поделился (для колонки
-- «Ученик») — не полагаясь на случайное совпадение с teacher_students.
create policy "profiles: teacher reads student via share" on profiles
  for select using (
    role = 'student'
    and exists (
      select 1 from assignment_shares s
      where s.student_id = profiles.id
        and s.teacher_id = auth.uid()
        and s.revoked_at is null
        and now() < s.expires_at
    )
  );
