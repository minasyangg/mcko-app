-- Аудит: RLS на roadmap_source_groups проверяла только владение ПРОГРАММОЙ
-- (check_roadmap_owned_by_auth), но не владение самой группой-источником.
-- Инвариант «источник должен принадлежать тому же учителю» был закреплён
-- только в app/api/roadmaps/[id]/source-groups/route.ts — то есть только для
-- запросов через этот конкретный роут (он и так пишет через service-role,
-- минуя RLS). Любой ДРУГОЙ путь записи в эту таблицу с JWT учителя (прямой
-- PostgREST-вызов, будущий admin-инструмент) RLS этого не проверял.
--
-- Добавляем то же условие в саму политику — защита в глубину, а не только на
-- уровне одного API-роута. check_group_owned_by_auth уже существует (018) —
-- используем её, а не заводим дубль.
drop policy if exists "roadmap_source_groups: teacher manage own" on roadmap_source_groups;
create policy "roadmap_source_groups: teacher manage own" on roadmap_source_groups
  for all
  using (
    auth_role() = 'teacher'
    and check_roadmap_owned_by_auth(roadmap_id)
    and check_group_owned_by_auth(group_id)
  )
  with check (
    auth_role() = 'teacher'
    and check_roadmap_owned_by_auth(roadmap_id)
    and check_group_owned_by_auth(group_id)
  );
