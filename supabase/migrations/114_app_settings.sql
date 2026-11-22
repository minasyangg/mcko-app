-- ============================================================
-- 114_app_settings.sql
-- Настройки системы, которые администратор меняет со страницы
-- «Настройки системы» (/teacher/system-settings), а не правкой БД
-- ============================================================
--
-- Пороги по времени (правило «3 дня», окно повторов задач, расписание
-- рассылки…) были зашиты в код и SQL. Теперь значение берётся из
-- app_settings, а при отсутствии строки — по умолчанию.
--
-- Значения по умолчанию живут в двух местах и ОБЯЗАНЫ совпадать:
-- lib/settings/registry.ts (код) и вторые аргументы app_setting_int ниже
-- (SQL). Пустая таблица = поведение до этой миграции.

-- ── 1. Таблица ──────────────────────────────────────────────────────────
create table if not exists public.app_settings (
  key        text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

comment on table public.app_settings is
  'Настройки системы (ключ → значение). Пишет только сервер (service role) из /api/admin/settings после проверки роли admin и диапазонов (lib/settings/registry.ts). Нет строки — действует значение по умолчанию.';

-- Клиентам таблица не нужна: код читает её service-role клиентом, SQL —
-- через app_setting_int. RLS без политик закрывает её для anon/authenticated.
alter table public.app_settings enable row level security;

-- ── 2. Чтение из SQL ────────────────────────────────────────────────────
-- security definer: функцию вызывают и из-под учителя (view assigned_problems
-- с security_invoker), а политик на чтение у таблицы нет. Не число — значение
-- по умолчанию, а не ошибка: настройка не должна ломать доступ к заданиям.
create or replace function public.app_setting_int(p_key text, p_default integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select case when jsonb_typeof(value) = 'number' then round((value #>> '{}')::numeric)::integer end
       from app_settings where key = p_key),
    p_default
  )
$$;

revoke all on function public.app_setting_int(text, integer) from public, anon;
grant execute on function public.app_setting_int(text, integer) to authenticated, service_role;

-- ── 3. Правило «вступил в группу позже» — из настройки ──────────────────
-- Тело — из 110, вместо interval '3 days' — late_join_days.
create or replace function public.student_sees_group_assignment(p_assignment_id uuid, p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from assignments a
    join group_members gm on gm.group_id = a.group_id
    where a.id = p_assignment_id
      and gm.user_id = p_student_id
      and gm.added_at <= greatest(a.created_at, a.starts_at)
        + make_interval(days => app_setting_int('late_join_days', 3))
  )
$$;

-- ── 4. Окно повторов задач — из настройки ───────────────────────────────
-- Определение — из 052, вместо interval '11 months' — repeat_window_months.
create or replace view assigned_problems as
select
  coalesce(a.student_id, gm.user_id)                as student_id,
  t.created_by                                      as teacher_id,
  tt.book_problem_id,
  tt.library_problem_id,
  coalesce(tt.book_problem_id, tt.library_problem_id) as problem_id,
  t.id                                              as test_id,
  t.title                                           as test_title,
  t.kind                                            as test_kind,
  a.id                                              as assignment_id,
  a.created_at                                      as assigned_at
from test_tasks tt
join test_versions tv on tv.id = tt.test_version_id
join tests         t  on t.id  = tv.test_id
join assignments   a  on a.test_version_id = tv.id
left join group_members gm on gm.group_id = a.group_id
where (tt.book_problem_id is not null or tt.library_problem_id is not null)
  and coalesce(a.student_id, gm.user_id) is not null
  and a.created_at > now() - make_interval(months => app_setting_int('repeat_window_months', 11));

comment on view assigned_problems is
  'Задачи из книг/библиотеки, уже заданные ученику этим же учителем за последние N месяцев (app_settings.repeat_window_months, по умолчанию 11). Используется для предупреждения о повторах при сборке ДЗ (не запрет).';

alter view assigned_problems set (security_invoker = true);

-- ── 5. Расписание рассылки об открывшихся заданиях ──────────────────────
-- Меняет только расписание задания из 111 (cron.alter_job), команда и секрет
-- остаются прежними. Выражение собирает сервер из проверенных чисел
-- (lib/settings/registry.ts → dispatchCron); здесь — грубая проверка формата.
-- Задание принадлежит postgres, функция выполняется от владельца — postgres.
create or replace function public.set_notification_dispatch_schedule(p_schedule text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job bigint;
begin
  if p_schedule is null or p_schedule !~ '^[0-9*/,-]+( [0-9*/,-]+){4}$' then
    raise exception 'Некорректное расписание: %', p_schedule;
  end if;
  select jobid into v_job from cron.job where jobname = 'dispatch-assignment-notifications';
  if v_job is null then
    raise exception 'Задание dispatch-assignment-notifications не найдено';
  end if;
  perform cron.alter_job(job_id := v_job, schedule := p_schedule);
end;
$$;

revoke all on function public.set_notification_dispatch_schedule(text) from public, anon, authenticated;
grant execute on function public.set_notification_dispatch_schedule(text) to service_role;
