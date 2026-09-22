-- ============================================================
-- 090_fix_shared_with_me_join_chain.sql
-- Страница «Расшарено мне» (app/teacher/shared-with-me/page.tsx) тянет
-- assignments!assignment_id(created_by, test_versions!test_version_id(
-- tests!test_id(title, subject, exam_type))) вложенным join из
-- assignment_shares. Ни у assignments, ни у test_versions, ни у tests не
-- было политики для получателя гранта — join рвался на ПЕРВОМ же звене
-- (assignments), поэтому пропадали сразу и "Тест" (title), и "Учитель"
-- (created_by), хотя сам assignment_shares и student_final_results (прямой
-- SELECT по assignment_id, без join через assignments) отдавали данные
-- нормально — отсюда видимый балл при пустых остальных колонках.
--
-- Тот же класс упущения, что 089 (test_tasks/profiles) — при добавлении
-- нового UI-места, читающего через шаринг, каждое использованное звено join
-- нужно явно разрешить в RLS, обычная политика на assignment_shares саму
-- цепочку не продолжает.
-- ============================================================

create policy "assignments: teacher read via share" on assignments
  for select using (
    auth_role() = 'teacher'
    and exists (
      select 1 from assignment_shares s
      where s.assignment_id = assignments.id
        and s.teacher_id = auth.uid()
        and s.revoked_at is null
        and now() < s.expires_at
    )
  );

create policy "test_versions: teacher read via share" on test_versions
  for select using (
    auth_role() = 'teacher'
    and exists (
      select 1 from assignments a
      join assignment_shares s on s.assignment_id = a.id
      where a.test_version_id = test_versions.id
        and s.teacher_id = auth.uid()
        and s.revoked_at is null
        and now() < s.expires_at
    )
  );

create policy "tests: teacher read via share" on tests
  for select using (
    auth_role() = 'teacher'
    and exists (
      select 1 from assignments a
      join test_versions tv on tv.id = a.test_version_id
      join assignment_shares s on s.assignment_id = a.id
      where tv.test_id = tests.id
        and s.teacher_id = auth.uid()
        and s.revoked_at is null
        and now() < s.expires_at
    )
  );
