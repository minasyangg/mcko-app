-- Ежегодный перевод учеников в следующий класс (1 сентября).
--
-- Зачем: класс ученика (profiles.grade) — обычный текст, который правили
-- руками. Каждый учебный год все школьники переходят на класс выше, и без
-- автоматики список учеников устаревает уже к сентябрю.
--
-- Четыре части:
--   1. attempts.grade_at_attempt — снимок класса на момент попытки, чтобы
--      старые результаты не «переписывались» новым классом после перевода
--      (экспорт и аналитика брали profiles.grade вживую).
--   2. profiles.study_stage — школьник или студент. Отдельным полем, а НЕ
--      ролью: role='student' зашита в RLS-политиках и в проверках доступа
--      (вход в кабинет, списки, назначения), поэтому выпускник должен
--      остаться 'student' по роли, иначе потеряет доступ к системе.
--   3. promote_student_grades() — сам перевод, идемпотентный по учебному году.
--   4. grade_promotions — журнал прогонов, он же защита от повторного
--      перевода в том же году.

-- ─── 1. Класс на момент попытки ──────────────────────────────────────────────

alter table attempts add column if not exists grade_at_attempt text;

comment on column attempts.grade_at_attempt is
  'Класс ученика в момент начала попытки. Снимок profiles.grade — чтобы после ежегодного перевода (promote_student_grades) исторические результаты показывали тот класс, в котором они были получены, а не текущий.';

-- Заполняем историю текущим классом: до первого перевода это одно и то же,
-- и лучше иметь значение, чем NULL в старых строках.
update attempts a
set grade_at_attempt = p.grade
from profiles p
where p.id = a.student_id
  and a.grade_at_attempt is null
  and p.grade is not null;

-- Новые попытки снимают класс сами — приложению помнить об этом не нужно.
create or replace function set_attempt_grade_snapshot()
returns trigger as $$
begin
  if new.grade_at_attempt is null then
    select grade into new.grade_at_attempt from profiles where id = new.student_id;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists attempts_grade_snapshot on attempts;
create trigger attempts_grade_snapshot
  before insert on attempts
  for each row execute function set_attempt_grade_snapshot();

-- ─── 2. Этап обучения: школьник / студент ────────────────────────────────────

alter table profiles add column if not exists study_stage text not null default 'school'
  check (study_stage in ('school','student'));

comment on column profiles.study_stage is
  'Этап обучения: school — школьник (есть класс), student — студент вуза (класса нет). Отдельно от role: role остаётся ''student'' и после выпуска, потому что от неё зависят RLS-политики и доступ в кабинет. Проставляется автоматически при выпуске 11 класса (promote_student_grades).';

create index if not exists profiles_study_stage_idx on profiles(study_stage) where deleted_at is null;

-- ─── 3. Журнал переводов ─────────────────────────────────────────────────────

create table if not exists grade_promotions (
  id uuid primary key default gen_random_uuid(),
  school_year int not null,           -- год, на 1 сентября которого сделан перевод
  promoted_count int not null default 0,
  graduated_count int not null default 0,
  ran_at timestamptz not null default now(),
  ran_by uuid references profiles(id),  -- null = автоматический прогон (cron)
  unique (school_year)
);

comment on table grade_promotions is
  'Журнал ежегодных переводов классов. UNIQUE(school_year) — защита от повторного перевода: за один учебный год класс поднимается ровно один раз, сколько бы раз ни вызвали promote_student_grades().';

alter table grade_promotions enable row level security;

drop policy if exists "grade_promotions: teacher/admin read" on grade_promotions;
create policy "grade_promotions: teacher/admin read" on grade_promotions
  for select using (auth_role() in ('teacher','admin'));

-- ─── 4. Сам перевод ──────────────────────────────────────────────────────────

-- Учебный год: с 1 сентября считается уже следующий. 2026-09-02 → 2026,
-- 2026-08-30 → 2025. От него зависит, был ли перевод в этом году.
create or replace function current_school_year(at_date date default current_date)
returns int as $$
  select case when extract(month from at_date) >= 9
              then extract(year from at_date)::int
              else extract(year from at_date)::int - 1
         end;
$$ language sql immutable;

-- Переводит всех активных школьников на класс выше:
--   • 1..10 → +1
--   • 11    → выпуск: study_stage='student', grade обнуляется, role НЕ трогаем
--   • нечисловые и пустые классы не трогаются (решение пользователя)
-- Идемпотентна: повторный вызов в том же учебном году ничего не делает,
-- если только не передать p_force := true.
create or replace function promote_student_grades(
  p_actor uuid default null,
  p_force boolean default false
)
returns table (promoted int, graduated int, skipped_already_done boolean) as $$
declare
  v_year int := current_school_year();
  v_promoted int := 0;
  v_graduated int := 0;
begin
  if not p_force and exists (select 1 from grade_promotions where school_year = v_year) then
    return query select 0, 0, true;
    return;
  end if;

  -- Выпуск 11 класса: человек остаётся в системе с той же ролью и доступами,
  -- меняется только этап обучения. Его прошлые результаты не трогаем —
  -- класс на момент попытки помнит attempts.grade_at_attempt.
  with graduates as (
    update profiles
    set study_stage = 'student', grade = null
    where role = 'student'
      and deleted_at is null
      and study_stage = 'school'
      and grade ~ '^\s*11\s*$'
    returning 1
  )
  select count(*)::int into v_graduated from graduates;

  -- Остальные числовые классы (1..10): +1
  with promoted_rows as (
    update profiles
    set grade = (trim(grade)::int + 1)::text
    where role = 'student'
      and deleted_at is null
      and study_stage = 'school'
      and grade ~ '^\s*\d+\s*$'
      and trim(grade)::int between 1 and 10
    returning 1
  )
  select count(*)::int into v_promoted from promoted_rows;

  insert into grade_promotions (school_year, promoted_count, graduated_count, ran_by)
  values (v_year, v_promoted, v_graduated, p_actor)
  on conflict (school_year) do update
    set promoted_count  = grade_promotions.promoted_count + excluded.promoted_count,
        graduated_count = grade_promotions.graduated_count + excluded.graduated_count,
        ran_at = now();

  return query select v_promoted, v_graduated, false;
end;
$$ language plpgsql security definer set search_path = public;

-- Вызывают только сервер (service role) и cron — не клиент.
revoke execute on function promote_student_grades(uuid, boolean) from anon, authenticated, public;
revoke execute on function current_school_year(date) from anon, authenticated, public;
