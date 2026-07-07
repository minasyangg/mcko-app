-- Фиксы по итогам security advisors (2026-07-07). Применено в живую БД через MCP.

-- 1. search_path у функций (advisor: function_search_path_mutable)
alter function public.auth_role() set search_path = public;
alter function public.auth_org() set search_path = public;
alter function public.update_updated_at() set search_path = public;
alter function public.handle_new_user() set search_path = public;
alter function public.check_test_in_auth_org(p_test_id uuid) set search_path = public;
alter function public.student_has_test_assignment(p_test_id uuid) set search_path = public;
alter function public.student_has_version_assignment(p_version_id uuid) set search_path = public;
alter function public.student_has_task_assignment(p_version_id uuid) set search_path = public;
alter function public.delete_student_cascade(target_student_id uuid) set search_path = public;
alter function public.get_active_students(org_id uuid) set search_path = public;
alter function public.generate_library_code() set search_path = public;

-- 2. SECURITY DEFINER функции, которые не должны вызываться клиентами
-- (delete_student_cascade вызывается только через service role в API;
--  handle_new_user — триггер; get_active_students — не используется клиентом).
-- auth_org/auth_role/check_test_in_auth_org/student_has_* остаются доступными:
-- они используются в RLS-политиках и выполняются с правами запрашивающего.
revoke execute on function public.delete_student_cascade(target_student_id uuid) from anon, authenticated, public;
revoke execute on function public.handle_new_user() from anon, authenticated, public;
revoke execute on function public.get_active_students(org_id uuid) from anon, authenticated, public;

-- 3. audit_logs: запись только через service role (у него RLS bypass),
-- всегда-истинная INSERT-политика не нужна
drop policy if exists "audit_logs: system insert" on public.audit_logs;

-- 4. library-media: публичный бакет отдаёт объекты по URL без политик;
-- широкая SELECT-политика лишь позволяла листинг всех файлов
drop policy if exists "library-media: public read" on storage.objects;

-- 5. student_final_results: RLS был включён БЕЗ политик — чтение учеником
-- своих итогов и учительский монитор молча получали пусто, upsert из
-- submit-роута блокировался
create policy "sfr: student reads own"
  on public.student_final_results for select
  using (student_id = auth.uid());

create policy "sfr: teachers read org students"
  on public.student_final_results for select
  using (
    auth_role() in ('teacher', 'admin')
    and exists (
      select 1 from public.profiles p
      where p.id = student_final_results.student_id
        and p.organization_id = auth_org()
    )
  );

create policy "sfr: student upserts own"
  on public.student_final_results for insert
  with check (student_id = auth.uid());

create policy "sfr: student updates own"
  on public.student_final_results for update
  using (student_id = auth.uid())
  with check (student_id = auth.uid());
