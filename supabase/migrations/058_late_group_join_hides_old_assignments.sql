-- Ученик, добавленный в группу заметно позже, чем создано конкретное
-- групповое назначение, не должен видеть это назначение как своё.
--
-- Найдено на живом случае: Абрамян Варвара заведена и добавлена в группу
-- «Успех 10-Ф» 3 сентября — группа существует с мая, и на неё уже накопилось
-- 9 назначений (с мая по июнь), заданных Оверченко Тарасу и Янсону
-- Александру. Модель назначения на группу — живая ссылка (assignments.
-- group_id), а не снимок участников на момент создания: доступ ученика
-- проверяется по ТЕКУЩЕМУ членству в группе при каждом обращении. В итоге
-- Варвара молча получила видимость всей истории группы, включая тесты,
-- которые ей никто не задавал, и уже успела сдать один из них.
--
-- Правило (по решению пользователя):
--   • сравниваем group_members.added_at (дата вступления ЭТОГО ученика в
--     группу) с assignments.created_at (дата создания ИМЕННО этого
--     назначения) — не с датой вступления других участников группы;
--   • если ученик вступил ПОЗЖЕ создания назначения БОЛЕЕ ЧЕМ на 3 дня —
--     назначение ему не показывается;
--   • если вступил раньше или в тот же период (обычный порядок: сначала
--     собрали группу, потом задали тест) — видно всегда, без ограничений;
--   • правило касается ТОЛЬКО групповых назначений (через group_id, включая
--     системные группы программ-roadmap) — персональные (student_id
--     напрямую) не имеют понятия «вступления в группу» и не затрагиваются.
--
-- Единая точка правды — student_sees_group_assignment(assignment_id,
-- student_id): используется во всех местах, где раньше был инлайновый
-- "exists (select 1 from group_members gm where gm.group_id = a.group_id
-- and gm.user_id = ...)", чтобы правило не разошлось между копиями.
create or replace function student_sees_group_assignment(p_assignment_id uuid, p_student_id uuid)
returns boolean as $$
  select exists (
    select 1
    from assignments a
    join group_members gm on gm.group_id = a.group_id
    where a.id = p_assignment_id
      and gm.user_id = p_student_id
      and gm.added_at <= a.created_at + interval '3 days'
  )
$$ language sql stable security definer set search_path = public;

comment on function student_sees_group_assignment is
  'Видно ли ГРУППОВОЕ назначение ученику: он должен состоять в группе назначения, вступив не позже чем через 3 дня после создания самого назначения (иначе видна вся история группы, накопленная до его прихода). Персональных назначений (student_id) не касается.';

-- ── RLS-функции: заменяем инлайновую проверку членства на единую функцию ──

create or replace function student_has_test_assignment(p_test_id uuid)
returns boolean as $$
  select exists (
    select 1 from assignments a
    join test_versions tv on tv.id = a.test_version_id
    where tv.test_id = p_test_id
      and (
        a.student_id = auth.uid()
        or student_sees_group_assignment(a.id, auth.uid())
      )
  )
$$ language sql stable security definer set search_path = public;

create or replace function student_has_version_assignment(p_version_id uuid)
returns boolean as $$
  select exists (
    select 1 from assignments a
    where a.test_version_id = p_version_id
      and (
        a.student_id = auth.uid()
        or student_sees_group_assignment(a.id, auth.uid())
      )
  )
$$ language sql stable security definer set search_path = public;

create or replace function check_attempt_startable(p_assignment_id uuid, p_student_id uuid)
returns boolean as $$
  select
    exists (
      select 1 from assignments a
      where a.id = p_assignment_id
        and a.closed_at is null
        and (
          a.student_id = p_student_id
          or student_sees_group_assignment(a.id, p_student_id)
        )
    )
    and not exists (
      select 1 from student_final_results sfr
      where sfr.assignment_id = p_assignment_id
        and sfr.student_id = p_student_id
        and sfr.closed_reason is not null
    )
$$ language sql stable security definer set search_path = public;
