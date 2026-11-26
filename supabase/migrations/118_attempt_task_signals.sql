-- Признаки списывания (2026-11-26).
--
-- Плеер теста молча копит по каждому заданию попытки счётчики поведения
-- ученика и периодически досылает их приращения через API
-- (/api/attempts/[id]/signals → add_attempt_task_signals):
--   active_ms          — активное время на задании: вкладка видима, окно в
--                        фокусе, ученик не бездействует дольше порога;
--   away_count/away_ms — уходы со вкладки/из окна, пока открыто задание;
--   paste_count/pasted_chars — вставки из буфера в поля ответа;
--   typed_inputs       — набор с клавиатуры (без вставок);
--   away_paste_count   — вставка вскоре после возвращения на вкладку;
--   blind_paste_count  — вставка, когда ученик на этом задании ещё ничего
--                        не набирал.
-- Выводы («вероятно списано: …») считаются при открытии окна проверки
-- учителем (lib/attempts/integrity.ts) — пороги меняются без миграций.
-- Ученику счётчики не видны: чтения у него нет, запись — только через API.

create table if not exists attempt_task_signals (
  attempt_id uuid not null references attempts(id) on delete cascade,
  task_id uuid not null references test_tasks(id) on delete cascade,
  active_ms bigint not null default 0,
  away_count integer not null default 0,
  away_ms bigint not null default 0,
  paste_count integer not null default 0,
  pasted_chars integer not null default 0,
  typed_inputs integer not null default 0,
  away_paste_count integer not null default 0,
  blind_paste_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (attempt_id, task_id)
);

create index if not exists idx_attempt_task_signals_task on attempt_task_signals (task_id);

comment on table attempt_task_signals is
  'Счётчики поведения ученика по заданию попытки — признаки списывания (118). Запись только через API (service role)';

alter table attempt_task_signals enable row level security;

drop policy if exists "attempt_task_signals: teacher read own" on attempt_task_signals;
create policy "attempt_task_signals: teacher read own" on attempt_task_signals
  for select using (
    (select auth_role()) = 'teacher'
    and check_attempt_assignment_owned_by_auth(attempt_id)
  );

drop policy if exists "attempt_task_signals: admin read org" on attempt_task_signals;
create policy "attempt_task_signals: admin read org" on attempt_task_signals
  for select using (
    (select auth_role()) = 'admin'
    and check_attempt_in_auth_org(attempt_id)
  );

-- Прибавляет приращения счётчиков. Пишет только в незавершённую попытку
-- этого ученика и только по заданиям её теста; приращения ограничены сверху,
-- чтобы подделанный запрос не раздул счётчики.
create or replace function public.add_attempt_task_signals(p_attempt_id uuid, p_student_id uuid, p_rows jsonb)
returns integer
language sql
security definer
set search_path to 'public'
as $function$
  with rows as (
    select r.task_id,
      least(greatest(coalesce(r.active_ms, 0), 0), 3600000) as active_ms,
      least(greatest(coalesce(r.away_count, 0), 0), 1000) as away_count,
      least(greatest(coalesce(r.away_ms, 0), 0), 86400000) as away_ms,
      least(greatest(coalesce(r.paste_count, 0), 0), 1000) as paste_count,
      least(greatest(coalesce(r.pasted_chars, 0), 0), 100000) as pasted_chars,
      least(greatest(coalesce(r.typed_inputs, 0), 0), 100000) as typed_inputs,
      least(greatest(coalesce(r.away_paste_count, 0), 0), 1000) as away_paste_count,
      least(greatest(coalesce(r.blind_paste_count, 0), 0), 1000) as blind_paste_count
    from jsonb_to_recordset(p_rows) as r(
      task_id uuid, active_ms bigint, away_count integer, away_ms bigint, paste_count integer,
      pasted_chars integer, typed_inputs integer, away_paste_count integer, blind_paste_count integer
    )
    join attempts t on t.id = p_attempt_id
      and t.student_id = p_student_id
      and t.status = 'in_progress'
    join assignments a on a.id = t.assignment_id
    join test_tasks k on k.id = r.task_id and k.test_version_id = a.test_version_id
  ),
  ins as (
    insert into attempt_task_signals as s (
      attempt_id, task_id, active_ms, away_count, away_ms, paste_count, pasted_chars,
      typed_inputs, away_paste_count, blind_paste_count
    )
    select p_attempt_id, task_id, active_ms, away_count, away_ms, paste_count, pasted_chars,
      typed_inputs, away_paste_count, blind_paste_count
    from rows
    on conflict (attempt_id, task_id) do update set
      active_ms = s.active_ms + excluded.active_ms,
      away_count = s.away_count + excluded.away_count,
      away_ms = s.away_ms + excluded.away_ms,
      paste_count = s.paste_count + excluded.paste_count,
      pasted_chars = s.pasted_chars + excluded.pasted_chars,
      typed_inputs = s.typed_inputs + excluded.typed_inputs,
      away_paste_count = s.away_paste_count + excluded.away_paste_count,
      blind_paste_count = s.blind_paste_count + excluded.blind_paste_count,
      updated_at = now()
    returning 1
  )
  select count(*)::integer from ins
$function$;

revoke execute on function public.add_attempt_task_signals(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.add_attempt_task_signals(uuid, uuid, jsonb) to service_role;
