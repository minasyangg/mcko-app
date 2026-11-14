-- 110: отложенное открытие назначений и уведомление в момент открытия.
--
-- assignments.starts_at («Начало» в форме назначения) существовал с первой
-- миграции, но ни на что не влиял: ученик видел назначение и мог начать его
-- сразу, уведомление уходило в момент назначения. Теперь starts_at — дата
-- открытия:
--   * до неё ученик не видит назначение, его задания и теорию и не может
--     начать попытку — правило в RLS и функциях доступа, не только в UI;
--   * правило «вступил в группу не позже чем через 3 дня» (058) отсчитывается
--     от открытия, а не от создания: ученик, добавленный в группу между
--     назначением и открытием, назначение увидит;
--   * уведомление уходит в день открытия. Немедленные назначения уведомляет
--     сам роут, как раньше; отложенные — /api/notifications/dispatch, который
--     вызывает планировщик базы (pg_cron + pg_net) раз в 3 часа, кроме ночи.
--     Vercel Cron не нужен.
--
-- notified_at — когда ушло уведомление о назначении. default now(): все
-- существующие строки и вставки старым кодом (до выкладки нового) считаются
-- уже уведомлёнными, повторной рассылки не будет. Новый код ставит null для
-- назначений с открытием в будущем.

-- ── 1. Отметка об уведомлении ───────────────────────────────────────────
alter table public.assignments add column if not exists notified_at timestamptz default now();
comment on column public.assignments.notified_at is
  'Когда ученикам ушло уведомление о назначении. null — ещё не уходило: назначение откроется в starts_at, уведомление отправит /api/notifications/dispatch.';

create index if not exists assignments_pending_notification_idx
  on public.assignments (starts_at) where notified_at is null;

-- ── 2. Ученик не видит назначение до открытия ───────────────────────────
drop policy if exists "assignments: student read own" on public.assignments;
create policy "assignments: student read own" on public.assignments
  for select using (
    (select auth_role()) = 'student'
    and (
      student_id = (select auth.uid())
      or exists (
        select 1 from group_members gm
        where gm.group_id = assignments.group_id and gm.user_id = (select auth.uid())
      )
    )
    and (starts_at is null or starts_at <= now())
  );

-- ── 3. Правило «3 дня» — от открытия ────────────────────────────────────
-- greatest игнорирует null: без starts_at (или с прошедшей датой раньше
-- создания) отсчёт, как и раньше, от created_at.
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
      and gm.added_at <= greatest(a.created_at, a.starts_at) + interval '3 days'
  )
$$;

-- ── 4. Задания, версия и теория — только открытых назначений ────────────
create or replace function public.student_has_version_assignment(p_version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from assignments a
    where a.test_version_id = p_version_id
      and (a.starts_at is null or a.starts_at <= now())
      and (
        a.student_id = auth.uid()
        or student_sees_group_assignment(a.id, auth.uid())
      )
  )
$$;

create or replace function public.student_has_test_assignment(p_test_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from assignments a
    join test_versions tv on tv.id = a.test_version_id
    where tv.test_id = p_test_id
      and (a.starts_at is null or a.starts_at <= now())
      and (
        a.student_id = auth.uid()
        or student_sees_group_assignment(a.id, auth.uid())
      )
  )
$$;

-- ── 5. Попытку до открытия не начать ────────────────────────────────────
-- Тело — из 107 плюс условие на starts_at.
create or replace function public.check_attempt_startable(p_assignment_id uuid, p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from assignments a
      where a.id = p_assignment_id
        and a.closed_at is null
        and (a.starts_at is null or a.starts_at <= now())
        and (
          a.student_id = p_student_id
          or student_sees_group_assignment(a.id, p_student_id)
        )
        and (
          select count(*) from attempts t
          where t.assignment_id = a.id
            and t.student_id = p_student_id
            and t.status in ('submitted', 'checked')
        ) < greatest(coalesce(a.max_attempts, 1), 1)
    )
    and not exists (
      select 1 from student_final_results sfr
      where sfr.assignment_id = p_assignment_id
        and sfr.student_id = p_student_id
        and sfr.closed_reason is not null
    )
    and not exists (
      select 1 from attempts t
      where t.assignment_id = p_assignment_id
        and t.student_id = p_student_id
        and t.status in ('in_progress', 'not_started')
    )
$$;

-- ── 6. Планировщик рассылки ─────────────────────────────────────────────
-- pg_cron уже работает на проекте (перевод классов, 048). pg_net — HTTP-запрос
-- из базы. Оба входят в бесплатный тариф Supabase.
create extension if not exists pg_net with schema extensions;

-- Секрет вызова: хранится в Vault, роут сверяет его функцией ниже. Так не
-- нужно заводить переменную окружения в Vercel.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'notification_dispatch_secret') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'notification_dispatch_secret',
      'Заголовок x-dispatch-secret для /api/notifications/dispatch (pg_cron, миграция 110)'
    );
  end if;
end $$;

create or replace function public.notification_dispatch_secret_ok(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p_secret, '') <> '' and exists (
    select 1 from vault.decrypted_secrets
    where name = 'notification_dispatch_secret' and decrypted_secret = p_secret
  )
$$;
revoke all on function public.notification_dispatch_secret_ok(text) from public, anon, authenticated;
grant execute on function public.notification_dispatch_secret_ok(text) to service_role;

-- Раз в 3 часа, кроме ночи (решение пользователя 2026-11-14): по Москве
-- 1:00, 7:00, 10:00, 13:00, 16:00, 19:00, 22:00 — с 2:00 до 7:00 не шлём.
-- pg_cron считает время в UTC (Москва = UTC+3), отсюда часы 22,4,7,…,19.
-- Если есть открывшиеся, но ещё не уведомлённые назначения, вызываем
-- рассылку на продакшене; без такой работы запрос не отправляется вовсе.
-- Повторный вызов безопасен: роут помечает назначение до отправки.
select cron.schedule(
  'dispatch-assignment-notifications',
  '0 4,7,10,13,16,19,22 * * *',
  $job$
  select net.http_post(
    url := 'https://mcko-app.vercel.app/api/notifications/dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dispatch-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notification_dispatch_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  )
  where exists (
    select 1 from public.assignments
    where notified_at is null and closed_at is null
      and (starts_at is null or starts_at <= now())
  );
  $job$
);

-- История запусков pg_cron копится бессрочно — чистим раз в день.
select cron.schedule(
  'purge-cron-history',
  '30 3 * * *',
  $job$ delete from cron.job_run_details where end_time < now() - interval '14 days' $job$
);
