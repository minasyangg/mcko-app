-- Журнал входов для админ-панели («Сессии»). Источник — auth.sessions:
-- GoTrue создаёт строку на каждый логин и хранит ip/user_agent. Триггер
-- копирует минимум в public.login_events; ретенция 30 дней (чистка при
-- вставке). Запись — только триггером (definer), клиентам запись закрыта.
create table if not exists login_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,            -- без FK: профиль может быть удалён, журнал остаётся
  session_id uuid,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_login_events_created on login_events(created_at desc);
create index if not exists idx_login_events_user on login_events(user_id);

alter table login_events enable row level security;

-- admin читает события пользователей своей организации
drop policy if exists "login_events: admin read org" on login_events;
create policy "login_events: admin read org" on login_events
  for select using (
    auth_role() = 'admin'
    and exists (
      select 1 from profiles p
      where p.id = login_events.user_id and p.organization_id = auth_org()
    )
  );

-- запись/правка только сервисной стороной (триггер) — клиентам закрыто
drop policy if exists "login_events: write service only" on login_events;
create policy "login_events: write service only" on login_events
  for all using (false);

create or replace function handle_new_session()
returns trigger as $$
begin
  insert into public.login_events (user_id, session_id, ip, user_agent)
  values (new.user_id, new.id, host(new.ip), left(new.user_agent, 300));
  -- ретенция: журнал храним 30 дней
  delete from public.login_events where created_at < now() - interval '30 days';
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_session_created on auth.sessions;
create trigger on_auth_session_created
  after insert on auth.sessions
  for each row execute function handle_new_session();
