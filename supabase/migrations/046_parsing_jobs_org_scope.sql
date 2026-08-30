-- parsing_jobs RLS раньше пускала ЛЮБОГО teacher/admin к ЛЮБОЙ записи, без
-- привязки к организации/владению тестом (auth_role() in (...) и всё) — как
-- test_documents/test_tasks, тот же исторический пробел (см. память
-- project_teacher_scoping, "remaining secondary leaks to close").
-- Для parsing_jobs это стало конкретно опасно с появлением ocr_state
-- (миграция 044): без орг-скоупа чужой teacher мог через прямой PostgREST-
-- запрос (мимо нашего API) подменить ocr_state.docs[].jsonUrl на
-- произвольный URL — наш сервер потом сам его же и зафетчит при следующем
-- опросе статуса (SSRF), плюс мог читать/портить чужие parsing_jobs.
-- Все наши серверные роуты пишут в parsing_jobs через createAdminClient()
-- (service role, RLS не касается) — сужение проверено, ничего не ломает.
drop policy if exists "parsing_jobs: teacher/admin" on parsing_jobs;

create policy "parsing_jobs: teacher/admin own org" on parsing_jobs
  for all using (
    auth_role() in ('teacher','admin')
    and exists (
      select 1 from test_versions tv
      join tests t on t.id = tv.test_id
      where tv.id = parsing_jobs.test_version_id and t.organization_id = auth_org()
    )
  );
