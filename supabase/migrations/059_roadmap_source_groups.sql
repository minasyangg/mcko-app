-- Живая связь «группа → программа»: раньше кнопка «Добавить группу» в
-- редакторе программы (RoadmapEditor.addGroup) просто копировала ТЕКУЩИЙ
-- список участников группы в чекбоксы, а PATCH /roadmaps/[id]/students
-- сохранял этот снимок как полный список участников системной группы
-- программы — без связи «эта группа питает эту программу» в базе. Новый
-- ученик, добавленный в исходную группу позже, в программу не попадал
-- (см. живой случай: Смиронова Зоя добавлена в «Успех 10-Ф», связанная
-- программа «Успех 10-ЕГЭ-Ф» ДЗ ей не назначила, пока учитель не добавил
-- её в системную группу программы вручную).

-- 1. Таблица связи: какие «обычные» группы — источники участников программы
create table if not exists roadmap_source_groups (
  roadmap_id uuid references roadmaps(id) on delete cascade not null,
  group_id uuid references groups(id) on delete cascade not null,
  added_at timestamptz default now(),
  primary key (roadmap_id, group_id)
);

create index if not exists idx_roadmap_source_groups_group on roadmap_source_groups(group_id);

-- 2. Функция синка одного ученика во все программы, для которых указанная
-- группа — источник. SECURITY DEFINER: пишет в group_members системной
-- группы программы в обход RLS вызывающей стороны, как остальные хелперы
-- модуля роадмапов (021).
--
-- Условие «закреплён за учителем программы» — то же самое, что уже
-- проверяет ручной PATCH /roadmaps/[id]/students (teacher_students,
-- M:N): триггер не должен привязывать к программе чужого ученика,
-- случайно попавшего в группу-источник.
--
-- Возвращает integer (число программ, куда реально добавили), а не void:
-- «void» PostgREST/типогенератор молча не включает в OpenAPI-схему, из-за
-- чего supabase gen types не видел эту функцию вообще.
create or replace function sync_student_to_roadmaps_from_group(p_group_id uuid, p_user_id uuid)
returns integer as $$
  with ins as (
    insert into group_members (group_id, user_id)
    select r.group_id, p_user_id
    from roadmap_source_groups rsg
    join roadmaps r on r.id = rsg.roadmap_id
    where rsg.group_id = p_group_id
      and r.group_id is not null
      and r.group_id <> p_group_id  -- на всякий случай: не добавлять группу саму в себя
      and exists (
        select 1 from teacher_students ts
        where ts.teacher_id = r.created_by and ts.student_id = p_user_id
      )
    on conflict (group_id, user_id) do nothing
    returning 1
  )
  select count(*)::integer from ins
$$ language sql security definer set search_path = public;

-- 3. Триггер: новый участник группы-источника → сразу во все её программы
create or replace function trg_group_members_sync_roadmaps()
returns trigger as $$
begin
  perform sync_student_to_roadmaps_from_group(new.group_id, new.user_id);
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists group_members_sync_roadmaps on group_members;
create trigger group_members_sync_roadmaps
  after insert on group_members
  for each row
  execute function trg_group_members_sync_roadmaps();

-- 4. RLS: тот же контур владения, что у остальных таблиц роадмапов (021) —
-- учитель управляет связями своих программ, админ читает по организации.
alter table roadmap_source_groups enable row level security;

drop policy if exists "roadmap_source_groups: teacher manage own" on roadmap_source_groups;
create policy "roadmap_source_groups: teacher manage own" on roadmap_source_groups
  for all
  using (auth_role() = 'teacher' and check_roadmap_owned_by_auth(roadmap_id))
  with check (auth_role() = 'teacher' and check_roadmap_owned_by_auth(roadmap_id));

drop policy if exists "roadmap_source_groups: admin read org" on roadmap_source_groups;
create policy "roadmap_source_groups: admin read org" on roadmap_source_groups
  for select using (auth_role() = 'admin' and check_roadmap_in_auth_org(roadmap_id));
