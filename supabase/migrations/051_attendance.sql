-- Журнал посещаемости: гибкая таблица «ученики × даты занятий».
--
-- Модель намеренно НЕ переиспользует groups/group_members: там группы для
-- назначения тестов, привязаны к учителю-владельцу и участвуют в RLS попыток.
-- Журнал — отдельный инструмент учёта: одна и та же группа может вестись
-- несколькими журналами (разные предметы/периоды), состав журнала может не
-- совпадать с учебной группой, а строкой журнала может быть ученик, которого
-- в системе ещё нет как пользователя.
--
-- Три таблицы:
--   attendance_journals  — сам журнал (название, предмет, владелец)
--   attendance_students  — строки журнала: ссылка на profiles ЛИБО просто ФИО
--   attendance_days      — колонки журнала: даты занятий
--   attendance_marks     — ячейки: (ученик, день) → отметка

create table if not exists attendance_journals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) not null,
  created_by uuid references profiles(id) not null,
  title text not null,
  subject text,
  created_at timestamptz not null default now()
);

-- Строка журнала. student_id заполнен, если ученик есть на сайте; иначе
-- используется full_name — чтобы можно было вести журнал по любому списку
-- детей, не заводя каждому учётную запись.
create table if not exists attendance_students (
  id uuid primary key default gen_random_uuid(),
  journal_id uuid references attendance_journals(id) on delete cascade not null,
  student_id uuid references profiles(id) on delete set null,
  full_name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  -- один и тот же ученик сайта не должен попасть в журнал дважды
  unique (journal_id, student_id)
);

create index if not exists attendance_students_journal_idx on attendance_students(journal_id, sort_order);

-- Колонка журнала — учебный день. Даты добавляются пачками (см. UI: выбрать
-- дни недели и продублировать на N недель), поэтому уникальность на (журнал,
-- дата) защищает от дублей при повторном применении шаблона.
create table if not exists attendance_days (
  id uuid primary key default gen_random_uuid(),
  journal_id uuid references attendance_journals(id) on delete cascade not null,
  day date not null,
  note text,
  created_at timestamptz not null default now(),
  unique (journal_id, day)
);

create index if not exists attendance_days_journal_idx on attendance_days(journal_id, day);

-- Ячейка. Отсутствие строки = отметки нет (пусто), это отдельное состояние от
-- «выходной»: пустую клетку учитель ещё не заполнил, «вых» — сознательно
-- отмеченный нерабочий день.
create table if not exists attendance_marks (
  id uuid primary key default gen_random_uuid(),
  journal_id uuid references attendance_journals(id) on delete cascade not null,
  student_id uuid references attendance_students(id) on delete cascade not null,
  day_id uuid references attendance_days(id) on delete cascade not null,
  -- present «+», absent «н», sick «б», holiday «вых»
  status text not null check (status in ('present','absent','sick','holiday')),
  updated_at timestamptz not null default now(),
  unique (student_id, day_id)
);

create index if not exists attendance_marks_journal_idx on attendance_marks(journal_id);

-- ── RLS ──
-- Журнал — инструмент учителя; админ видит журналы своей организации.
-- Дочерние таблицы проверяются через владение журналом (security definer
-- helper, как check_roadmap_* в 021: подзапрос в политике на другую таблицу
-- с RLS иначе упирается в её же политику).
create or replace function check_attendance_journal_access(p_journal_id uuid)
returns boolean as $$
  select exists (
    select 1 from attendance_journals j
    where j.id = p_journal_id
      and j.organization_id = auth_org()
      and (j.created_by = auth.uid() or auth_role() = 'admin')
  )
$$ language sql security definer stable set search_path = public;

alter table attendance_journals enable row level security;
alter table attendance_students enable row level security;
alter table attendance_days enable row level security;
alter table attendance_marks enable row level security;

drop policy if exists "attendance_journals: owner or admin" on attendance_journals;
create policy "attendance_journals: owner or admin" on attendance_journals
  for all
  using (
    organization_id = auth_org()
    and (created_by = auth.uid() or auth_role() = 'admin')
  )
  with check (
    organization_id = auth_org()
    and auth_role() in ('teacher','admin')
  );

drop policy if exists "attendance_students: via journal" on attendance_students;
create policy "attendance_students: via journal" on attendance_students
  for all
  using (check_attendance_journal_access(journal_id))
  with check (check_attendance_journal_access(journal_id));

drop policy if exists "attendance_days: via journal" on attendance_days;
create policy "attendance_days: via journal" on attendance_days
  for all
  using (check_attendance_journal_access(journal_id))
  with check (check_attendance_journal_access(journal_id));

drop policy if exists "attendance_marks: via journal" on attendance_marks;
create policy "attendance_marks: via journal" on attendance_marks
  for all
  using (check_attendance_journal_access(journal_id))
  with check (check_attendance_journal_access(journal_id));
