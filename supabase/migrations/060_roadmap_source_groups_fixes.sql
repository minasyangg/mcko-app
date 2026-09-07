-- Аудит перед мержем 059 в main выявил два реальных пробела:
--
-- 1) sync_student_to_roadmaps_from_group молча не синхронизировал ученика,
--    если на момент вступления в группу-источник он ещё не был закреплён за
--    учителем через teacher_students (обычный порядок онбординга: сначала
--    добавили в группу, только потом «привязали» как своего ученика) — и
--    больше НИКОГДА не пересинхронизировался, потому что триггер висел
--    только на group_members. Это воспроизводило тот же класс бага
--    (Смиронова Зоя), просто на другом отсутствующем условии.
--
-- 2) POST /api/roadmaps/[id]/source-groups синхронизировал существующих
--    участников группы последовательным циклом — один RPC-вызов на каждого
--    ученика. Для большой группы это и нарушение правила проекта «всегда
--    LIMIT, не читай/не обрабатывай построчно без нужды» (AGENTS.md), и
--    риск исчерпать лимит времени serverless-функции.
--
-- Оба фикса ниже.

-- 1. Функция для батч-синка ВСЕЙ группы разом (используется вместо цикла в
-- API) — тот же predicate, что и в sync_student_to_roadmaps_from_group,
-- но одним insert...select без per-user round trip.
create or replace function sync_group_to_roadmaps(p_group_id uuid)
returns integer as $$
  with ins as (
    insert into group_members (group_id, user_id)
    select distinct r.group_id, gm.user_id
    from group_members gm
    join roadmap_source_groups rsg on rsg.group_id = gm.group_id
    join roadmaps r on r.id = rsg.roadmap_id
    where gm.group_id = p_group_id
      and r.group_id is not null
      and r.group_id <> p_group_id
      and exists (
        select 1 from teacher_students ts
        where ts.teacher_id = r.created_by and ts.student_id = gm.user_id
      )
    on conflict (group_id, user_id) do nothing
    returning 1
  )
  select count(*)::integer from ins
$$ language sql security definer set search_path = public;

-- 2. Триггер на teacher_students: как только ученика закрепляют за
-- учителем, досинхронизировать его во все программы этого учителя, для
-- которых он уже состоит в зарегистрированной группе-источнике, но не
-- попал туда раньше именно из-за отсутствия этой связи.
create or replace function trg_teacher_students_sync_roadmaps()
returns trigger as $$
begin
  insert into group_members (group_id, user_id)
  select distinct r.group_id, new.student_id
  from group_members gm
  join roadmap_source_groups rsg on rsg.group_id = gm.group_id
  join roadmaps r on r.id = rsg.roadmap_id
  where gm.user_id = new.student_id
    and r.created_by = new.teacher_id
    and r.group_id is not null
  on conflict (group_id, user_id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists teacher_students_sync_roadmaps on teacher_students;
create trigger teacher_students_sync_roadmaps
  after insert on teacher_students
  for each row
  execute function trg_teacher_students_sync_roadmaps();
