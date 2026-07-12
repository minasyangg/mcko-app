-- Road map (учебные программы) поверх существующего контура назначений.
-- Каждая road map владеет скрытой системной группой (roadmaps.group_id):
-- ученики road map = участники этой группы; привязка теста к теме = обычное
-- групповое назначение на эту группу с roadmap_topic_id и меткой kind.
-- Благодаря этому кабинет ученика/попытки/мониторинг/результаты работают без
-- изменений — road map лишь организует назначения по темам.

-- 1. Программы
create table if not exists roadmaps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) not null,
  created_by uuid references profiles(id) not null,        -- учитель-владелец
  group_id uuid references groups(id) on delete set null,  -- скрытая системная группа
  title text not null,
  subject text,
  description text,
  created_at timestamptz default now()
);

-- 2. Темы (плоский упорядоченный список)
create table if not exists roadmap_topics (
  id uuid primary key default gen_random_uuid(),
  roadmap_id uuid references roadmaps(id) on delete cascade not null,
  title text not null,
  description text,
  sort_order int not null default 0,
  created_at timestamptz default now()
);

-- 3. Пометка системной группы road map — скрываем её из раздела «Группы»
alter table groups add column if not exists roadmap_id uuid references roadmaps(id) on delete cascade;

-- 4. Привязка назначения к теме road map + метка ДЗ/тест
alter table assignments add column if not exists roadmap_topic_id uuid references roadmap_topics(id) on delete cascade;
alter table assignments add column if not exists kind text check (kind in ('homework','test'));

create index if not exists idx_roadmap_topics_roadmap on roadmap_topics(roadmap_id);
create index if not exists idx_assignments_roadmap_topic on assignments(roadmap_topic_id);
create index if not exists idx_groups_roadmap on groups(roadmap_id);

-- ── Хелперы (SECURITY DEFINER, как в 018/019) ──
create or replace function check_roadmap_owned_by_auth(p_roadmap_id uuid)
returns boolean as $$
  select exists (
    select 1 from roadmaps r where r.id = p_roadmap_id and r.created_by = auth.uid()
  )
$$ language sql security definer stable set search_path = public;

create or replace function check_roadmap_in_auth_org(p_roadmap_id uuid)
returns boolean as $$
  select exists (
    select 1 from roadmaps r where r.id = p_roadmap_id and r.organization_id = auth_org()
  )
$$ language sql security definer stable set search_path = public;

-- Ученик состоит в road map, если он в её системной группе
create or replace function check_roadmap_member(p_roadmap_id uuid)
returns boolean as $$
  select exists (
    select 1 from roadmaps r
    join group_members gm on gm.group_id = r.group_id
    where r.id = p_roadmap_id and gm.user_id = auth.uid()
  )
$$ language sql security definer stable set search_path = public;

-- ── RLS ──
alter table roadmaps enable row level security;
alter table roadmap_topics enable row level security;

-- roadmaps
drop policy if exists "roadmaps: teacher manage own" on roadmaps;
create policy "roadmaps: teacher manage own" on roadmaps
  for all
  using (auth_role() = 'teacher' and created_by = auth.uid())
  with check (auth_role() = 'teacher' and created_by = auth.uid() and organization_id = auth_org());

drop policy if exists "roadmaps: admin read org" on roadmaps;
create policy "roadmaps: admin read org" on roadmaps
  for select using (auth_role() = 'admin' and organization_id = auth_org());

drop policy if exists "roadmaps: student read member" on roadmaps;
create policy "roadmaps: student read member" on roadmaps
  for select using (auth_role() = 'student' and check_roadmap_member(id));

-- roadmap_topics
drop policy if exists "roadmap_topics: teacher manage own" on roadmap_topics;
create policy "roadmap_topics: teacher manage own" on roadmap_topics
  for all
  using (auth_role() = 'teacher' and check_roadmap_owned_by_auth(roadmap_id))
  with check (auth_role() = 'teacher' and check_roadmap_owned_by_auth(roadmap_id));

drop policy if exists "roadmap_topics: admin read org" on roadmap_topics;
create policy "roadmap_topics: admin read org" on roadmap_topics
  for select using (auth_role() = 'admin' and check_roadmap_in_auth_org(roadmap_id));

drop policy if exists "roadmap_topics: student read member" on roadmap_topics;
create policy "roadmap_topics: student read member" on roadmap_topics
  for select using (auth_role() = 'student' and check_roadmap_member(roadmap_id));
